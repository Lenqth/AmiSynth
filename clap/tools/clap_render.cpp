// Offline host for the AmiSynth CLAP plugin, a drop-in for jsfx/tools/jsfx_render: it reads the
// same script and writes the same raw float32 output, but loads the built AmiSynth.clap the way a
// DAW does (factory, params, note / MIDI events, transport, audio ports). tests/jsfx.test.js runs
// through it with `npm run test:clap`.
//
//   clap_render <file.jsfx> <samplerate> <seconds> <out.f32> [script]
//
// The JSFX file name picks the plugin (AmiSynth Synth.jsfx -> AmiSynth Synth). The plugin path is
// AMISYNTH_CLAP (default: .cache/clap-build/AmiSynth.clap). Script lines (see jsfx_render.cpp):
//   slider <index> <value> / var <name> <value> (ignored: every slider is a parameter here)
//   midi <frame> <status> <d1> <d2> / tempo <bpm> <playing> / dataroot <dir> / input <file.f32>
//   pre <file.jsfx> / preslider <index> <value> / preslider_at <frame> <index> <value>
//   printslider <index>
#include <clap/clap.h>
#include <algorithm>
#include <cmath>
#include <memory>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>
#include <vector>
#if defined(_WIN32)
#define NOMINMAX
#include <windows.h>
#else
#include <dlfcn.h>
#endif

namespace {

struct EventList {
    std::vector<std::vector<uint8_t>> events;
    clap_input_events_t in{this, size, get};
    clap_output_events_t out{this, try_push};
    static uint32_t size(const clap_input_events_t *l) { return (uint32_t)static_cast<const EventList *>(l->ctx)->events.size(); }
    static const clap_event_header_t *get(const clap_input_events_t *l, uint32_t i) {
        return reinterpret_cast<const clap_event_header_t *>(static_cast<const EventList *>(l->ctx)->events[i].data());
    }
    static bool try_push(const clap_output_events_t *l, const clap_event_header_t *h) {
        auto *self = static_cast<EventList *>(l->ctx);
        const auto *p = reinterpret_cast<const uint8_t *>(h);
        self->events.emplace_back(p, p + h->size);
        return true;
    }
    void param(uint32_t time, clap_id id, double value) {
        clap_event_param_value_t ev{};
        ev.header = {sizeof(ev), time, CLAP_CORE_EVENT_SPACE_ID, CLAP_EVENT_PARAM_VALUE, 0};
        ev.param_id = id; ev.note_id = -1; ev.port_index = -1; ev.channel = -1; ev.key = -1; ev.value = value;
        try_push(&out, &ev.header);
    }
    void midi(uint32_t time, const uint8_t data[3]) {
        clap_event_midi_t ev{};
        ev.header = {sizeof(ev), time, CLAP_CORE_EVENT_SPACE_ID, CLAP_EVENT_MIDI, 0};
        std::memcpy(ev.data, data, 3);
        try_push(&out, &ev.header);
    }
};

const void *host_get_extension(const clap_host_t *, const char *) { return nullptr; }
void host_noop(const clap_host_t *) {}
const clap_host_t kHost = {CLAP_VERSION_INIT, nullptr, "clap_render", "AmiSynth", "", "1.0",
                           host_get_extension, host_noop, host_noop, host_noop};

struct Instance {
    const clap_plugin_t *plugin = nullptr;
    const clap_plugin_params_t *params = nullptr;
    const clap_plugin_audio_ports_t *ports = nullptr;
    std::vector<uint32_t> outChannels, inChannels;
};

Instance create(const clap_plugin_factory_t *factory, const std::string &jsfx, double sr, uint32_t block) {
    std::string base = jsfx.substr(jsfx.find_last_of("/\\") + 1);
    if (base.size() > 5 && base.compare(base.size() - 5, 5, ".jsfx") == 0) base.resize(base.size() - 5);
    Instance in;
    for (uint32_t i = 0; i < factory->get_plugin_count(factory); i++) {
        const clap_plugin_descriptor_t *d = factory->get_plugin_descriptor(factory, i);
        if (base == d->name) in.plugin = factory->create_plugin(factory, &kHost, d->id);
    }
    if (!in.plugin || !in.plugin->init(in.plugin)) {
        std::fprintf(stderr, "cannot create plugin for %s\n", jsfx.c_str());
        std::exit(1);
    }
    in.params = static_cast<const clap_plugin_params_t *>(in.plugin->get_extension(in.plugin, CLAP_EXT_PARAMS));
    in.ports = static_cast<const clap_plugin_audio_ports_t *>(in.plugin->get_extension(in.plugin, CLAP_EXT_AUDIO_PORTS));
    for (int input = 0; input < 2; input++) {
        auto &list = input ? in.inChannels : in.outChannels;
        for (uint32_t i = 0; i < in.ports->count(in.plugin, input); i++) {
            clap_audio_port_info_t info{};
            in.ports->get(in.plugin, i, input, &info);
            list.push_back(info.channel_count);
        }
    }
    if (!in.plugin->activate(in.plugin, sr, 1, block) || !in.plugin->start_processing(in.plugin)) std::exit(1);
    return in;
}

struct Buffers {
    std::vector<std::vector<float>> data;
    std::vector<std::vector<float *>> ptrs;
    std::vector<clap_audio_buffer_t> bufs;
    Buffers(const std::vector<uint32_t> &channels, uint32_t block) {
        for (uint32_t c : channels) {
            ptrs.emplace_back();
            for (uint32_t k = 0; k < c; k++) data.emplace_back(block, 0.0f);
        }
        size_t d = 0;
        for (size_t p = 0; p < channels.size(); p++)
            for (uint32_t k = 0; k < channels[p]; k++) ptrs[p].push_back(data[d++].data());
        for (size_t p = 0; p < channels.size(); p++) bufs.push_back({ptrs[p].data(), nullptr, channels[p], 0, 0});
    }
};

} // namespace

int main(int argc, char **argv) {
    if (argc < 5) {
        std::fprintf(stderr, "usage: %s file.jsfx samplerate seconds out.f32 [script]\n", argv[0]);
        return 2;
    }
    const std::string path = argv[1];
    const double sr = std::atof(argv[2]);
    const double seconds = std::atof(argv[3]);
    const char *outPath = argv[4];

    struct Ev { uint64_t frame; uint8_t data[3]; };
    struct Timed { uint64_t frame; int idx; double value; };
    std::vector<std::pair<int, double>> sliders, preSliders;
    std::vector<Timed> preTimed;
    std::vector<Ev> events;
    std::vector<int> printSliders;
    std::vector<float> sidechain;
    double tempo = 120;
    int playing = 0;
    std::string prePath;
    if (argc > 5) {
        FILE *f = std::fopen(argv[5], "r");
        if (!f) { std::perror("script"); return 2; }
        char line[4096];
        while (std::fgets(line, sizeof line, f)) {
            char kind[32] = {0};
            if (std::sscanf(line, "%31s", kind) != 1) continue;
            int i; double v; unsigned long long fr; unsigned s, a, b;
            if (!std::strcmp(kind, "slider") && std::sscanf(line, "%*s %d %lf", &i, &v) == 2) sliders.push_back({i, v});
            else if (!std::strcmp(kind, "preslider") && std::sscanf(line, "%*s %d %lf", &i, &v) == 2) preSliders.push_back({i, v});
            else if (!std::strcmp(kind, "preslider_at") && std::sscanf(line, "%*s %llu %d %lf", &fr, &i, &v) == 3) preTimed.push_back({fr, i, v});
            else if (!std::strcmp(kind, "printslider") && std::sscanf(line, "%*s %d", &i) == 1) printSliders.push_back(i);
            else if (!std::strcmp(kind, "tempo")) std::sscanf(line, "%*s %lf %d", &tempo, &playing);
            else if (!std::strcmp(kind, "midi") && std::sscanf(line, "%*s %llu %u %u %u", &fr, &s, &a, &b) == 4)
                events.push_back({fr, {(uint8_t)s, (uint8_t)a, (uint8_t)b}});
            else if (!std::strcmp(kind, "dataroot") || !std::strcmp(kind, "pre") || !std::strcmp(kind, "input")) {
                const char *rest = line + std::strlen(kind);
                while (*rest == ' ') rest++;
                std::string value(rest);
                while (!value.empty() && (value.back() == '\n' || value.back() == '\r')) value.pop_back();
                if (!std::strcmp(kind, "pre")) prePath = value;
                else if (!std::strcmp(kind, "dataroot")) {
#if defined(_WIN32)
                    _putenv_s("AMISYNTH_DATA_DIR", value.c_str());
#else
                    setenv("AMISYNTH_DATA_DIR", value.c_str(), 1);
#endif
                } else {
                    FILE *in = std::fopen(value.c_str(), "rb");
                    if (!in) { std::perror("input"); return 2; }
                    float buf[1024];
                    size_t n;
                    while ((n = std::fread(buf, sizeof(float), 1024, in)) > 0) sidechain.insert(sidechain.end(), buf, buf + n);
                    std::fclose(in);
                }
            }
        }
        std::fclose(f);
    }
    std::stable_sort(events.begin(), events.end(), [](const Ev &x, const Ev &y) { return x.frame < y.frame; });

    const char *clapPath = std::getenv("AMISYNTH_CLAP");
    const std::string lib = clapPath ? clapPath : ".cache/clap-build/AmiSynth.clap";
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
    if (!entry || !entry->init(lib.c_str())) { std::fprintf(stderr, "cannot load %s\n", lib.c_str()); return 1; }
    auto *factory = static_cast<const clap_plugin_factory_t *>(entry->get_factory(CLAP_PLUGIN_FACTORY_ID));

    const uint32_t block = 128;
    Instance pre;
    if (!prePath.empty()) pre = create(factory, prePath, sr, block);
    Instance fx = create(factory, path, sr, block);

    Buffers outs(fx.outChannels, block), ins(fx.inChannels, block);
    std::unique_ptr<Buffers> preIn, preOut;
    if (pre.plugin) { preIn.reset(new Buffers(pre.inChannels, block)); preOut.reset(new Buffers(pre.outChannels, block)); }
    uint32_t nout = 0;
    for (uint32_t c : fx.outChannels) nout += c;
    nout = std::max<uint32_t>(nout, 2);

    const uint64_t total = (uint64_t)(seconds * sr);
    std::vector<float> out;
    out.reserve(total * nout);
    size_t ei = 0;
    for (uint64_t pos = 0; pos < total; pos += block) {
        const uint32_t n = (uint32_t)std::min<uint64_t>(block, total - pos);
        clap_event_transport_t tr{};
        tr.header = {sizeof(tr), 0, CLAP_CORE_EVENT_SPACE_ID, CLAP_EVENT_TRANSPORT, 0};
        tr.flags = CLAP_TRANSPORT_HAS_TEMPO | CLAP_TRANSPORT_HAS_BEATS_TIMELINE | CLAP_TRANSPORT_HAS_SECONDS_TIMELINE |
                   CLAP_TRANSPORT_HAS_TIME_SIGNATURE | (playing ? CLAP_TRANSPORT_IS_PLAYING : 0);
        tr.tempo = tempo;
        tr.song_pos_beats = (clap_beattime)std::llround((double)pos * tempo / 60 / sr * CLAP_BEATTIME_FACTOR);
        tr.song_pos_seconds = (clap_sectime)std::llround((double)pos / sr * CLAP_SECTIME_FACTOR);
        tr.tsig_num = 4;
        tr.tsig_denom = 4;

        if (pre.plugin) {
            EventList pin, pout;
            if (pos == 0) for (auto &s : preSliders) pin.param(0, (clap_id)(s.first - 1), s.second);
            for (auto &t : preTimed)
                if (t.frame >= pos && t.frame < pos + n) pin.param(0, (clap_id)(t.idx - 1), t.value);
            clap_process_t p{};
            p.steady_time = (int64_t)pos; p.frames_count = n; p.transport = &tr;
            p.audio_inputs = preIn->bufs.data(); p.audio_inputs_count = (uint32_t)preIn->bufs.size();
            p.audio_outputs = preOut->bufs.data(); p.audio_outputs_count = (uint32_t)preOut->bufs.size();
            p.in_events = &pin.in; p.out_events = &pout.out;
            pre.plugin->process(pre.plugin, &p);
        }

        EventList in, evOut;
        if (pos == 0) for (auto &s : sliders) in.param(0, (clap_id)(s.first - 1), s.second);
        while (ei < events.size() && events[ei].frame < pos + n) {
            in.midi((uint32_t)(events[ei].frame > pos ? events[ei].frame - pos : 0), events[ei].data);
            ei++;
        }
        if (!ins.bufs.empty())
            for (uint32_t i = 0; i < n; i++) {
                const size_t k = 2 * (size_t)(pos + i);
                ins.ptrs[0][0][i] = k + 1 < sidechain.size() ? sidechain[k] : 0.0f;
                ins.ptrs[0][1][i] = k + 1 < sidechain.size() ? sidechain[k + 1] : 0.0f;
            }
        clap_process_t p{};
        p.steady_time = (int64_t)pos; p.frames_count = n; p.transport = &tr;
        p.audio_inputs = ins.bufs.data(); p.audio_inputs_count = (uint32_t)ins.bufs.size();
        p.audio_outputs = outs.bufs.data(); p.audio_outputs_count = (uint32_t)outs.bufs.size();
        p.in_events = &in.in; p.out_events = &evOut.out;
        fx.plugin->process(fx.plugin, &p);
        for (uint32_t i = 0; i < n; i++)
            for (uint32_t c = 0; c < nout; c++) out.push_back(c < outs.data.size() ? outs.data[c][i] : 0.0f);
    }
    FILE *o = std::fopen(outPath, "wb");
    std::fwrite(out.data(), sizeof(float), out.size(), o);
    std::fclose(o);
    for (int idx : printSliders) {
        double v = 0;
        fx.params->get_value(fx.plugin, (clap_id)(idx - 1), &v);
        std::printf("slider%d %.17g\n", idx, v);
    }
    for (Instance *i : {&fx, &pre})
        if (i->plugin) { i->plugin->stop_processing(i->plugin); i->plugin->deactivate(i->plugin); i->plugin->destroy(i->plugin); }
    entry->deinit();
    return 0;
}
