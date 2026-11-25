// Renders a Modular patch with the native engine, for comparison with the Web engine.
// Usage: modular_render spec.json out.f32
// spec: {"rate": 48000, "samples": 4800, "patch": {...},
//        "notes": [{"key": 60, "velocity": 100, "on": 0, "off": 2400}],
//        "midi": [{"at": 100, "data": [176, 1, 64]}],            optional controllers on channel 1
//        "transport": [{"at": 0, "bpm": 140, "playing": true, "beat": 0}],  optional host transport
//        "expressions": [{"at": 100, "id": 6, "key": 60, "value": 0.5}]}  optional CLAP note expressions
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
        const size_t channel = spec.value("right", false) ? 1 : 0;
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
            if (const auto transport = spec.find("transport"); transport != spec.end()) {
                for (const auto &t : *transport)
                    if (t.at("at").get<size_t>() == n)
                        engine->transport(t.at("bpm").get<double>(), t.at("playing").get<bool>(), t.at("beat").get<double>());
            }
            if (const auto midi = spec.find("midi"); midi != spec.end()) {
                for (const auto &event : *midi) {
                    if (event.at("at").get<size_t>() != n) continue;
                    const auto &d = event.at("data");
                    const int status = d.at(0).get<int>(), d1 = d.at(1).get<int>(), d2 = d.at(2).get<int>();
                    const int op = status & 0xf0, channel = status & 0xf;
                    if (op == 0xe0) engine->pitch_bend(channel, d2 << 7 | d1);
                    else if (op == 0xd0) engine->channel_pressure(channel, d1);
                    else if (op == 0xa0) engine->poly_pressure(channel, d1, d2);
                    else if (op == 0xb0) engine->controller(channel, d1, d2);
                }
            }
            if (const auto expressions = spec.find("expressions"); expressions != spec.end()) {
                for (const auto &e : *expressions)
                    if (e.at("at").get<size_t>() == n)
                        engine->note_expression(e.at("id").get<int>(), 0, e.at("key").get<int>(), -1, e.at("value").get<double>());
            }
            out[n] = float(engine->sample(macros)[channel]);
        }
        std::ofstream output(argv[2], std::ios::binary);
        output.write(reinterpret_cast<const char *>(out.data()), std::streamsize(out.size() * sizeof(float)));
        return output ? 0 : 1;
    } catch (const std::exception &e) {
        std::fprintf(stderr, "%s\n", e.what());
        return 1;
    }
}
