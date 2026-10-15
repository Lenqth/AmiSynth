// Offline JSFX renderer for testing AmiSynth's EEL2 port against the JS DSP.
// Built on ysfx (https://github.com/jpcima/ysfx). See jsfx/README.md.
//
//   jsfx_render <file.jsfx> <samplerate> <seconds> <out.f32> [script]
//
// script lines (stdin-like text file):
//   slider <index 1-based> <value>
//   var <name> <value>        set a variable by name before @init/@slider (works for
//                             sliders beyond ysfx's 64-slider limit; REAPER allows 256)
//   midi <frame> <status> <d1> <d2>
//   tempo <bpm> <playing 0|1>  host tempo; while playing, beat_position = frame * bpm / 60 / sr
//                             at the start of each block (default: 120 bpm, stopped)
//   dataroot <dir>            REAPER's Data folder (where file_open("...") looks)
//   pre <file.jsfx>           another JSFX run before the main one in every block (its audio
//                             output is dropped); it shares gmem with the main one
//   preslider <index> <value>             a slider of the pre JSFX
//   preslider_at <frame> <index> <value>  change it at the start of the block holding <frame>
//                                         (use multiples of the 128-frame block)
//   printslider <index>       after rendering, print "slider<index> <value>" to stdout
// Output: interleaved float32 (raw), one channel per out_pin (2 for the synth, 10 for the drums).
#include "ysfx.h"
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>
#include <vector>
#include <algorithm>

struct Ev { uint64_t frame; uint8_t data[3]; };

static void log_reporter(intptr_t, ysfx_log_level level, const char *msg) {
    std::fprintf(stderr, "[ysfx %s] %s\n", ysfx_log_level_string(level), msg);
}

int main(int argc, char **argv) {
    if (argc < 5) {
        std::fprintf(stderr, "usage: %s file.jsfx samplerate seconds out.f32 [script]\n", argv[0]);
        return 2;
    }
    const char *path = argv[1];
    double sr = std::atof(argv[2]);
    double seconds = std::atof(argv[3]);
    const char *outPath = argv[4];

    std::vector<std::pair<int, double>> sliders;
    std::vector<std::pair<std::string, double>> vars;
    std::vector<Ev> events;
    double tempo = 120;
    int playing = 0;
    std::string dataRoot;
    std::string prePath;
    std::vector<std::pair<int, double>> preSliders;
    struct TimedSlider { uint64_t frame; int idx; double value; };
    std::vector<TimedSlider> preTimed;
    std::vector<int> printSliders;
    if (argc > 5) {
        FILE *f = std::fopen(argv[5], "r");
        if (!f) { std::perror("script"); return 2; }
        char line[512];
        while (std::fgets(line, sizeof line, f)) {
            char kind[32];
            if (std::sscanf(line, "%31s", kind) != 1) continue;
            if (!std::strcmp(kind, "slider")) {
                int idx; double v;
                if (std::sscanf(line, "%*s %d %lf", &idx, &v) == 2) sliders.push_back({idx, v});
            } else if (!std::strcmp(kind, "var")) {
                char name[256]; double v;
                if (std::sscanf(line, "%*s %255s %lf", name, &v) == 2) vars.push_back({name, v});
            } else if (!std::strcmp(kind, "dataroot")) {
                char dir[1024];
                if (std::sscanf(line, "%*s %1023[^\r\n]", dir) == 1) {
                    dataRoot = dir;
                    if (!dataRoot.empty() && dataRoot.back() != '/' && dataRoot.back() != '\\') dataRoot += '/';
                }
            } else if (!std::strcmp(kind, "pre")) {
                char file[1024];
                if (std::sscanf(line, "%*s %1023[^\r\n]", file) == 1) prePath = file;
            } else if (!std::strcmp(kind, "preslider")) {
                int idx; double v;
                if (std::sscanf(line, "%*s %d %lf", &idx, &v) == 2) preSliders.push_back({idx, v});
            } else if (!std::strcmp(kind, "preslider_at")) {
                unsigned long long fr; int idx; double v;
                if (std::sscanf(line, "%*s %llu %d %lf", &fr, &idx, &v) == 3) preTimed.push_back({fr, idx, v});
            } else if (!std::strcmp(kind, "printslider")) {
                int idx;
                if (std::sscanf(line, "%*s %d", &idx) == 1) printSliders.push_back(idx);
            } else if (!std::strcmp(kind, "tempo")) {
                std::sscanf(line, "%*s %lf %d", &tempo, &playing);
            } else if (!std::strcmp(kind, "midi")) {
                unsigned long long fr; unsigned s, a, b;
                if (std::sscanf(line, "%*s %llu %u %u %u", &fr, &s, &a, &b) == 4)
                    events.push_back({fr, {(uint8_t)s, (uint8_t)a, (uint8_t)b}});
            }
        }
        std::fclose(f);
    }
    std::stable_sort(events.begin(), events.end(), [](const Ev &a, const Ev &b) { return a.frame < b.frame; });

    const uint32_t block = 128;
    auto open = [&](const char *file) -> ysfx_t * {
        ysfx_config_t *config = ysfx_config_new();
        ysfx_set_log_reporter(config, &log_reporter);
        ysfx_guess_file_roots(config, file);
        if (!dataRoot.empty()) ysfx_set_data_root(config, dataRoot.c_str());
        ysfx_t *f = ysfx_new(config);
        ysfx_config_free(config);
        if (!ysfx_load_file(f, file, 0)) { std::fprintf(stderr, "load failed: %s\n", file); return nullptr; }
        if (!ysfx_compile(f, ysfx_compile_no_gfx)) { std::fprintf(stderr, "compile failed: %s\n", file); return nullptr; }
        ysfx_set_sample_rate(f, sr);
        ysfx_set_block_size(f, block);
        return f;
    };

    // the "pre" effect (e.g. AmiSynth Tuning) runs before the main one in every block and shares
    // its gmem with it (EEL2's shared memory is per process), like two FX in one REAPER project
    ysfx_t *pre = nullptr;
    if (!prePath.empty()) {
        if (!(pre = open(prePath.c_str()))) return 1;
        ysfx_init(pre);
        for (auto &s : preSliders) ysfx_slider_set_value(pre, (uint32_t)(s.first - 1), s.second);
    }

    ysfx_t *fx = open(path);
    if (!fx) return 1;
    for (auto &v : vars) {
        ysfx_real *p = ysfx_find_var(fx, v.first.c_str());
        if (p) *p = v.second;
        else std::fprintf(stderr, "unknown variable: %s\n", v.first.c_str());
    }
    ysfx_init(fx);
    for (auto &s : sliders) ysfx_slider_set_value(fx, (uint32_t)(s.first - 1), s.second);

    uint64_t total = (uint64_t)(seconds * sr);
    const uint32_t nout = std::max<uint32_t>(2, ysfx_get_num_outputs(fx));
    std::vector<std::vector<float>> bufs(nout, std::vector<float>(block));
    std::vector<float *> outs(nout);
    for (uint32_t c = 0; c < nout; c++) outs[c] = bufs[c].data();
    std::vector<float> out;
    out.reserve(total * nout);
    std::vector<float> zero(block, 0.0f);
    const float *ins[2] = {zero.data(), zero.data()};
    size_t ei = 0;
    for (uint64_t pos = 0; pos < total; pos += block) {
        uint32_t n = (uint32_t)std::min<uint64_t>(block, total - pos);
        ysfx_time_info_t ti{};
        ti.tempo = tempo;
        ti.playback_state = playing ? ysfx_playback_playing : 0;
        ti.time_position = (double)pos / sr;
        ti.beat_position = (double)pos * tempo / 60 / sr;
        ti.time_signature[0] = 4;
        ti.time_signature[1] = 4;
        ysfx_set_time_info(fx, &ti);
        if (pre) {
            for (auto &t : preTimed)
                if (t.frame >= pos && t.frame < pos + n) ysfx_slider_set_value(pre, (uint32_t)(t.idx - 1), t.value);
            const uint32_t pn = std::max<uint32_t>(2, ysfx_get_num_outputs(pre));
            std::vector<std::vector<float>> pbufs(pn, std::vector<float>(block));
            std::vector<float *> pouts(pn);
            for (uint32_t c = 0; c < pn; c++) pouts[c] = pbufs[c].data();
            ysfx_set_time_info(pre, &ti);
            ysfx_process_float(pre, ins, pouts.data(), ysfx_get_num_inputs(pre) ? 2 : 0, pn, n);
        }
        while (ei < events.size() && events[ei].frame < pos + n) {
            ysfx_midi_event_t ev{};
            ev.bus = 0;
            ev.offset = (uint32_t)(events[ei].frame > pos ? events[ei].frame - pos : 0);
            ev.size = 3;
            ev.data = events[ei].data;
            ysfx_send_midi(fx, &ev);
            ei++;
        }
        ysfx_process_float(fx, ins, outs.data(), ysfx_get_num_inputs(fx) ? 2 : 0, nout, n);
        for (uint32_t i = 0; i < n; i++)
            for (uint32_t c = 0; c < nout; c++) out.push_back(bufs[c][i]);
    }
    FILE *o = std::fopen(outPath, "wb");
    std::fwrite(out.data(), sizeof(float), out.size(), o);
    std::fclose(o);
    for (int idx : printSliders) std::printf("slider%d %.17g\n", idx, ysfx_slider_get_value(fx, (uint32_t)(idx - 1)));
    ysfx_free(fx);
    if (pre) ysfx_free(pre);
    return 0;
}
