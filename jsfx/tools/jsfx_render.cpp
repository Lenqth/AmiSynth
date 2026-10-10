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
// Output: interleaved stereo float32 (raw).
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
            } else if (!std::strcmp(kind, "midi")) {
                unsigned long long fr; unsigned s, a, b;
                if (std::sscanf(line, "%*s %llu %u %u %u", &fr, &s, &a, &b) == 4)
                    events.push_back({fr, {(uint8_t)s, (uint8_t)a, (uint8_t)b}});
            }
        }
        std::fclose(f);
    }
    std::stable_sort(events.begin(), events.end(), [](const Ev &a, const Ev &b) { return a.frame < b.frame; });

    ysfx_config_t *config = ysfx_config_new();
    ysfx_set_log_reporter(config, &log_reporter);
    ysfx_guess_file_roots(config, path);
    ysfx_t *fx = ysfx_new(config);
    ysfx_config_free(config);
    if (!ysfx_load_file(fx, path, 0)) { std::fprintf(stderr, "load failed\n"); return 1; }
    if (!ysfx_compile(fx, ysfx_compile_no_gfx)) { std::fprintf(stderr, "compile failed\n"); return 1; }

    const uint32_t block = 128;
    ysfx_set_sample_rate(fx, sr);
    ysfx_set_block_size(fx, block);
    for (auto &v : vars) {
        ysfx_real *p = ysfx_find_var(fx, v.first.c_str());
        if (p) *p = v.second;
        else std::fprintf(stderr, "unknown variable: %s\n", v.first.c_str());
    }
    ysfx_init(fx);
    for (auto &s : sliders) ysfx_slider_set_value(fx, (uint32_t)(s.first - 1), s.second);

    uint64_t total = (uint64_t)(seconds * sr);
    std::vector<float> l(block), r(block), out;
    out.reserve(total * 2);
    std::vector<float> zero(block, 0.0f);
    const float *ins[2] = {zero.data(), zero.data()};
    float *outs[2] = {l.data(), r.data()};
    size_t ei = 0;
    for (uint64_t pos = 0; pos < total; pos += block) {
        uint32_t n = (uint32_t)std::min<uint64_t>(block, total - pos);
        while (ei < events.size() && events[ei].frame < pos + n) {
            ysfx_midi_event_t ev{};
            ev.bus = 0;
            ev.offset = (uint32_t)(events[ei].frame > pos ? events[ei].frame - pos : 0);
            ev.size = 3;
            ev.data = events[ei].data;
            ysfx_send_midi(fx, &ev);
            ei++;
        }
        ysfx_process_float(fx, ins, outs, ysfx_get_num_inputs(fx) ? 2 : 0, 2, n);
        for (uint32_t i = 0; i < n; i++) { out.push_back(l[i]); out.push_back(r[i]); }
    }
    FILE *o = std::fopen(outPath, "wb");
    std::fwrite(out.data(), sizeof(float), out.size(), o);
    std::fclose(o);
    ysfx_free(fx);
    return 0;
}
