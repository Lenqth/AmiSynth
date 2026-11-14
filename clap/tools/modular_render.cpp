// Renders a Modular patch with the native engine, for comparison with the Web engine.
// Usage: modular_render spec.json out.f32
// spec: {"rate": 48000, "samples": 4800, "patch": {...},
//        "notes": [{"key": 60, "velocity": 100, "on": 0, "off": 2400}]}
#include "../src/modular_dsp.h"
#include <cstdio>
#include <fstream>
#include <iterator>
#include <memory>
#include <vector>

using namespace modular;

int main(int argc, char **argv) {
    if (argc != 3) { std::fprintf(stderr, "Usage: modular_render spec.json out.f32\n"); return 2; }
    try {
        std::ifstream input(argv[1], std::ios::binary);
        const auto spec = Json::parse(std::string(std::istreambuf_iterator<char>(input), {}));
        // Voices hold their delay lines; keep the engine off the stack.
        auto engine = std::make_unique<Engine>();
        engine->rate = spec.at("rate").get<double>();
        engine->reset();
        auto patch = spec.at("patch");
        Macros macros;
        engine->graph = compile(patch, macros);
        const auto count = spec.at("samples").get<size_t>();
        std::vector<float> out(count);
        for (size_t n = 0; n < count; ++n) {
            for (const auto &note : spec.at("notes")) {
                const int key = note.at("key").get<int>();
                if (note.at("on").get<size_t>() == n)
                    engine->note_on(0, key, -1, note.at("velocity").get<double>() / 127, false);
                if (note.contains("off") && note.at("off").get<size_t>() == n) {
                    if (engine->graph.voice_mode) engine->mono_note_off(0, key);
                    else for (auto &v : engine->voices)
                        if (v.key_down && Engine::matches(v, 0, key, -1)) engine->release(v);
                }
            }
            out[n] = float(engine->sample(macros));
        }
        std::ofstream output(argv[2], std::ios::binary);
        output.write(reinterpret_cast<const char *>(out.data()), std::streamsize(out.size() * sizeof(float)));
        return output ? 0 : 1;
    } catch (const std::exception &e) {
        std::fprintf(stderr, "%s\n", e.what());
        return 1;
    }
}
