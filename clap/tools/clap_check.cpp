// Checks the parts of the AmiSynth CLAP plugin that clap_render does not reach, and prints them
// as JSON for tests/clap.test.js: descriptors, parameter info, audio / note ports, a state
// round trip, preset discovery and preset loading, CLAP-dialect notes, and Tuning passing notes on.
//
//   clap_check <AmiSynth.clap> [preset name to load into AmiSynth Synth]
#include <clap/clap.h>
#include <algorithm>
#include <cmath>
#include <cstdlib>
#include <cstdio>
#include <cstring>
#include <string>
#include <vector>
#if defined(_WIN32)
#include <windows.h>
#else
#include <dlfcn.h>
#endif

namespace {

std::string json(const char *s) {
    std::string out = "\"";
    for (; *s; s++) {
        if (*s == '"' || *s == '\\') out += '\\';
        out += *s;
    }
    return out + "\"";
}

struct EventList {
    std::vector<std::vector<uint8_t>> events;
    clap_input_events_t in{this, size, get};
    clap_output_events_t out{this, try_push};
    static uint32_t size(const clap_input_events_t *l) { return (uint32_t)static_cast<const EventList *>(l->ctx)->events.size(); }
    static const clap_event_header_t *get(const clap_input_events_t *l, uint32_t i) {
        return reinterpret_cast<const clap_event_header_t *>(static_cast<const EventList *>(l->ctx)->events[i].data());
    }
    static bool try_push(const clap_output_events_t *l, const clap_event_header_t *h) {
        const auto *p = reinterpret_cast<const uint8_t *>(h);
        static_cast<EventList *>(l->ctx)->events.emplace_back(p, p + h->size);
        return true;
    }
    template <class T> void push(const T &ev) { try_push(&out, &ev.header); }
};

const void *host_get_extension(const clap_host_t *, const char *) { return nullptr; }
void host_noop(const clap_host_t *) {}
const clap_host_t kHost = {CLAP_VERSION_INIT, nullptr, "clap_check", "AmiSynth", "", "1.0",
                           host_get_extension, host_noop, host_noop, host_noop};

const clap_plugin_factory_t *g_factory;

const clap_plugin_t *create(const char *id) {
    const clap_plugin_t *p = g_factory->create_plugin(g_factory, &kHost, id);
    if (!p || !p->init(p)) {
        std::fprintf(stderr, "cannot create %s\n", id);
        std::exit(1);
    }
    return p;
}

template <class T> const T *ext(const clap_plugin_t *p, const char *id) { return static_cast<const T *>(p->get_extension(p, id)); }

void destroy(const clap_plugin_t *p) { p->destroy(p); }

struct Buffer {
    std::vector<uint8_t> bytes;
    size_t pos = 0;
    clap_ostream_t out{this, write};
    clap_istream_t in{this, read};
    static int64_t write(const clap_ostream_t *s, const void *data, uint64_t size) {
        auto *b = static_cast<Buffer *>(s->ctx);
        b->bytes.insert(b->bytes.end(), (const uint8_t *)data, (const uint8_t *)data + size);
        return (int64_t)size;
    }
    static int64_t read(const clap_istream_t *s, void *data, uint64_t size) {
        auto *b = static_cast<Buffer *>(s->ctx);
        const size_t n = std::min<size_t>((size_t)size, b->bytes.size() - b->pos);
        std::memcpy(data, b->bytes.data() + b->pos, n);
        b->pos += n;
        return (int64_t)n;
    }
};

void set_param(const clap_plugin_t *p, clap_id id, double value) {
    EventList in, out;
    clap_event_param_value_t ev{};
    ev.header = {sizeof(ev), 0, CLAP_CORE_EVENT_SPACE_ID, CLAP_EVENT_PARAM_VALUE, 0};
    ev.param_id = id; ev.note_id = -1; ev.port_index = -1; ev.channel = -1; ev.key = -1; ev.value = value;
    in.push(ev);
    ext<clap_plugin_params_t>(p, CLAP_EXT_PARAMS)->flush(p, &in.in, &out.out);
}

// renders 0.25 s of one note sent as a CLAP note or as MIDI; returns the left channel
std::vector<float> render_note(const char *id, bool clapDialect) {
    const clap_plugin_t *p = create(id);
    const uint32_t block = 128;
    p->activate(p, 48000, 1, block);
    p->start_processing(p);
    std::vector<float> l(block), r(block), result;
    float *chans[2] = {l.data(), r.data()};
    clap_audio_buffer_t outBuf{chans, nullptr, 2, 0, 0};
    for (int b = 0; b < 94; b++) {
        EventList in, out;
        if (b == 0 || b == 60) {
            const bool on = b == 0;
            if (clapDialect) {
                clap_event_note_t ev{};
                ev.header = {sizeof(ev), 5, CLAP_CORE_EVENT_SPACE_ID, uint16_t(on ? CLAP_EVENT_NOTE_ON : CLAP_EVENT_NOTE_OFF), 0};
                ev.note_id = -1; ev.port_index = 0; ev.channel = 0; ev.key = 60; ev.velocity = on ? 100 / 127.0 : 0;
                in.push(ev);
            } else {
                clap_event_midi_t ev{};
                ev.header = {sizeof(ev), 5, CLAP_CORE_EVENT_SPACE_ID, CLAP_EVENT_MIDI, 0};
                ev.data[0] = on ? 0x90 : 0x80; ev.data[1] = 60; ev.data[2] = on ? 100 : 0;
                in.push(ev);
            }
        }
        clap_process_t proc{};
        proc.frames_count = block;
        proc.audio_outputs = &outBuf;
        proc.audio_outputs_count = 1;
        proc.in_events = &in.in;
        proc.out_events = &out.out;
        p->process(p, &proc);
        result.insert(result.end(), l.begin(), l.end());
    }
    destroy(p);
    return result;
}

} // namespace

int main(int argc, char **argv) {
    if (argc < 2) return 2;
    std::string lib = argv[1];
#if defined(_WIN32)
    HMODULE h = LoadLibraryA(lib.c_str());
    auto *entry = h ? reinterpret_cast<const clap_plugin_entry_t *>(GetProcAddress(h, "clap_entry")) : nullptr;
#else
    std::string binary = lib;
#if defined(__APPLE__)
    binary += "/Contents/MacOS/AmiSynth";
#endif
    void *h = dlopen(binary.c_str(), RTLD_NOW | RTLD_LOCAL);
    auto *entry = h ? static_cast<const clap_plugin_entry_t *>(dlsym(h, "clap_entry")) : nullptr;
#endif
    if (!entry || !entry->init(lib.c_str())) return 1;
    g_factory = static_cast<const clap_plugin_factory_t *>(entry->get_factory(CLAP_PLUGIN_FACTORY_ID));

    std::printf("{\"plugins\":[");
    for (uint32_t i = 0; i < g_factory->get_plugin_count(g_factory); i++) {
        const clap_plugin_descriptor_t *d = g_factory->get_plugin_descriptor(g_factory, i);
        const clap_plugin_t *p = create(d->id);
        std::printf("%s{\"id\":%s,\"name\":%s,\"version\":%s,\"features\":[", i ? "," : "", json(d->id).c_str(), json(d->name).c_str(),
                    json(d->version).c_str());
        for (const char *const *f = d->features; *f; f++) std::printf("%s%s", f == d->features ? "" : ",", json(*f).c_str());
        std::printf("],\"params\":[");
        const auto *params = ext<clap_plugin_params_t>(p, CLAP_EXT_PARAMS);
        for (uint32_t k = 0; k < params->count(p); k++) {
            clap_param_info_t info{};
            params->get_info(p, k, &info);
            double value = 0;
            params->get_value(p, info.id, &value);
            char text[256] = "";
            params->value_to_text(p, info.id, info.default_value, text, sizeof text);
            double back = NAN;
            params->text_to_value(p, info.id, text, &back);
            std::printf("%s{\"id\":%u,\"name\":%s,\"module\":%s,\"min\":%.17g,\"max\":%.17g,\"default\":%.17g,\"value\":%.17g,"
                        "\"flags\":%u,\"text\":%s,\"textValue\":%.17g}",
                        k ? "," : "", info.id, json(info.name).c_str(), json(info.module).c_str(), info.min_value, info.max_value,
                        info.default_value, value, info.flags, json(text).c_str(), back);
        }
        std::printf("],\"audioPorts\":{");
        const auto *ports = ext<clap_plugin_audio_ports_t>(p, CLAP_EXT_AUDIO_PORTS);
        for (int input = 1; input >= 0; input--) {
            std::printf("%s\"%s\":[", input ? "" : ",", input ? "in" : "out");
            for (uint32_t k = 0; k < ports->count(p, input); k++) {
                clap_audio_port_info_t info{};
                ports->get(p, k, input, &info);
                std::printf("%s{\"name\":%s,\"channels\":%u,\"main\":%s}", k ? "," : "", json(info.name).c_str(), info.channel_count,
                            (info.flags & CLAP_AUDIO_PORT_IS_MAIN) ? "true" : "false");
            }
            std::printf("]");
        }
        const auto *notes = ext<clap_plugin_note_ports_t>(p, CLAP_EXT_NOTE_PORTS);
        std::printf("},\"notePorts\":{\"in\":%u,\"out\":%u},\"presetLoad\":%s}", notes->count(p, true), notes->count(p, false),
                    p->get_extension(p, CLAP_EXT_PRESET_LOAD) ? "true" : "false");
        destroy(p);
    }
    std::printf("]");

    // state round trip: a changed value comes back in a new instance
    {
        const clap_plugin_t *a = create("com.github.lenqth.amisynth.synth");
        set_param(a, 18, 2345); // filter cutoff
        Buffer buf;
        const bool saved = ext<clap_plugin_state_t>(a, CLAP_EXT_STATE)->save(a, &buf.out);
        const clap_plugin_t *b = create("com.github.lenqth.amisynth.synth");
        const bool loaded = ext<clap_plugin_state_t>(b, CLAP_EXT_STATE)->load(b, &buf.in);
        double va = 0, vb = 0;
        ext<clap_plugin_params_t>(a, CLAP_EXT_PARAMS)->get_value(a, 18, &va);
        ext<clap_plugin_params_t>(b, CLAP_EXT_PARAMS)->get_value(b, 18, &vb);
        std::printf(",\"state\":{\"saved\":%s,\"loaded\":%s,\"before\":%.17g,\"after\":%.17g}", saved ? "true" : "false",
                    loaded ? "true" : "false", va, vb);
        destroy(a);
        destroy(b);
    }

    // preset discovery: every preset of the embedded .rpl banks, by plugin id
    {
        struct Collected { std::string name, key, plugin; std::vector<std::string> features; };
        static std::vector<Collected> presets;
        static int locations = 0;
        auto *pf = static_cast<const clap_preset_discovery_factory_t *>(entry->get_factory(CLAP_PRESET_DISCOVERY_FACTORY_ID));
        clap_preset_discovery_indexer_t indexer{};
        indexer.clap_version = CLAP_VERSION;
        indexer.name = "clap_check";
        indexer.declare_filetype = [](const clap_preset_discovery_indexer_t *, const clap_preset_discovery_filetype_t *) { return true; };
        indexer.declare_location = [](const clap_preset_discovery_indexer_t *, const clap_preset_discovery_location_t *) {
            locations++;
            return true;
        };
        indexer.declare_soundpack = [](const clap_preset_discovery_indexer_t *, const clap_preset_discovery_soundpack_t *) { return true; };
        indexer.get_extension = [](const clap_preset_discovery_indexer_t *, const char *) -> const void * { return nullptr; };
        const auto *desc = pf->get_descriptor(pf, 0);
        const clap_preset_discovery_provider_t *prov = pf->create(pf, &indexer, desc->id);
        prov->init(prov);
        clap_preset_discovery_metadata_receiver_t r{};
        r.on_error = [](const clap_preset_discovery_metadata_receiver_t *, int32_t, const char *) {};
        r.begin_preset = [](const clap_preset_discovery_metadata_receiver_t *, const char *name, const char *key) {
            presets.push_back({name, key ? key : "", "", {}});
            return true;
        };
        r.add_plugin_id = [](const clap_preset_discovery_metadata_receiver_t *, const clap_universal_plugin_id_t *id) {
            presets.back().plugin = id->id;
        };
        r.set_soundpack_id = [](const clap_preset_discovery_metadata_receiver_t *, const char *) {};
        r.set_flags = [](const clap_preset_discovery_metadata_receiver_t *, uint32_t) {};
        r.add_creator = [](const clap_preset_discovery_metadata_receiver_t *, const char *) {};
        r.set_description = [](const clap_preset_discovery_metadata_receiver_t *, const char *) {};
        r.set_timestamps = [](const clap_preset_discovery_metadata_receiver_t *, clap_timestamp, clap_timestamp) {};
        r.add_feature = [](const clap_preset_discovery_metadata_receiver_t *, const char *f) { presets.back().features.push_back(f); };
        r.add_extra_info = [](const clap_preset_discovery_metadata_receiver_t *, const char *, const char *) {};
        prov->get_metadata(prov, CLAP_PRESET_DISCOVERY_LOCATION_PLUGIN, nullptr, &r);
        prov->destroy(prov);
        std::printf(",\"presetLocations\":%d,\"presets\":[", locations);
        for (size_t k = 0; k < presets.size(); k++)
            std::printf("%s{\"name\":%s,\"key\":%s,\"plugin\":%s,\"features\":[%s]}", k ? "," : "", json(presets[k].name.c_str()).c_str(),
                        json(presets[k].key.c_str()).c_str(), json(presets[k].plugin.c_str()).c_str(),
                        presets[k].features.empty() ? "" : json(presets[k].features[0].c_str()).c_str());
        std::printf("]");
    }

    // preset load into AmiSynth Synth: all parameter values afterwards
    if (argc > 2) {
        const clap_plugin_t *p = create("com.github.lenqth.amisynth.synth");
        const auto *pl = ext<clap_plugin_preset_load_t>(p, CLAP_EXT_PRESET_LOAD);
        const bool ok = pl->from_location(p, CLAP_PRESET_DISCOVERY_LOCATION_PLUGIN, nullptr, argv[2]);
        std::printf(",\"presetLoaded\":%s,\"presetValues\":[", ok ? "true" : "false");
        const auto *params = ext<clap_plugin_params_t>(p, CLAP_EXT_PARAMS);
        for (uint32_t k = 0; k < params->count(p); k++) {
            clap_param_info_t info{};
            params->get_info(p, k, &info);
            double v = 0;
            params->get_value(p, info.id, &v);
            std::printf("%s%.17g", k ? "," : "", v);
        }
        std::printf("]");
        destroy(p);
    }

    // a CLAP note on / off sounds exactly like the same MIDI note
    {
        const std::vector<float> a = render_note("com.github.lenqth.amisynth.synth", true);
        const std::vector<float> b = render_note("com.github.lenqth.amisynth.synth", false);
        double maxDiff = 0, peak = 0;
        for (size_t k = 0; k < a.size(); k++) {
            maxDiff = std::max(maxDiff, (double)std::fabs(a[k] - b[k]));
            peak = std::max(peak, (double)std::fabs(b[k]));
        }
        std::printf(",\"clapNotes\":{\"peak\":%.17g,\"maxDiff\":%.17g}", peak, maxDiff);
    }

    // AmiSynth Tuning passes notes on
    {
        const clap_plugin_t *p = create("com.github.lenqth.amisynth.tuning");
        p->activate(p, 48000, 1, 128);
        p->start_processing(p);
        std::vector<float> l(128), r(128);
        float *chans[2] = {l.data(), r.data()};
        clap_audio_buffer_t inBuf{chans, nullptr, 2, 0, 0}, outBuf{chans, nullptr, 2, 0, 0};
        EventList in, out;
        clap_event_note_t ev{};
        ev.header = {sizeof(ev), 3, CLAP_CORE_EVENT_SPACE_ID, CLAP_EVENT_NOTE_ON, 0};
        ev.note_id = 7; ev.port_index = 0; ev.channel = 0; ev.key = 64; ev.velocity = 0.5;
        in.push(ev);
        l[0] = 0.25f;
        clap_process_t proc{};
        proc.frames_count = 128;
        proc.audio_inputs = &inBuf; proc.audio_inputs_count = 1;
        proc.audio_outputs = &outBuf; proc.audio_outputs_count = 1;
        proc.in_events = &in.in; proc.out_events = &out.out;
        p->process(p, &proc);
        int notes = 0;
        for (auto &e : out.events) {
            const auto *hdr = reinterpret_cast<const clap_event_header_t *>(e.data());
            if (hdr->type == CLAP_EVENT_NOTE_ON && reinterpret_cast<const clap_event_note_t *>(hdr)->key == 64 && hdr->time == 3) notes++;
        }
        std::printf(",\"tuningPassesNotes\":%d,\"tuningPassesAudio\":%s", notes, l[0] == 0.25f ? "true" : "false");
        destroy(p);
    }
    std::printf("}\n");
    entry->deinit();
    return 0;
}
