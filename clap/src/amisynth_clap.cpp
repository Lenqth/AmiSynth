// AmiSynth as a CLAP plugin.
//
// The instruments are the JSFX in jsfx/, run by the ysfx library (the EEL2 engine that
// `npm run test:ysfx-s` compares with the JS DSP sample by sample). The JSFX and their .rpl
// preset banks are embedded in the binary and written to a per-user folder on first use, so no
// JSFX host and no manual loading are needed:
//
//   Windows  %LOCALAPPDATA%\AmiSynth          macOS  ~/Library/Application Support/AmiSynth
//   Linux    $XDG_DATA_HOME/AmiSynth (~/.local/share/AmiSynth)
//     clap/<hash>/Effects/AmiSynth/*.jsfx    the embedded files (one folder per build)
//     Data/AmiSynth/tuning.txt               the Scala file (Tuning Source = Scale file)
//
// AMISYNTH_DATA_DIR overrides the Data folder (e.g. REAPER's own Data folder, or the tests).
//
// One plugin per JSFX: slider N is parameter id N - 1, MIDI and CLAP notes go to the JSFX as
// MIDI, the host transport becomes the JSFX tempo / play state / beat position, and the state is
// the slider values. Presets: the .rpl banks through the CLAP preset discovery factory.
#include <clap/clap.h>
#include "ysfx.h"
#include "amisynth_embedded.h"

#include <algorithm>
#include <atomic>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <memory>
#include <mutex>
#include <string>
#include <vector>

namespace fs = std::filesystem;

namespace {

struct Kind {
    const char *id;
    const char *name;
    const char *file;
    const char *description;
    const char *features[5];
    bool instrument;
    const char *const *groups; // CLAP parameter module of each slider
    size_t groupCount;
};

#define AMISYNTH_GROUPS(name) kGroups_##name, sizeof(kGroups_##name) / sizeof(kGroups_##name[0])

const Kind kKinds[] = {
    {"com.github.lenqth.amisynth.synth", "AmiSynth Synth", "AmiSynth Synth.jsfx",
     "Subtractive / wavetable synth with arpeggiator, mod matrix and effects",
     {CLAP_PLUGIN_FEATURE_INSTRUMENT, CLAP_PLUGIN_FEATURE_SYNTHESIZER, CLAP_PLUGIN_FEATURE_STEREO, nullptr}, true, AMISYNTH_GROUPS(synth)},
    {"com.github.lenqth.amisynth.physical", "AmiSynth Physical", "AmiSynth Physical.jsfx",
     "Physical modelling instrument: strings, modal, bowed, wind, membranes, piano, brass",
     {CLAP_PLUGIN_FEATURE_INSTRUMENT, CLAP_PLUGIN_FEATURE_SYNTHESIZER, CLAP_PLUGIN_FEATURE_STEREO, nullptr}, true, AMISYNTH_GROUPS(phys)},
    {"com.github.lenqth.amisynth.drums", "AmiSynth Drums", "AmiSynth Drums.jsfx",
     "Synthesized GM drum kit with per-group outputs",
     {CLAP_PLUGIN_FEATURE_INSTRUMENT, CLAP_PLUGIN_FEATURE_DRUM_MACHINE, CLAP_PLUGIN_FEATURE_DRUM, CLAP_PLUGIN_FEATURE_STEREO, nullptr}, true, AMISYNTH_GROUPS(drums)},
    {"com.github.lenqth.amisynth.tuning", "AmiSynth Tuning", "AmiSynth Tuning.jsfx",
     "Shared scale for AmiSynth Synth / Physical (passes audio and notes through)",
     {CLAP_PLUGIN_FEATURE_NOTE_EFFECT, CLAP_PLUGIN_FEATURE_UTILITY, nullptr}, false, AMISYNTH_GROUPS(tuning)},
};
constexpr uint32_t kKindCount = sizeof(kKinds) / sizeof(kKinds[0]);

clap_plugin_descriptor_t kDescriptors[kKindCount];

const Kind *kind_by_id(const char *id) {
    for (const Kind &k : kKinds)
        if (!std::strcmp(k.id, id)) return &k;
    return nullptr;
}

// ---- files ---------------------------------------------------------------------------------

fs::path user_base() {
#if defined(_WIN32)
    if (const char *p = std::getenv("LOCALAPPDATA")) return fs::path(p) / "AmiSynth";
    if (const char *p = std::getenv("APPDATA")) return fs::path(p) / "AmiSynth";
#elif defined(__APPLE__)
    if (const char *p = std::getenv("HOME")) return fs::path(p) / "Library" / "Application Support" / "AmiSynth";
#else
    if (const char *p = std::getenv("XDG_DATA_HOME"); p && *p) return fs::path(p) / "AmiSynth";
    if (const char *p = std::getenv("HOME")) return fs::path(p) / ".local" / "share" / "AmiSynth";
#endif
    return fs::temp_directory_path() / "AmiSynth";
}

std::mutex g_extract_mutex;

// Writes the embedded files once per build; returns the Effects/AmiSynth folder ("" on failure).
fs::path effects_dir() {
    std::lock_guard<std::mutex> guard(g_extract_mutex);
    static fs::path done;
    if (!done.empty()) return done;
    const fs::path dir = user_base() / "clap" / kEmbeddedHash / "Effects" / "AmiSynth";
    std::error_code ec;
    fs::create_directories(dir, ec);
    for (const EmbeddedFile &f : kEmbeddedFiles) {
        const fs::path target = dir / fs::u8path(f.name);
        if (fs::exists(target, ec) && fs::file_size(target, ec) == f.size) continue;
        const fs::path tmp = target.string() + ".tmp";
        {
            std::ofstream out(tmp, std::ios::binary | std::ios::trunc);
            out.write(reinterpret_cast<const char *>(f.data), (std::streamsize)f.size);
            if (!out) return {};
        }
        fs::rename(tmp, target, ec);
        if (ec) return {};
    }
    return done = dir;
}

fs::path data_dir() {
    if (const char *p = std::getenv("AMISYNTH_DATA_DIR"); p && *p) return fs::u8path(p);
    const fs::path dir = user_base() / "Data";
    std::error_code ec;
    fs::create_directories(dir / "AmiSynth", ec);
    return dir;
}

void log_reporter(intptr_t, ysfx_log_level level, const char *msg) {
    if (level == ysfx_log_error) std::fprintf(stderr, "[AmiSynth] %s\n", msg);
}

// Compiled, initialized JSFX for one kind (nullptr on failure).
ysfx_t *open_jsfx(const Kind &kind) {
    const fs::path dir = effects_dir();
    if (dir.empty()) return nullptr;
    const std::string path = (dir / fs::u8path(kind.file)).u8string();
    ysfx_config_t *config = ysfx_config_new();
    ysfx_set_log_reporter(config, &log_reporter);
    ysfx_guess_file_roots(config, path.c_str());
    ysfx_set_data_root(config, data_dir().u8string().c_str());
    ysfx_t *fx = ysfx_new(config);
    ysfx_config_free(config);
    if (!ysfx_load_file(fx, path.c_str(), 0) || !ysfx_compile(fx, ysfx_compile_no_gfx)) {
        ysfx_free(fx);
        return nullptr;
    }
    ysfx_set_sample_rate(fx, 48000);
    ysfx_set_block_size(fx, 1024);
    ysfx_init(fx);
    return fx;
}

// ---- plugin --------------------------------------------------------------------------------

struct OutPort { std::string name; uint32_t firstPin, channels; };

struct Plugin {
    clap_plugin_t clap{};
    const clap_host_t *host = nullptr;
    const clap_host_params_t *hostParams = nullptr;
    const Kind *kind = nullptr;
    ysfx_t *fx = nullptr;
    std::mutex mutex; // guards fx between the audio thread and the main thread
    std::vector<uint32_t> sliders; // existing slider indices = parameter ids
    uint32_t numIns = 0, numOuts = 0; // JSFX pins
    std::vector<OutPort> outPorts;
    bool sidechain = false; // instruments: input pins 3/4 (pins 1/2 are unused)
    uint32_t maxFrames = 0;
    double sampleRate = 48000;
    std::vector<float> zeros, sink;
    std::vector<const float *> ins;
    std::vector<float *> outs;
};

Plugin *self(const clap_plugin_t *p) { return static_cast<Plugin *>(p->plugin_data); }

void set_slider(ysfx_t *fx, uint32_t index, double value) { ysfx_slider_set_value(fx, index, value, true); }

bool apply_param_event(Plugin *pl, const clap_event_header_t *h) {
    if (h->space_id != CLAP_CORE_EVENT_SPACE_ID || h->type != CLAP_EVENT_PARAM_VALUE) return false;
    const auto *ev = reinterpret_cast<const clap_event_param_value_t *>(h);
    if (ev->param_id < ysfx_max_sliders && ysfx_slider_exists(pl->fx, ev->param_id)) set_slider(pl->fx, ev->param_id, ev->value);
    return true;
}

// Slider changes made by the JSFX itself (e.g. the meter's level match) go back to the host.
void push_slider_changes(Plugin *pl, const clap_output_events_t *out) {
    if (!out) return;
    for (uint8_t g = 0; g < ysfx_max_slider_groups; g++) {
        const uint64_t mask = ysfx_fetch_slider_changes(pl->fx, g) | ysfx_fetch_slider_automations(pl->fx, g);
        for (uint32_t b = 0; b < 64; b++) {
            if (!(mask & (uint64_t(1) << b))) continue;
            const uint32_t index = g * 64 + b;
            clap_event_param_value_t ev{};
            ev.header = {sizeof(ev), 0, CLAP_CORE_EVENT_SPACE_ID, CLAP_EVENT_PARAM_VALUE, 0};
            ev.param_id = index;
            ev.note_id = -1; ev.port_index = -1; ev.channel = -1; ev.key = -1;
            ev.value = ysfx_slider_get_value(pl->fx, index);
            out->try_push(out, &ev.header);
        }
    }
}

bool plugin_init(const clap_plugin_t *p) {
    Plugin *pl = self(p);
    pl->hostParams = static_cast<const clap_host_params_t *>(pl->host->get_extension(pl->host, CLAP_EXT_PARAMS));
    pl->fx = open_jsfx(*pl->kind);
    if (!pl->fx) return false;
    for (uint32_t i = 0; i < ysfx_max_sliders; i++)
        if (ysfx_slider_exists(pl->fx, i)) pl->sliders.push_back(i);
    pl->numIns = ysfx_get_num_inputs(pl->fx);
    pl->numOuts = ysfx_get_num_outputs(pl->fx);
    pl->sidechain = pl->kind->instrument && pl->numIns >= 4;
    // stereo output ports from the JSFX's out_pin pairs ("Kick L" / "Kick R" -> "Kick")
    for (uint32_t pin = 0; pin < pl->numOuts; pin += 2) {
        std::string name = ysfx_get_output_name(pl->fx, pin);
        if (name.size() > 2 && name.compare(name.size() - 2, 2, " L") == 0) name.resize(name.size() - 2);
        if (pin == 0) name = pl->numOuts > 2 ? "Main" : "Output";
        pl->outPorts.push_back({name, pin, std::min<uint32_t>(2, pl->numOuts - pin)});
    }
    return true;
}

void plugin_destroy(const clap_plugin_t *p) {
    Plugin *pl = self(p);
    if (pl->fx) ysfx_free(pl->fx);
    delete pl;
}

bool plugin_activate(const clap_plugin_t *p, double sr, uint32_t, uint32_t maxFrames) {
    Plugin *pl = self(p);
    std::lock_guard<std::mutex> guard(pl->mutex);
    pl->maxFrames = maxFrames;
    pl->sampleRate = sr;
    pl->zeros.assign(maxFrames, 0.0f);
    pl->sink.assign(maxFrames, 0.0f);
    pl->ins.assign(std::max<uint32_t>(pl->numIns, 1), nullptr);
    pl->outs.assign(std::max<uint32_t>(pl->numOuts, 1), nullptr);
    ysfx_set_sample_rate(pl->fx, sr);
    ysfx_set_block_size(pl->fx, maxFrames);
    ysfx_init(pl->fx);
    return true;
}

void plugin_deactivate(const clap_plugin_t *) {}
bool plugin_start_processing(const clap_plugin_t *) { return true; }
void plugin_stop_processing(const clap_plugin_t *) {}

void plugin_reset(const clap_plugin_t *p) {
    Plugin *pl = self(p);
    std::lock_guard<std::mutex> guard(pl->mutex);
    ysfx_init(pl->fx);
}

void set_transport(Plugin *pl, const clap_event_transport_t *t) {
    ysfx_time_info_t ti{};
    ti.tempo = 120;
    ti.time_signature[0] = 4;
    ti.time_signature[1] = 4;
    if (t) {
        if (t->flags & CLAP_TRANSPORT_HAS_TEMPO) ti.tempo = t->tempo;
        if (t->flags & CLAP_TRANSPORT_IS_PLAYING)
            ti.playback_state = (t->flags & CLAP_TRANSPORT_IS_RECORDING) ? ysfx_playback_recording : ysfx_playback_playing;
        if (t->flags & CLAP_TRANSPORT_HAS_BEATS_TIMELINE) {
            // CLAP's beat time has 31 fractional bits; snap it to the block's sample position (when it
            // is one) so a tempo-synced step that lands exactly on a sample lands on the same sample
            // as in REAPER and the web version
            ti.beat_position = (double)t->song_pos_beats / CLAP_BEATTIME_FACTOR;
            const double perSample = ti.tempo / 60 / pl->sampleRate, samples = ti.beat_position / perSample;
            if (std::abs(samples - std::round(samples)) < 1e-3) ti.beat_position = std::round(samples) * perSample;
        }
        if (t->flags & CLAP_TRANSPORT_HAS_SECONDS_TIMELINE) ti.time_position = (double)t->song_pos_seconds / CLAP_SECTIME_FACTOR;
        if (t->flags & CLAP_TRANSPORT_HAS_TIME_SIGNATURE) {
            ti.time_signature[0] = t->tsig_num;
            ti.time_signature[1] = t->tsig_denom;
        }
    }
    ysfx_set_time_info(pl->fx, &ti);
}

// Notes (CLAP or MIDI dialect) to the JSFX as MIDI; the Tuning effect also passes them on.
void handle_event(Plugin *pl, const clap_event_header_t *h, const clap_output_events_t *out) {
    if (apply_param_event(pl, h) || h->space_id != CLAP_CORE_EVENT_SPACE_ID) return;
    uint8_t data[3];
    switch (h->type) {
    case CLAP_EVENT_NOTE_ON:
    case CLAP_EVENT_NOTE_OFF:
    case CLAP_EVENT_NOTE_CHOKE: {
        const auto *ev = reinterpret_cast<const clap_event_note_t *>(h);
        if (ev->key < 0 || ev->key > 127) return;
        const int channel = ev->channel >= 0 && ev->channel < 16 ? ev->channel : 0;
        if (h->type == CLAP_EVENT_NOTE_ON) {
            const int velocity = std::clamp((int)std::lround(ev->velocity * 127), 1, 127);
            data[0] = uint8_t(0x90 | channel); data[1] = uint8_t(ev->key); data[2] = uint8_t(velocity);
        } else {
            data[0] = uint8_t(0x80 | channel); data[1] = uint8_t(ev->key); data[2] = 0;
        }
        break;
    }
    case CLAP_EVENT_MIDI: {
        const auto *ev = reinterpret_cast<const clap_event_midi_t *>(h);
        std::memcpy(data, ev->data, 3);
        break;
    }
    default:
        return;
    }
    if (pl->kind->instrument) {
        const uint8_t status = data[0] & 0xf0;
        ysfx_midi_event_t ev{};
        ev.offset = h->time;
        ev.size = (status == 0xc0 || status == 0xd0) ? 2 : 3;
        ev.data = data;
        ysfx_send_midi(pl->fx, &ev);
    } else if (out) {
        out->try_push(out, h);
    }
}

clap_process_status plugin_process(const clap_plugin_t *p, const clap_process_t *process) {
    Plugin *pl = self(p);
    const uint32_t frames = process->frames_count;
    std::unique_lock<std::mutex> guard(pl->mutex, std::try_to_lock);
    if (!guard.owns_lock() || frames > pl->maxFrames) {
        for (uint32_t o = 0; o < process->audio_outputs_count; o++)
            for (uint32_t c = 0; c < process->audio_outputs[o].channel_count; c++)
                if (float *d = process->audio_outputs[o].data32 ? process->audio_outputs[o].data32[c] : nullptr)
                    std::fill(d, d + frames, 0.0f);
        return CLAP_PROCESS_CONTINUE;
    }

    set_transport(pl, process->transport);
    const uint32_t n = process->in_events->size(process->in_events);
    for (uint32_t i = 0; i < n; i++) handle_event(pl, process->in_events->get(process->in_events, i), process->out_events);

    if (!pl->kind->instrument) {
        // AmiSynth Tuning has no pins: audio passes through untouched
        ysfx_process_float(pl->fx, nullptr, nullptr, 0, 0, frames);
        if (process->audio_inputs_count && process->audio_outputs_count) {
            const clap_audio_buffer_t &in = process->audio_inputs[0], &out = process->audio_outputs[0];
            for (uint32_t c = 0; c < out.channel_count; c++) {
                float *d = out.data32[c];
                const float *s = c < in.channel_count ? in.data32[c] : nullptr;
                if (!s) std::fill(d, d + frames, 0.0f);
                else if (s != d) std::copy(s, s + frames, d);
            }
        }
    } else {
        for (uint32_t i = 0; i < pl->numIns; i++) pl->ins[i] = pl->zeros.data();
        if (pl->sidechain && process->audio_inputs_count && process->audio_inputs[0].data32) {
            const clap_audio_buffer_t &sc = process->audio_inputs[0];
            for (uint32_t c = 0; c < 2 && c < sc.channel_count; c++) pl->ins[2 + c] = sc.data32[c];
            if (sc.channel_count == 1) pl->ins[3] = sc.data32[0];
        }
        for (uint32_t i = 0; i < pl->numOuts; i++) pl->outs[i] = pl->sink.data();
        for (uint32_t o = 0; o < pl->outPorts.size() && o < process->audio_outputs_count; o++) {
            const clap_audio_buffer_t &out = process->audio_outputs[o];
            for (uint32_t c = 0; c < pl->outPorts[o].channels && c < out.channel_count; c++)
                if (out.data32) pl->outs[pl->outPorts[o].firstPin + c] = out.data32[c];
        }
        ysfx_process_float(pl->fx, pl->ins.data(), pl->outs.data(), pl->numIns, pl->numOuts, frames);
    }
    push_slider_changes(pl, process->out_events);
    return CLAP_PROCESS_CONTINUE;
}

// ---- params --------------------------------------------------------------------------------

uint32_t params_count(const clap_plugin_t *p) { return (uint32_t)self(p)->sliders.size(); }

bool params_get_info(const clap_plugin_t *p, uint32_t index, clap_param_info_t *info) {
    Plugin *pl = self(p);
    if (index >= pl->sliders.size()) return false;
    const uint32_t s = pl->sliders[index];
    std::lock_guard<std::mutex> guard(pl->mutex);
    ysfx_slider_range_t range{};
    ysfx_slider_get_range(pl->fx, s, &range);
    std::memset(info, 0, sizeof(*info));
    info->id = s;
    const char *name = ysfx_slider_get_name(pl->fx, s);
    std::snprintf(info->name, sizeof(info->name), "%s", name);
    if (s < pl->kind->groupCount) std::snprintf(info->module, sizeof(info->module), "%s", pl->kind->groups[s]);
    info->min_value = range.min;
    info->max_value = range.max;
    info->default_value = range.def;
    const bool readOnly = std::strstr(name, "(read only)") != nullptr;
    info->flags = readOnly ? CLAP_PARAM_IS_READONLY : CLAP_PARAM_IS_AUTOMATABLE;
    if (ysfx_slider_is_enum(pl->fx, s) || ysfx_slider_is_path(pl->fx, s))
        info->flags |= CLAP_PARAM_IS_STEPPED | CLAP_PARAM_IS_ENUM;
    else if (range.inc >= 1 && std::floor(range.inc) == range.inc && std::floor(range.min) == range.min)
        info->flags |= CLAP_PARAM_IS_STEPPED;
    if (!ysfx_slider_is_initially_visible(pl->fx, s)) info->flags |= CLAP_PARAM_IS_HIDDEN;
    return true;
}

bool params_get_value(const clap_plugin_t *p, clap_id id, double *value) {
    Plugin *pl = self(p);
    if (id >= ysfx_max_sliders || !ysfx_slider_exists(pl->fx, id)) return false;
    std::lock_guard<std::mutex> guard(pl->mutex);
    *value = ysfx_slider_get_value(pl->fx, id);
    return true;
}

bool params_value_to_text(const clap_plugin_t *p, clap_id id, double value, char *out, uint32_t size) {
    Plugin *pl = self(p);
    if (id >= ysfx_max_sliders || !ysfx_slider_exists(pl->fx, id) || !size) return false;
    if (ysfx_slider_is_enum(pl->fx, id) || ysfx_slider_is_path(pl->fx, id)) {
        const long k = std::lround(value);
        const uint32_t count = ysfx_slider_get_enum_size(pl->fx, id);
        if (k >= 0 && (uint32_t)k < count) {
            std::snprintf(out, size, "%s", ysfx_slider_get_enum_name(pl->fx, id, (uint32_t)k));
            return true;
        }
    }
    ysfx_slider_range_t range{};
    ysfx_slider_get_range(pl->fx, id, &range);
    int decimals = 0;
    if (range.inc > 0 && range.inc < 1) decimals = std::min(4, (int)std::ceil(-std::log10(range.inc) - 1e-9));
    else if (range.inc <= 0) decimals = 3;
    std::snprintf(out, size, "%.*f", decimals, value);
    if (decimals > 0) { // 1200.000 -> 1200, 0.500 -> 0.5
        char *end = out + std::strlen(out) - 1;
        while (end > out && *end == '0') *end-- = 0;
        if (*end == '.') *end = 0;
    }
    return true;
}

bool params_text_to_value(const clap_plugin_t *p, clap_id id, const char *text, double *value) {
    Plugin *pl = self(p);
    if (id >= ysfx_max_sliders || !ysfx_slider_exists(pl->fx, id)) return false;
    const uint32_t count = ysfx_slider_get_enum_size(pl->fx, id);
    for (uint32_t k = 0; k < count; k++)
        if (!std::strcmp(text, ysfx_slider_get_enum_name(pl->fx, id, k))) { *value = k; return true; }
    char *end = nullptr;
    const double v = std::strtod(text, &end);
    if (end == text) return false;
    *value = v;
    return true;
}

void params_flush(const clap_plugin_t *p, const clap_input_events_t *in, const clap_output_events_t *out) {
    Plugin *pl = self(p);
    std::lock_guard<std::mutex> guard(pl->mutex);
    const uint32_t n = in->size(in);
    for (uint32_t i = 0; i < n; i++) apply_param_event(pl, in->get(in, i));
    push_slider_changes(pl, out);
}

const clap_plugin_params_t kParams = {params_count, params_get_info, params_get_value, params_value_to_text,
                                      params_text_to_value, params_flush};

// ---- state ---------------------------------------------------------------------------------
// "AMSY" u32 version=1, u32 count, count x (u32 slider index, f64 value), u64 size, @serialize data

bool write_all(const clap_ostream_t *s, const void *data, size_t size) {
    const char *p = static_cast<const char *>(data);
    while (size) {
        const int64_t n = s->write(s, p, size);
        if (n <= 0) return false;
        p += n; size -= (size_t)n;
    }
    return true;
}

bool read_all(const clap_istream_t *s, void *data, size_t size) {
    char *p = static_cast<char *>(data);
    while (size) {
        const int64_t n = s->read(s, p, size);
        if (n <= 0) return false;
        p += n; size -= (size_t)n;
    }
    return true;
}

bool state_save(const clap_plugin_t *p, const clap_ostream_t *stream) {
    Plugin *pl = self(p);
    ysfx_state_t *st;
    {
        std::lock_guard<std::mutex> guard(pl->mutex);
        st = ysfx_save_state(pl->fx);
    }
    if (!st) return false;
    const uint32_t version = 1, count = st->slider_count;
    const uint64_t size = st->data_size;
    bool ok = write_all(stream, "AMSY", 4) && write_all(stream, &version, 4) && write_all(stream, &count, 4);
    for (uint32_t i = 0; ok && i < count; i++)
        ok = write_all(stream, &st->sliders[i].index, 4) && write_all(stream, &st->sliders[i].value, 8);
    ok = ok && write_all(stream, &size, 8) && (!size || write_all(stream, st->data, (size_t)size));
    ysfx_state_free(st);
    return ok;
}

void after_state_change(Plugin *pl) {
    if (pl->hostParams) pl->hostParams->rescan(pl->host, CLAP_PARAM_RESCAN_VALUES);
}

bool state_load(const clap_plugin_t *p, const clap_istream_t *stream) {
    Plugin *pl = self(p);
    char magic[4];
    uint32_t version = 0, count = 0;
    if (!read_all(stream, magic, 4) || std::memcmp(magic, "AMSY", 4) || !read_all(stream, &version, 4) || version != 1 ||
        !read_all(stream, &count, 4) || count > ysfx_max_sliders)
        return false;
    std::vector<ysfx_state_slider_t> sliders(count);
    for (auto &s : sliders)
        if (!read_all(stream, &s.index, 4) || !read_all(stream, &s.value, 8)) return false;
    uint64_t size = 0;
    if (!read_all(stream, &size, 8) || size > (64u << 20)) return false;
    std::vector<uint8_t> data((size_t)size);
    if (size && !read_all(stream, data.data(), (size_t)size)) return false;
    ysfx_state_t st{sliders.data(), count, data.data(), (size_t)size};
    {
        std::lock_guard<std::mutex> guard(pl->mutex);
        if (!ysfx_load_state(pl->fx, &st)) return false;
    }
    after_state_change(pl);
    return true;
}

const clap_plugin_state_t kState = {state_save, state_load};

// ---- ports ---------------------------------------------------------------------------------

uint32_t audio_ports_count(const clap_plugin_t *p, bool isInput) {
    Plugin *pl = self(p);
    if (!pl->kind->instrument) return 1;
    return isInput ? (pl->sidechain ? 1 : 0) : (uint32_t)pl->outPorts.size();
}

bool audio_ports_get(const clap_plugin_t *p, uint32_t index, bool isInput, clap_audio_port_info_t *info) {
    Plugin *pl = self(p);
    std::memset(info, 0, sizeof(*info));
    info->in_place_pair = CLAP_INVALID_ID;
    info->channel_count = 2;
    info->port_type = CLAP_PORT_STEREO;
    if (!pl->kind->instrument) {
        if (index) return false;
        info->id = 0;
        info->flags = CLAP_AUDIO_PORT_IS_MAIN;
        info->in_place_pair = 0;
        std::snprintf(info->name, sizeof(info->name), isInput ? "Input" : "Output");
        return true;
    }
    if (isInput) {
        if (!pl->sidechain || index) return false;
        info->id = 100;
        std::snprintf(info->name, sizeof(info->name), "Sidechain");
        return true;
    }
    if (index >= pl->outPorts.size()) return false;
    info->id = index;
    info->flags = index == 0 ? CLAP_AUDIO_PORT_IS_MAIN : 0;
    info->channel_count = pl->outPorts[index].channels;
    info->port_type = info->channel_count == 2 ? CLAP_PORT_STEREO : CLAP_PORT_MONO;
    std::snprintf(info->name, sizeof(info->name), "%s", pl->outPorts[index].name.c_str());
    return true;
}

const clap_plugin_audio_ports_t kAudioPorts = {audio_ports_count, audio_ports_get};

uint32_t note_ports_count(const clap_plugin_t *p, bool isInput) { return isInput || !self(p)->kind->instrument ? 1 : 0; }

bool note_ports_get(const clap_plugin_t *p, uint32_t index, bool isInput, clap_note_port_info_t *info) {
    if (index >= note_ports_count(p, isInput)) return false;
    std::memset(info, 0, sizeof(*info));
    info->id = 0;
    info->supported_dialects = CLAP_NOTE_DIALECT_CLAP | CLAP_NOTE_DIALECT_MIDI;
    info->preferred_dialect = CLAP_NOTE_DIALECT_MIDI;
    std::snprintf(info->name, sizeof(info->name), isInput ? "MIDI In" : "MIDI Out");
    return true;
}

const clap_plugin_note_ports_t kNotePorts = {note_ports_count, note_ports_get};

// ---- presets (the embedded .rpl banks) -------------------------------------------------------

struct Bank {
    const Kind *kind;
    ysfx_bank_t *bank;
};

std::vector<Bank> &banks() {
    static std::vector<Bank> list;
    static std::once_flag once;
    std::call_once(once, [] {
        const fs::path dir = effects_dir();
        if (dir.empty()) return;
        for (const Kind &k : kKinds) {
            const fs::path rpl = dir / fs::u8path(std::string(k.file) + ".rpl");
            std::error_code ec;
            if (!fs::exists(rpl, ec)) continue;
            if (ysfx_bank_t *b = ysfx_load_bank(rpl.u8string().c_str())) list.push_back({&k, b});
        }
    });
    return list;
}

const ysfx_preset_t *find_preset(const Kind *kind, const char *name) {
    for (const Bank &b : banks())
        if (b.kind == kind)
            for (uint32_t i = 0; i < b.bank->preset_count; i++)
                if (!std::strcmp(b.bank->presets[i].name, name)) return &b.bank->presets[i];
    return nullptr;
}

bool preset_load_from_location(const clap_plugin_t *p, uint32_t kind, const char *, const char *key) {
    Plugin *pl = self(p);
    const ysfx_preset_t *preset = kind == CLAP_PRESET_DISCOVERY_LOCATION_PLUGIN && key ? find_preset(pl->kind, key) : nullptr;
    if (!preset) return false;
    {
        // presets leave the tuning sliders alone, like REAPER's .rpl
        std::lock_guard<std::mutex> guard(pl->mutex);
        if (!ysfx_load_state(pl->fx, preset->state)) return false;
    }
    after_state_change(pl);
    if (auto *hp = static_cast<const clap_host_preset_load_t *>(pl->host->get_extension(pl->host, CLAP_EXT_PRESET_LOAD)))
        hp->loaded(pl->host, kind, nullptr, key);
    return true;
}

const clap_plugin_preset_load_t kPresetLoad = {preset_load_from_location};

struct Provider {
    clap_preset_discovery_provider_t clap{};
    const clap_preset_discovery_indexer_t *indexer = nullptr;
};

const clap_preset_discovery_provider_descriptor_t kProviderDesc = {
    CLAP_VERSION_INIT, "com.github.lenqth.amisynth.presets", "AmiSynth presets", "AmiSynth"};

bool provider_init(const clap_preset_discovery_provider_t *p) {
    const auto *indexer = static_cast<Provider *>(p->provider_data)->indexer;
    const clap_preset_discovery_location_t loc{CLAP_PRESET_DISCOVERY_IS_FACTORY_CONTENT, "AmiSynth",
                                               CLAP_PRESET_DISCOVERY_LOCATION_PLUGIN, nullptr};
    return indexer->declare_location(indexer, &loc);
}

void provider_destroy(const clap_preset_discovery_provider_t *p) { delete static_cast<Provider *>(p->provider_data); }

bool provider_get_metadata(const clap_preset_discovery_provider_t *, uint32_t kind, const char *,
                           const clap_preset_discovery_metadata_receiver_t *r) {
    if (kind != CLAP_PRESET_DISCOVERY_LOCATION_PLUGIN) return false;
    for (const Bank &b : banks()) {
        for (uint32_t i = 0; i < b.bank->preset_count; i++) {
            const char *name = b.bank->presets[i].name;
            if (!r->begin_preset(r, name, name)) return true;
            const clap_universal_plugin_id_t id{"clap", b.kind->id};
            r->add_plugin_id(r, &id);
            r->set_flags(r, CLAP_PRESET_DISCOVERY_IS_FACTORY_CONTENT);
            // "Bass: Rubber Mono Bass" -> category "Bass"
            if (const char *colon = std::strstr(name, ": ")) r->add_feature(r, std::string(name, colon).c_str());
        }
    }
    return true;
}

const void *provider_get_extension(const clap_preset_discovery_provider_t *, const char *) { return nullptr; }

uint32_t pd_count(const clap_preset_discovery_factory_t *) { return 1; }
const clap_preset_discovery_provider_descriptor_t *pd_get_descriptor(const clap_preset_discovery_factory_t *, uint32_t index) {
    return index == 0 ? &kProviderDesc : nullptr;
}
const clap_preset_discovery_provider_t *pd_create(const clap_preset_discovery_factory_t *,
                                                  const clap_preset_discovery_indexer_t *indexer, const char *id) {
    if (std::strcmp(id, kProviderDesc.id)) return nullptr;
    auto *pr = new Provider;
    pr->indexer = indexer;
    pr->clap = {&kProviderDesc, pr, provider_init, provider_destroy, provider_get_metadata, provider_get_extension};
    return &pr->clap;
}

const clap_preset_discovery_factory_t kPresetFactory = {pd_count, pd_get_descriptor, pd_create};

// ---- plugin factory / entry ----------------------------------------------------------------

const void *plugin_get_extension(const clap_plugin_t *p, const char *id) {
    if (!std::strcmp(id, CLAP_EXT_PARAMS)) return &kParams;
    if (!std::strcmp(id, CLAP_EXT_STATE)) return &kState;
    if (!std::strcmp(id, CLAP_EXT_AUDIO_PORTS)) return &kAudioPorts;
    if (!std::strcmp(id, CLAP_EXT_NOTE_PORTS)) return &kNotePorts;
    if ((!std::strcmp(id, CLAP_EXT_PRESET_LOAD) || !std::strcmp(id, CLAP_EXT_PRESET_LOAD_COMPAT)) && self(p)->kind->instrument)
        return &kPresetLoad;
    return nullptr;
}

void plugin_on_main_thread(const clap_plugin_t *) {}

uint32_t factory_count(const clap_plugin_factory_t *) { return kKindCount; }
const clap_plugin_descriptor_t *factory_descriptor(const clap_plugin_factory_t *, uint32_t index) {
    return index < kKindCount ? &kDescriptors[index] : nullptr;
}

const clap_plugin_t *factory_create(const clap_plugin_factory_t *, const clap_host_t *host, const char *id) {
    if (!clap_version_is_compatible(host->clap_version)) return nullptr;
    const Kind *kind = kind_by_id(id);
    if (!kind) return nullptr;
    auto *pl = new Plugin;
    pl->host = host;
    pl->kind = kind;
    pl->clap.desc = &kDescriptors[kind - kKinds];
    pl->clap.plugin_data = pl;
    pl->clap.init = plugin_init;
    pl->clap.destroy = plugin_destroy;
    pl->clap.activate = plugin_activate;
    pl->clap.deactivate = plugin_deactivate;
    pl->clap.start_processing = plugin_start_processing;
    pl->clap.stop_processing = plugin_stop_processing;
    pl->clap.reset = plugin_reset;
    pl->clap.process = plugin_process;
    pl->clap.get_extension = plugin_get_extension;
    pl->clap.on_main_thread = plugin_on_main_thread;
    return &pl->clap;
}

const clap_plugin_factory_t kFactory = {factory_count, factory_descriptor, factory_create};

bool entry_init(const char *) {
    for (uint32_t i = 0; i < kKindCount; i++) {
        const Kind &k = kKinds[i];
        kDescriptors[i] = {CLAP_VERSION_INIT, k.id, k.name, "AmiSynth", "https://github.com/Lenqth/AmiSynth", "", "",
                           AMISYNTH_VERSION, k.description, k.features};
    }
    return true;
}

void entry_deinit() {}

const void *entry_get_factory(const char *id) {
    if (!std::strcmp(id, CLAP_PLUGIN_FACTORY_ID)) return &kFactory;
    if (!std::strcmp(id, CLAP_PRESET_DISCOVERY_FACTORY_ID) || !std::strcmp(id, CLAP_PRESET_DISCOVERY_FACTORY_ID_COMPAT))
        return &kPresetFactory;
    return nullptr;
}

} // namespace

extern "C" CLAP_EXPORT const clap_plugin_entry_t clap_entry = {CLAP_VERSION_INIT, entry_init, entry_deinit, entry_get_factory};
