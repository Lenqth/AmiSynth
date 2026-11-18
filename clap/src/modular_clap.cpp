#include "modular_clap.h"
#include "modular_dsp.h"

#include <atomic>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <new>
#if defined(_WIN32)
#include "modular_editor.h"
#endif

namespace {
using namespace modular;

constexpr const char *kId = "com.github.lenqth.amisynth.modular";
constexpr const char *kFeatures[] = {CLAP_PLUGIN_FEATURE_INSTRUMENT, CLAP_PLUGIN_FEATURE_SYNTHESIZER,
    CLAP_PLUGIN_FEATURE_STEREO, nullptr};
const clap_plugin_descriptor_t kDescriptor{CLAP_VERSION_INIT, kId, "AmiSynth Modular", "AmiSynth",
    "https://github.com/Lenqth/AmiSynth", "", "", AMISYNTH_VERSION, "Polyphonic modular synthesizer", kFeatures};

struct Instance {
    clap_plugin_t plugin{};
    const clap_host_t *host = nullptr;
    Engine dsp;
    Json patch;  // Owned by the main thread.
    std::array<std::atomic<double>, kMacroCount> values{};
    std::atomic<uint32_t> gui_macro_changes{0};

    // Single-producer/single-consumer triple buffer. The main thread writes only
    // back; the audio thread reads only front. The middle index carries a dirty bit.
    std::array<Graph, 3> graphs{};
    std::array<uint64_t, 3> graph_epochs{};
    uint64_t next_epoch = 0; // Main thread.
    uint64_t applied_epoch = 0; // Audio thread.
    static constexpr unsigned dirty = 4;
    std::atomic<unsigned> middle{1};
    unsigned back = 2, front = 0;
    std::atomic<uint32_t> tail_samples{480240};
#if defined(_WIN32)
    std::unique_ptr<ModularEditor> editor;
#endif

    static Instance &get(const clap_plugin_t *p) { return *static_cast<Instance *>(p->plugin_data); }

    bool load(const std::string &text, bool edit = false, uint32_t macro_mask = (1u << kMacroCount) - 1) {
        try {
            // Bound nesting separately from byte size before JSON builds a tree.
            auto next = Json::parse(text, [](int depth, Json::parse_event_t, Json &) {
                if (depth > 12) throw std::invalid_argument("Patch nesting");
                return true;
            });
            Macros macros;
            const auto graph = compile(next, macros);
            // Moving modules and turning knobs preserve running voices and their DSP memory.
            const auto topology = [](Json value) {
                value.erase("macros");
                for (auto &node : value["nodes"]) { node.erase("params"); node.erase("position"); }
                return value;
            };
            const bool reset = !edit || topology(next) != topology(patch);
            if (edit)
                for (size_t i = 0; i < macros.size(); ++i)
                    if (!(macro_mask & (1u << i))) macros[i] = values[i].load();
            next["macros"] = macros;
            patch = std::move(next);
            uint32_t changed = 0;
            for (size_t i = 0; i < macros.size(); ++i)
                if (!edit || (macro_mask & (1u << i)))
                    if (values[i].exchange(macros[i]) != macros[i] && edit) changed |= 1u << i;
            gui_macro_changes.fetch_or(changed);
            graphs[back] = graph;
            // Keep structural resets even when several edits arrive before the next audio block.
            if (reset) ++next_epoch;
            graph_epochs[back] = next_epoch;
            back = middle.exchange(back | dirty) & ~dirty;
        } catch (...) { return false; }

        if (const auto *params = static_cast<const clap_host_params_t *>(host->get_extension(host, CLAP_EXT_PARAMS))) {
            params->rescan(host, CLAP_PARAM_RESCAN_VALUES);
            if (gui_macro_changes.load()) params->request_flush(host);
        }
        host->request_process(host);
        return true;
    }

    void end_note(NoteEnd note, uint32_t time, const clap_output_events_t *output) {
        if (!output || !note.send) return;
        const clap_event_note_t event{{sizeof(event), time, CLAP_CORE_EVENT_SPACE_ID, CLAP_EVENT_NOTE_END, 0},
            note.id, 0, note.channel, note.key, 0};
        output->try_push(output, &event.header);
    }

    void end_voice(Voice &voice, uint32_t time, const clap_output_events_t *output) {
        end_note({voice.clap_note, voice.channel, voice.key, voice.note_id}, time, output);
        voice.active = voice.clap_note = false;
    }

    void sync_graph(const clap_output_events_t *output) {
        if ((middle.load() & dirty) == 0) return;
        front = middle.exchange(front) & ~dirty;
        dsp.graph = graphs[front];
        if (applied_epoch != graph_epochs[front])
            for (auto &v : dsp.voices) if (v.active) end_voice(v, 0, output);
        applied_epoch = graph_epochs[front];
    }

    Json snapshot() const {
        auto result = patch;
        Macros macros;
        for (size_t i = 0; i < macros.size(); ++i) macros[i] = values[i].load();
        result["macros"] = macros;
        return result;
    }

    void emit_macro_changes(const clap_output_events_t *output) {
        if (!output) return;
        const uint32_t changed = gui_macro_changes.exchange(0);
        for (clap_id i = 0; i < kMacroCount; ++i) {
            if (!(changed & (1u << i))) continue;
            clap_event_param_gesture_t begin{{sizeof(begin), 0, CLAP_CORE_EVENT_SPACE_ID, CLAP_EVENT_PARAM_GESTURE_BEGIN, 0}, i};
            clap_event_param_value_t value{{sizeof(value), 0, CLAP_CORE_EVENT_SPACE_ID, CLAP_EVENT_PARAM_VALUE, 0},
                i, nullptr, -1, -1, -1, -1, values[i].load()};
            clap_event_param_gesture_t end{{sizeof(end), 0, CLAP_CORE_EVENT_SPACE_ID, CLAP_EVENT_PARAM_GESTURE_END, 0}, i};
            if (!output->try_push(output, &begin.header) || !output->try_push(output, &value.header) || !output->try_push(output, &end.header))
                gui_macro_changes.fetch_or(1u << i);
        }
    }

    std::string editor_message(const std::string &request) {
        try {
            if (request.size() > kPatchBytes * 3) throw std::invalid_argument("Editor message too large");
            const auto args = Json::parse(request, [](int depth, Json::parse_event_t, Json &) {
                if (depth > 16) throw std::invalid_argument("Editor message nesting");
                return true;
            });
            if (!args.is_array() || args.size() != 1) throw std::invalid_argument("Invalid editor message");
            const auto &message = args[0];
            const auto action = message.at("action").get<std::string>();
            if (action == "edit") {
                const auto text = message.at("patch").dump();
                if (text.size() > kPatchBytes || !load(text, true, message.value("macroMask", 0u)))
                    throw std::invalid_argument("Invalid Modular patch");
                if (const auto *state = static_cast<const clap_host_state_t *>(host->get_extension(host, CLAP_EXT_STATE)))
                    state->mark_dirty(host);
            } else if (action != "read") throw std::invalid_argument("Unknown editor action");
            return Json{{"ok", true}, {"patch", snapshot()}}.dump();
        } catch (const std::exception &e) { return Json{{"ok", false}, {"error", e.what()}}.dump(); }
    }

    void param(const clap_event_header_t *h) {
        if (!h || h->space_id != CLAP_CORE_EVENT_SPACE_ID || h->type != CLAP_EVENT_PARAM_VALUE ||
            h->size < sizeof(clap_event_param_value_t)) return;
        const auto &e = *reinterpret_cast<const clap_event_param_value_t *>(h);
        if (e.param_id < values.size() && e.note_id < 0 && e.port_index < 0 && e.channel < 0 && e.key < 0 && std::isfinite(e.value))
            values[e.param_id].store(std::clamp(e.value, 0.0, 1.0));
    }

    void midi(const clap_event_midi_t &e, const clap_output_events_t *output) {
        if (e.port_index != 0) return;
        const int op = e.data[0] & 0xf0, channel = e.data[0] & 0xf;
        const int key = e.data[1] & 0x7f, value = e.data[2] & 0x7f;
        if (op == 0x90 && value) {
            end_note(dsp.note_on(channel, key, -1, value / 127.0, false), e.header.time, output);
        } else if ((op == 0x90 || op == 0x80) && dsp.graph.voice_mode) {
            end_note(dsp.mono_note_off(channel, key), e.header.time, output);
        } else if (op == 0x90 || op == 0x80) {
            Voice *oldest = nullptr;
            for (auto &v : dsp.voices)
                if (!v.clap_note && v.key_down && Engine::matches(v, channel, key, -1) && (!oldest || v.age < oldest->age)) oldest = &v;
            if (oldest) dsp.release(*oldest);
        } else if (op == 0xe0) {
            dsp.bend[channel] = ((value << 7 | key) - 8192) / 4096.0;
        } else if (op == 0xb0) {
            if (key == 64) dsp.sustain[channel] = value >= 64;
            for (auto &v : dsp.voices) {
                if (!Engine::matches(v, channel, -1, -1)) continue;
                if (key == 120) end_voice(v, e.header.time, output);
                if (key == 123) { dsp.release(v); dsp.forget(channel, -1); }
                if (key == 64 && !v.key_down && !dsp.sustain[channel]) v.held = false;
            }
        }
    }

    void event(const clap_event_header_t *h, const clap_output_events_t *output) {
        if (!h || h->space_id != CLAP_CORE_EVENT_SPACE_ID) return;
        if (h->type == CLAP_EVENT_PARAM_VALUE) { param(h); return; }
        if (h->type == CLAP_EVENT_MIDI && h->size >= sizeof(clap_event_midi_t)) {
            midi(*reinterpret_cast<const clap_event_midi_t *>(h), output);
        }
        if (h->type > CLAP_EVENT_NOTE_CHOKE || h->size < sizeof(clap_event_note_t)) return;
        const auto &e = *reinterpret_cast<const clap_event_note_t *>(h);
        if (h->type == CLAP_EVENT_NOTE_ON) {
            if (e.port_index == 0 && e.channel >= 0 && e.channel < 16 && e.key >= 0 && e.key < 128 && std::isfinite(e.velocity))
                end_note(dsp.note_on(e.channel, e.key, e.note_id, std::clamp(e.velocity, 0.0, 1.0), true), h->time, output);
            return;
        }
        if (e.port_index > 0) return;
        if (h->type == CLAP_EVENT_NOTE_OFF && dsp.graph.voice_mode) {
            end_note(dsp.mono_note_off(e.channel, e.key), h->time, output);
            return;
        }
        if (h->type == CLAP_EVENT_NOTE_CHOKE) dsp.forget(e.channel, e.key);
        for (auto &v : dsp.voices) {
            if (!Engine::matches(v, e.channel, e.key, e.note_id)) continue;
            if (h->type == CLAP_EVENT_NOTE_CHOKE) end_voice(v, h->time, output);
            else if (v.clap_note) dsp.release(v);
        }
    }
};

bool CLAP_ABI init(const clap_plugin_t *p) {
    auto &self = Instance::get(p);
    // The default patch comes from the same catalog as the browser.
    try {
        self.patch = Json::parse(kPresets[0].patch);
        Macros defaults;
        self.dsp.graph = compile(self.patch, defaults);
        for (size_t i = 0; i < defaults.size(); ++i) self.values[i].store(defaults[i]);
    } catch (...) { return false; }
    return true;
}

bool CLAP_ABI activate(const clap_plugin_t *p, double rate, uint32_t, uint32_t) {
    if (!std::isfinite(rate) || rate < 1000 || rate > 768000) return false;
    auto &self = Instance::get(p);
    self.dsp.rate = rate;
    self.dsp.reset();
    self.tail_samples.store(uint32_t(std::ceil(10.005 * rate)));
    return true;
}

clap_process_status CLAP_ABI process(const clap_plugin_t *p, const clap_process_t *block) {
    if (block->audio_outputs_count != 1 || block->audio_outputs[0].channel_count != 2) return CLAP_PROCESS_ERROR;
    auto &self = Instance::get(p);
    auto &out = block->audio_outputs[0];
    if (!out.data32 && !out.data64) return CLAP_PROCESS_ERROR;
    out.constant_mask = 0;
    self.sync_graph(block->out_events);
    self.emit_macro_changes(block->out_events);
    const auto *events = block->in_events;
    const uint32_t count = events ? events->size(events) : 0;
    uint32_t index = 0;
    const auto *event = count ? events->get(events, 0) : nullptr;
    Macros macros;
    for (size_t m = 0; m < macros.size(); ++m) macros[m] = self.values[m].load();
    for (uint32_t frame = 0; frame < block->frames_count; ++frame) {
        while (event && event->time <= frame) {
            self.event(event, block->out_events);
            if (event->space_id == CLAP_CORE_EVENT_SPACE_ID && event->type == CLAP_EVENT_PARAM_VALUE)
                for (size_t m = 0; m < macros.size(); ++m) macros[m] = self.values[m].load();
            event = ++index < count ? events->get(events, index) : nullptr;
        }
        const auto sample = self.dsp.sample(macros);
        for (size_t channel = 0; channel < sample.size(); ++channel) {
            if (out.data32) out.data32[channel][frame] = float(sample[channel]);
            else out.data64[channel][frame] = sample[channel];
        }
        for (auto &v : self.dsp.voices)
            if (!v.active && v.clap_note) self.end_voice(v, frame, block->out_events);
    }
    return std::any_of(self.dsp.voices.begin(), self.dsp.voices.end(), [](const Voice &v) { return v.active; })
        ? CLAP_PROCESS_CONTINUE : CLAP_PROCESS_SLEEP;
}

bool CLAP_ABI save_state(const clap_plugin_t *p, const clap_ostream_t *s) {
    try {
        const auto &self = Instance::get(p);
        auto payload = self.snapshot();
        const std::string bytes = payload.dump();
        for (size_t pos = 0; pos < bytes.size();) {
            const auto n = s->write(s, bytes.data() + pos, bytes.size() - pos);
            if (n <= 0 || uint64_t(n) > bytes.size() - pos) return false;
            pos += size_t(n);
        }
        return true;
    } catch (...) { return false; }
}

bool CLAP_ABI load_state(const clap_plugin_t *p, const clap_istream_t *s) {
    try {
        std::string text;
        char data[4096];
        for (;;) {
            const auto n = s->read(s, data, sizeof(data));
            if (n < 0 || n > int64_t(sizeof(data)) || text.size() + size_t(n) > kPatchBytes) return false;
            if (!n) break;
            text.append(data, size_t(n));
        }
        return Instance::get(p).load(text);
    } catch (...) { return false; }
}
const clap_plugin_state_t kState{save_state, load_state};

const clap_plugin_params_t kParams{
    [](const clap_plugin_t *) -> uint32_t { return kMacroCount; },
    [](const clap_plugin_t *, uint32_t index, clap_param_info_t *info) {
        if (index >= kMacroCount) return false;
        *info = {};
        info->id = index;
        info->flags = CLAP_PARAM_IS_AUTOMATABLE | CLAP_PARAM_REQUIRES_PROCESS;
        std::snprintf(info->name, sizeof(info->name), "Macro %u", unsigned(index + 1));
        info->max_value = 1;
        return true;
    },
    [](const clap_plugin_t *p, clap_id id, double *value) {
        if (id >= kMacroCount) return false;
        *value = Instance::get(p).values[id].load();
        return true;
    },
    [](const clap_plugin_t *, clap_id id, double value, char *text, uint32_t capacity) {
        if (id >= kMacroCount || !capacity || !std::isfinite(value)) return false;
        const int n = std::snprintf(text, capacity, "%.3f", value);
        return n >= 0 && uint32_t(n) < capacity;
    },
    [](const clap_plugin_t *, clap_id id, const char *text, double *value) {
        if (id >= kMacroCount) return false;
        char *end;
        const double x = std::strtod(text, &end);
        if (end == text || *end || !std::isfinite(x) || x < 0 || x > 1) return false;
        *value = x;
        return true;
    },
    [](const clap_plugin_t *p, const clap_input_events_t *events, const clap_output_events_t *output) {
        auto &self = Instance::get(p);
        if (events) for (uint32_t i = 0, n = events->size(events); i < n; ++i) self.param(events->get(events, i));
        self.emit_macro_changes(output);
    },
};

const clap_plugin_audio_ports_t kAudio{
    [](const clap_plugin_t *, bool input) -> uint32_t { return input ? 0 : 1; },
    [](const clap_plugin_t *, uint32_t i, bool input, clap_audio_port_info_t *info) {
        if (input || i != 0) return false;
        *info = {};
        std::strcpy(info->name, "Stereo Out");
        info->flags = CLAP_AUDIO_PORT_IS_MAIN | CLAP_AUDIO_PORT_SUPPORTS_64BITS;
        info->channel_count = 2;
        info->port_type = CLAP_PORT_STEREO;
        info->in_place_pair = CLAP_INVALID_ID;
        return true;
    },
};

const clap_plugin_note_ports_t kNotes{
    [](const clap_plugin_t *, bool input) -> uint32_t { return input ? 1 : 0; },
    [](const clap_plugin_t *, uint32_t i, bool input, clap_note_port_info_t *info) {
        if (!input || i != 0) return false;
        *info = {};
        std::strcpy(info->name, "Notes");
        info->supported_dialects = CLAP_NOTE_DIALECT_CLAP | CLAP_NOTE_DIALECT_MIDI;
        info->preferred_dialect = CLAP_NOTE_DIALECT_CLAP;
        return true;
    },
};

const clap_plugin_tail_t kTail{
    [](const clap_plugin_t *p) { return Instance::get(p).tail_samples.load(); },
};

bool CLAP_ABI load_preset(const clap_plugin_t *p, uint32_t kind, const char *location, const char *key) {
    auto &self = Instance::get(p);
    bool ok = false;
    try {
        if (kind == CLAP_PRESET_DISCOVERY_LOCATION_PLUGIN && !location && key) {
            for (const auto &preset : kPresets)
                if (std::strcmp(key, preset.name) == 0) { ok = self.load(preset.patch); break; }
        } else if (kind == CLAP_PRESET_DISCOVERY_LOCATION_FILE && location && !key) {
            std::ifstream file(std::filesystem::u8path(location), std::ios::binary);
            if (file) {
                std::string text(kPatchBytes + 1, '\0');
                file.read(text.data(), text.size());
                text.resize(size_t(file.gcount()));
                if (!file.bad() && text.size() <= kPatchBytes) ok = self.load(text);
            }
        }
    } catch (...) {}
    const auto *host = self.host;
    const auto *preset = static_cast<const clap_host_preset_load_t *>(host->get_extension(host, CLAP_EXT_PRESET_LOAD));
    if (!preset) preset = static_cast<const clap_host_preset_load_t *>(host->get_extension(host, CLAP_EXT_PRESET_LOAD_COMPAT));
    if (ok) {
        if (const auto *state = static_cast<const clap_host_state_t *>(host->get_extension(host, CLAP_EXT_STATE))) state->mark_dirty(host);
        if (preset) preset->loaded(host, kind, location, key);
    } else if (preset) preset->on_error(host, kind, location, key, 0, "Invalid AmiSynth Modular patch");
    return ok;
}

const clap_plugin_preset_load_t kPresetLoad{load_preset};
const clap_preset_discovery_provider_descriptor_t kPresetDescriptor{
    CLAP_VERSION_INIT, kId, "AmiSynth Modular Presets", "Lenqth",
};
struct Provider {
    clap_preset_discovery_provider_t api{};
    const clap_preset_discovery_indexer_t *indexer;
};
const clap_preset_discovery_factory_t kPresetFactory{
    [](const clap_preset_discovery_factory_t *) -> uint32_t { return 1; },
    [](const clap_preset_discovery_factory_t *, uint32_t i) { return i == 0 ? &kPresetDescriptor : nullptr; },
    [](const clap_preset_discovery_factory_t *, const clap_preset_discovery_indexer_t *indexer, const char *id)
        -> const clap_preset_discovery_provider_t * {
        if (!id || std::strcmp(id, kId) != 0) return nullptr;
        auto *provider = new (std::nothrow) Provider{{}, indexer};
        if (!provider) return nullptr;
        provider->api = {&kPresetDescriptor, provider,
            [](const clap_preset_discovery_provider_t *p) {
                static constexpr clap_preset_discovery_location_t location{CLAP_PRESET_DISCOVERY_IS_FACTORY_CONTENT,
                    "AmiSynth Modular Factory", CLAP_PRESET_DISCOVERY_LOCATION_PLUGIN, nullptr};
                const auto *indexer = static_cast<Provider *>(p->provider_data)->indexer;
                return indexer->declare_location(indexer, &location);
            },
            [](const clap_preset_discovery_provider_t *p) { delete static_cast<Provider *>(p->provider_data); },
            [](const clap_preset_discovery_provider_t *, uint32_t kind, const char *location,
                const clap_preset_discovery_metadata_receiver_t *receiver) {
                if (kind != CLAP_PRESET_DISCOVERY_LOCATION_PLUGIN || location) return false;
                static constexpr clap_universal_plugin_id_t id{"clap", kId};
                for (const auto &preset : kPresets) {
                    if (!receiver->begin_preset(receiver, preset.name, preset.name)) break;
                    receiver->add_plugin_id(receiver, &id);
                }
                return true;
            },
            [](const clap_preset_discovery_provider_t *, const char *) -> const void * { return nullptr; },
        };
        return &provider->api;
    },
};

#if defined(_WIN32)
const clap_plugin_gui_t kGui{
    [](const clap_plugin_t *, const char *api, bool floating) {
        return ((!api || !*api) && floating) || (api && std::strcmp(api, CLAP_WINDOW_API_WIN32) == 0);
    },
    [](const clap_plugin_t *, const char **api, bool *floating) {
        *api = CLAP_WINDOW_API_WIN32; *floating = false; return true;
    },
    [](const clap_plugin_t *p, const char *api, bool floating) {
        auto &self = Instance::get(p);
        if (self.editor || !kGui.is_api_supported(p, api, floating)) return false;
        try {
            self.editor = std::make_unique<ModularEditor>(
                [&self](const std::string &request) { return self.editor_message(request); },
                [&self] {
                    if (const auto *gui = static_cast<const clap_host_gui_t *>(self.host->get_extension(self.host, CLAP_EXT_GUI)))
                        gui->closed(self.host, false);
                }, floating);
            return true;
        } catch (const std::exception &e) { std::fprintf(stderr, "[AmiSynth Modular GUI] %s\n", e.what()); return false; }
    },
    [](const clap_plugin_t *p) { Instance::get(p).editor.reset(); },
    [](const clap_plugin_t *, double) { return false; }, // Use Windows/WebView2 DPI scaling.
    [](const clap_plugin_t *p, uint32_t *w, uint32_t *h) {
        auto &editor = Instance::get(p).editor;
        if (!editor) return false;
        editor->get_size(w, h); return true;
    },
    [](const clap_plugin_t *) { return true; },
    [](const clap_plugin_t *, clap_gui_resize_hints_t *hints) {
        *hints = {}; hints->can_resize_horizontally = hints->can_resize_vertically = true; return true;
    },
    [](const clap_plugin_t *, uint32_t *w, uint32_t *h) {
        *w = std::clamp(*w, 640u, 8192u); *h = std::clamp(*h, 480u, 8192u); return true;
    },
    [](const clap_plugin_t *p, uint32_t w, uint32_t h) { auto &e = Instance::get(p).editor; return e && e->size(w, h); },
    [](const clap_plugin_t *p, const clap_window_t *w) { auto &e = Instance::get(p).editor; return e && e->parent(w); },
    [](const clap_plugin_t *p, const clap_window_t *w) { auto &e = Instance::get(p).editor; return e && e->transient(w); },
    [](const clap_plugin_t *p, const char *text) { if (auto &e = Instance::get(p).editor) e->title(text); },
    [](const clap_plugin_t *p) { auto &e = Instance::get(p).editor; return e && e->show(true); },
    [](const clap_plugin_t *p) { auto &e = Instance::get(p).editor; return e && e->show(false); },
};
#endif

const void *CLAP_ABI extension(const clap_plugin_t *, const char *id) {
#if defined(_WIN32)
    if (std::strcmp(id, CLAP_EXT_GUI) == 0) return &kGui;
#endif
    if (std::strcmp(id, CLAP_EXT_AUDIO_PORTS) == 0) return &kAudio;
    if (std::strcmp(id, CLAP_EXT_NOTE_PORTS) == 0) return &kNotes;
    if (std::strcmp(id, CLAP_EXT_PARAMS) == 0) return &kParams;
    if (std::strcmp(id, CLAP_EXT_STATE) == 0) return &kState;
    if (std::strcmp(id, CLAP_EXT_TAIL) == 0) return &kTail;
    if (std::strcmp(id, CLAP_EXT_PRESET_LOAD) == 0 || std::strcmp(id, CLAP_EXT_PRESET_LOAD_COMPAT) == 0) return &kPresetLoad;
    return nullptr;
}

const clap_plugin_factory_t kFactory{
    [](const clap_plugin_factory_t *) -> uint32_t { return 1; },
    [](const clap_plugin_factory_t *, uint32_t i) { return i == 0 ? &kDescriptor : nullptr; },
    [](const clap_plugin_factory_t *, const clap_host_t *host, const char *id) -> const clap_plugin_t * {
        if (!host || !clap_version_is_compatible(host->clap_version) || !id || std::strcmp(id, kId) != 0) return nullptr;
        auto *self = new (std::nothrow) Instance;
        if (!self) return nullptr;
        self->host = host;
        self->plugin = {&kDescriptor, self, init,
            [](const clap_plugin_t *p) { delete &Instance::get(p); },
            activate, [](const clap_plugin_t *) {},
            [](const clap_plugin_t *) { return true; }, [](const clap_plugin_t *) {},
            [](const clap_plugin_t *p) { Instance::get(p).dsp.reset(); },
            process, extension, [](const clap_plugin_t *) {}};
        return &self->plugin;
    },
};

} // namespace

namespace amisynth_modular {
const clap_plugin_factory_t *plugin_factory() { return &kFactory; }
const clap_preset_discovery_factory_t *preset_factory() { return &kPresetFactory; }
}
