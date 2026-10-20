// Headless @gfx and telemetry checks. Link with ysfx built with YSFX_GFX=ON.
// Usage: jsfx_meter_check file.jsfx synth|phys|drums [preview.bmp]
#include "ysfx_compat.h"
#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <fstream>
#include <map>
#include <string>
#include <vector>

static void log_reporter(intptr_t, ysfx_log_level level, const char *msg) {
    std::fprintf(stderr, "[ysfx %s] %s\n", ysfx_log_level_string(level), msg);
}
static void require(bool ok, const char *msg) {
    if (!ok) { std::fprintf(stderr, "FAIL: %s\n", msg); std::exit(1); }
}
// ysfx resolves named sliders as aliases of sliderN (upstream within its 64-slider limit,
// ysfx-s for all 256), so a slider name is looked up through the file's slider lines.
static std::map<std::string, std::string> slider_aliases;
static void read_slider_aliases(const char *path) {
    std::ifstream in(path);
    std::string line;
    while (std::getline(in, line)) {
        unsigned n = 0; int used = 0;
        if (std::sscanf(line.c_str(), "slider%u:%n", &n, &used) != 1 || !used) continue;
        const size_t eq = line.find('=', used);
        if (eq != std::string::npos) slider_aliases[line.substr(used, eq - used)] = "slider" + std::to_string(n);
    }
}
static double &var(ysfx_t *fx, const char *name) {
    auto *p = ysfx_find_var(fx, name);
    if (!p && slider_aliases.count(name)) p = ysfx_find_var(fx, slider_aliases[name].c_str());
    require(p != nullptr, name);
    return *p;
}
static void click(ysfx_t *fx, int x, int y) {
    ysfx_gfx_update_mouse(fx, 0, x, y, 0, 0, 0); ysfx_gfx_run(fx);
    ysfx_gfx_update_mouse(fx, 0, x, y, 1, 0, 0); ysfx_gfx_run(fx);
}
static void put32(FILE *f, uint32_t value) {
    for (int i = 0; i < 4; ++i) std::fputc((value >> (8 * i)) & 255, f);
}
int main(int argc, char **argv) {
    if (argc < 3) return 2;
    const bool synth = !std::strcmp(argv[2], "synth"), drums = !std::strcmp(argv[2], "drums");
    read_slider_aliases(argv[1]);
    auto *config = ysfx_config_new();
    ysfx_set_log_reporter(config, log_reporter); ysfx_guess_file_roots(config, argv[1]);
    auto *fx = ysfx_new(config); ysfx_config_free(config);
    require(ysfx_load_file(fx, argv[1], 0) && ysfx_compile(fx, 0), "compile including @gfx");
    ysfx_set_sample_rate(fx, 48000); ysfx_set_block_size(fx, 128);
    const char *volume = synth ? "master_volume_db" : drums ? "drum_master_volume_db" : "phys_volume_db";
    const char *gain = synth || drums ? "master_gain" : "out_gain";
    if (drums) {
        var(fx, volume) = -4;
        for (auto id : {"kick_bus_in_main", "snare_bus_in_main", "hats_bus_in_main", "perc_bus_in_main"}) var(fx, id) = 1;
    }
    ysfx_init(fx);
    const uint32_t channels = std::max<uint32_t>(2, ysfx_get_num_outputs(fx));
    std::vector<std::vector<double>> buffers(channels, std::vector<double>(128));
    std::vector<double *> outs(channels);
    for (uint32_t c = 0; c < channels; ++c) outs[c] = buffers[c].data();
    double zero[128]{}; const double *ins[] = {zero, zero};
    for (int i = 0; i < (synth ? 9 : 1); ++i) {
        uint8_t data[] = {0x90, (uint8_t)(drums ? 36 : 60 + i), 100};
        ysfx_midi_event_t event{0, 0, 3, data}; ysfx_send_midi(fx, &event);
    }
    double power = 0, peak_l = 0, peak_r = 0;
    const double alpha = 1 - std::exp(-1 / (0.4 * 48000)), fall = std::exp(-1 / (0.6 * 48000));
    for (int b = 0; b < 100; ++b) {
        ysfx_process_double(fx, ins, outs.data(), ysfx_get_num_inputs(fx) ? 2 : 0, channels, 128);
        for (int i = 0; i < 128; ++i) {
            const double l = outs[0][i], r = outs[1][i];
            power += alpha * ((l * l + r * r) * 0.5 - power);
            peak_l = std::max(std::abs(l), peak_l * fall); peak_r = std::max(std::abs(r), peak_r * fall);
        }
    }
    require(power > 1e-8, "audible output");
    require(std::abs(var(fx, "meter.power") - power) < 1e-12, "RMS measures emitted stereo samples");
    require(std::abs(var(fx, "meter.peak_l") - peak_l) < 1e-12 && std::abs(var(fx, "meter.peak_r") - peak_r) < 1e-12, "stereo peaks");
    if (synth) require(var(fx, "active_voices") == 8 && var(fx, "voice_steals") == 1, "ninth different note steals one voice");
    std::vector<uint8_t> pixels(520 * 210 * 4);
    ysfx_gfx_config_t gc{}; gc.pixel_width = 520; gc.pixel_height = 210; gc.pixels = pixels.data(); gc.scale_factor = 1;
    ysfx_gfx_setup(fx, &gc);
    const double before = var(fx, volume);
    ysfx_gfx_run(fx); require(var(fx, volume) == before, "drawing does not alter gain");
    click(fx, 30, 85);
    require(var(fx, "meter.has_reference") == 1 && var(fx, volume) == before, "capture reference does not alter gain");
    if (argc > 3) {
        FILE *f = std::fopen(argv[3], "wb"); require(f != nullptr, "preview path");
        std::fwrite("BM", 1, 2, f); put32(f, 54 + (uint32_t)pixels.size()); put32(f, 0); put32(f, 54);
        put32(f, 40); put32(f, 520); put32(f, (uint32_t)-210);
        std::fputc(1, f); std::fputc(0, f); std::fputc(32, f); std::fputc(0, f);
        put32(f, 0); put32(f, (uint32_t)pixels.size()); put32(f, 0); put32(f, 0); put32(f, 0); put32(f, 0);
        std::fwrite(pixels.data(), 1, pixels.size(), f); std::fclose(f);
    }
    var(fx, "meter.power") = power * 4; // a controlled +6.02 dB comparison
    click(fx, 180, 85);
    require(std::abs(var(fx, volume) - (before - 20 * std::log10(2))) < 1e-8, "opt-in level match applies measured correction");
    require(std::abs(var(fx, gain) - std::pow(10, var(fx, volume) / 20)) < 1e-10, "level match updates the DSP gain");
    var(fx, "meter.power") = 0;
    const double silent_volume = var(fx, volume);
    click(fx, 180, 85); require(var(fx, volume) == silent_volume, "silence cannot increase gain");
    if (!synth && !drums) {
        // A patch change can alter mode and release simultaneously. Flush with
        // the previous patch's damping, as phys_update does in the JS core.
        uint8_t down[] = {0xb0, 64, 127}, off[] = {0x80, 60, 0};
        ysfx_midi_event_t event{0, 0, 3, down}; ysfx_send_midi(fx, &event);
        event.data = off; ysfx_send_midi(fx, &event);
        ysfx_process_double(fx, ins, outs.data(), 0, channels, 128);
        double pending = 0;
        ysfx_read_vmem(fx, (uint32_t)var(fx, "v_sus"), &pending, 1);
        require(pending == 1, "Physical defers note-off under CC64");
        const double old_release = ysfx_slider_get_value(fx, 42);
        const double expected = std::min(var(fx, "p0.loop_gain"), std::exp(-6.907755 / (var(fx, "p0.hz0") * old_release * 0.001)));
        set_slider(fx, 42, 10); set_slider(fx, 59, 0);
        ysfx_process_double(fx, ins, outs.data(), 0, channels, 128);
        ysfx_read_vmem(fx, (uint32_t)var(fx, "v_sus"), &pending, 1);
        require(pending == 0 && std::abs(var(fx, "p0.loop_gain") - expected) < 1e-12, "policy change flushes with previous release damping");
    }
    std::printf("%s: @gfx, output RMS/peaks, capture, opt-in matching and silence checks passed\n", argv[2]);
    ysfx_free(fx);
}
