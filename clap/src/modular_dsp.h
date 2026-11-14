#pragma once

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>
#include <initializer_list>
#include <stdexcept>
#include <string>
#include <vector>
#include <nlohmann/json.hpp>

namespace modular {

enum class Type;
struct Param { const char *name; double min, max, initial; bool stepped; };
struct Spec {
    Type type;
    const char *name;
    std::initializer_list<const char *> inputs, outputs;
    std::initializer_list<Param> params;
};
struct Preset { const char *name; const char *patch; };
struct Material { double ratios[8], gains[8]; };
#include "modular_catalog.h"

constexpr size_t kNodes = 32;
constexpr double kPi = 3.14159265358979323846;
constexpr double kLn1000 = 6.907755278982137; // a T60 decay falls by a factor of 1000
constexpr int kLineMask = int(kLineSamples) - 1;
static_assert((kLineSamples & (kLineSamples - 1)) == 0, "Delay lines are a power of two");
using Json = nlohmann::json;
using Macros = std::array<double, kMacroCount>;

struct Link { int node = -1, port = 0; };
struct Node {
    Type type{};
    std::array<double, kMaxParams> knobs{};
    // Signal inputs occupy the first kMaxInputs slots, parameter inputs the rest.
    std::array<Link, kMaxInputs + kMaxParams> links{};
    std::array<const Param *, kMaxParams> specs{};
    bool modulated = false;
    int line = -1; // Delay-line slot for strings and comb filters.
};
struct Graph {
    std::array<Node, kNodes> nodes{};
    std::array<int, kNodes> order{}, delays{}, outputs{}, envelopes{};
    int size = 0, delay_count = 0, output_count = 0, envelope_count = 0, line_count = 0;
};

inline int port_index(std::initializer_list<const char *> ports, const std::string &name) {
    const auto port = std::find(ports.begin(), ports.end(), name);
    if (port == ports.end()) throw std::invalid_argument("Invalid port");
    return int(port - ports.begin());
}

inline Graph compile(Json &patch, Macros &macros) {
    auto &nodes = patch.at("nodes");
    auto &cables = patch.at("cables");
    if ((patch.contains("version") && patch["version"] != 1) ||
        !nodes.is_array() || nodes.empty() || nodes.size() > kNodes ||
        !cables.is_array() || cables.size() > 128)
        throw std::invalid_argument("Invalid patch");

    Graph graph;
    graph.size = int(nodes.size());
    std::vector<std::string> ids;
    std::vector<const Spec *> specs;
    for (auto &n : nodes) {
        const auto id = n.at("id").get<std::string>();
        const auto type = n.at("type").get<std::string>();
        const auto spec = std::find_if(std::begin(kSpecs), std::end(kSpecs), [&](const auto &s) { return type == s.name; });
        if (id.empty() || id.size() > 32 || id.find_first_not_of("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-") != std::string::npos ||
            std::find(ids.begin(), ids.end(), id) != ids.end() || spec == std::end(kSpecs))
            throw std::invalid_argument("Invalid module");
        auto &node = graph.nodes[ids.size()];
        node.type = spec->type;
        if (node.type == Type::string || node.type == Type::comb) {
            if (graph.line_count == int(kLines)) throw std::invalid_argument("Too many delay lines");
            node.line = graph.line_count++;
        }
        if (node.type == Type::output) graph.outputs[graph.output_count++] = int(ids.size());
        if (node.type == Type::delay) graph.delays[graph.delay_count++] = int(ids.size());
        ids.push_back(id);
        specs.push_back(spec);
        const auto params = n.find("params");
        Json normalized = Json::object();
        size_t index = 0;
        for (const auto &p : spec->params) {
            double value = p.initial;
            if (params != n.end() && params->is_object() && params->contains(p.name) && (*params)[p.name].is_number())
                value = std::clamp((*params)[p.name].get<double>(), p.min, p.max);
            if (p.stepped) value = std::floor(value + 0.5);
            node.specs[index] = &p;
            node.knobs[index++] = value;
            normalized[p.name] = value;
        }
        Json saved{{"id", id}, {"type", type}, {"params", std::move(normalized)}};
        const auto position = n.find("position");
        if (position != n.end() && position->is_object() &&
            position->contains("x") && (*position)["x"].is_number() &&
            position->contains("y") && (*position)["y"].is_number()) {
            const auto coordinate = [&](const char *axis) {
                return std::round(std::clamp((*position)[axis].get<double>(), 0.0, kPositionMax));
            };
            saved["position"] = {{"x", coordinate("x")}, {"y", coordinate("y")}};
        }
        n = std::move(saved);
    }
    if (!graph.output_count) throw std::invalid_argument("Missing output");

    const auto node_index = [&](const std::string &id) {
        const auto found = std::find(ids.begin(), ids.end(), id);
        if (found == ids.end()) throw std::invalid_argument("Invalid cable endpoint");
        return int(found - ids.begin());
    };
    std::array<std::vector<int>, kNodes> adjacency;
    std::array<int, kNodes> degree{};
    for (auto &c : cables) {
        auto from = c.at("from").get<std::string>();
        auto to = c.at("to").get<std::string>();
        auto port = c.at("port").get<std::string>();
        auto input = c.at("input").get<std::string>();
        const int source = node_index(from), dest = node_index(to);
        const int source_port = port_index(specs[source]->outputs, port);
        auto &node = graph.nodes[dest];
        int dest_port;
        if (input.compare(0, 6, "param:") == 0) {
            const auto &params = specs[dest]->params;
            const auto name = input.substr(6);
            const auto knob = std::find_if(params.begin(), params.end(), [&](const Param &p) { return name == p.name; });
            if (knob == params.end()) throw std::invalid_argument("Invalid parameter input");
            dest_port = int(kMaxInputs) + int(knob - params.begin());
            node.modulated = true;
        } else {
            dest_port = port_index(specs[dest]->inputs, input);
        }
        auto &link = node.links[dest_port];
        if (link.node >= 0) throw std::invalid_argument("Duplicate input");
        link = {source, source_port};
        if (graph.nodes[dest].type != Type::delay) {
            adjacency[source].push_back(dest);
            ++degree[dest];
        }
        c = {{"from", std::move(from)}, {"to", std::move(to)}, {"port", std::move(port)}, {"input", std::move(input)}};
    }
    int count = 0;
    for (int i = 0; i < graph.size; ++i) if (!degree[i]) graph.order[count++] = i;
    for (int i = 0; i < count; ++i)
        for (int next : adjacency[graph.order[i]]) if (--degree[next] == 0) graph.order[count++] = next;
    if (count != graph.size) throw std::invalid_argument("Instantaneous feedback loop");

    std::array<bool, kNodes> seen{};
    std::vector<int> audible(graph.outputs.begin(), graph.outputs.begin() + graph.output_count);
    for (int node : audible) seen[node] = true;
    for (size_t i = 0; i < audible.size(); ++i) {
        const int index = audible[i];
        // Modules that ring on after their gate falls keep a released voice alive until quiet.
        const auto type = graph.nodes[index].type;
        if (type == Type::adsr || type == Type::string || type == Type::modal)
            graph.envelopes[graph.envelope_count++] = index;
        for (auto link : graph.nodes[index].links) {
            if (link.node < 0 || seen[link.node]) continue;
            seen[link.node] = true;
            audible.push_back(link.node);
        }
    }
    macros = {};
    const auto m = patch.find("macros");
    if (m != patch.end() && m->is_array()) {
        for (size_t i = 0; i < std::min(m->size(), macros.size()); ++i) {
            if ((*m)[i].is_number()) macros[i] = std::clamp((*m)[i].get<double>(), 0.0, 1.0);
        }
    }
    patch = {{"version", 1}, {"nodes", std::move(nodes)}, {"cables", std::move(cables)}, {"macros", macros}};
    return graph;
}

struct Stage {
    double phase = 0, env = 0, release = 0, ic1 = 0, ic2 = 0, memory = 0;
    double p0 = 0, p1 = 0, p2 = 0, value = 0, prev = 0, amp = 0;
    uint32_t rng = 1;
    int mode = 0, write = 0;
    bool gate = false, ready = false;
    std::array<double, kModes> y1{}, y2{}, a1{}, a2{}, b{};
    std::array<double, 4> key{NAN, NAN, NAN, NAN};
};
using Line = std::array<float, kLineSamples>;

struct Voice {
    bool active = false, key_down = false, held = false, clap_note = false;
    int16_t channel = 0, key = -1;
    int32_t note_id = -1;
    uint64_t age = 0, tail = 0;
    double velocity = 0;
    std::array<Stage, kNodes> stages{};
    std::array<std::array<double, kMaxOutputs>, kNodes> signals{};
    std::array<Line, kLines> lines{};
};

struct NoteEnd {
    bool send = false;
    int16_t channel = 0, key = -1;
    int32_t id = -1;
};

struct Engine {
    double rate = 48000;
    Graph graph;
    std::array<Voice, 8> voices{};
    std::array<double, 16> bend{};
    std::array<bool, 16> sustain{};
    uint64_t clock = 0;

    // Voices hold their delay lines, so they are reset in place rather than by assigning a
    // temporary, which would put hundreds of kilobytes on the stack.
    void reset() {
        for (auto &v : voices) { v.active = v.key_down = v.held = v.clap_note = false; v.tail = 0; }
        bend = {}; sustain = {}; clock = 0;
    }

    NoteEnd note_on(int channel, int key, int32_t id, double velocity, bool clap_note) {
        auto chosen = voices.begin();
        for (auto it = voices.begin(); it != voices.end(); ++it) {
            if (!it->active) { chosen = it; break; }
            if (it->held == chosen->held ? it->age < chosen->age : !it->held) chosen = it;
        }
        const NoteEnd previous{chosen->active && chosen->clap_note, chosen->channel, chosen->key, chosen->note_id};
        auto &v = *chosen;
        v.active = v.key_down = v.held = true;
        v.clap_note = clap_note;
        v.channel = int16_t(channel); v.key = int16_t(key); v.note_id = id;
        v.age = ++clock; v.tail = 0; v.velocity = velocity;
        // Same seeds as the Web engine, so noise is identical in both.
        const auto age = uint32_t(v.age);
        for (size_t i = 0; i < v.stages.size(); ++i) {
            v.stages[i] = Stage{};
            const uint32_t seed = age * 0x9e3779b1u + uint32_t(i + 1) * 0x85ebca77u;
            v.stages[i].rng = seed ? seed : 1;
        }
        v.signals = {};
        for (int i = 0; i < graph.line_count; ++i) v.lines[size_t(i)].fill(0);
        return previous;
    }

    static bool matches(const Voice &v, int channel, int key, int32_t id) {
        return v.active && (channel < 0 || v.channel == channel) &&
            (key < 0 || v.key == key) && (id < 0 || v.note_id == id);
    }

    void release(Voice &v) {
        v.key_down = false;
        v.held = sustain[v.channel];
    }

    static double read(const Voice &v, const Node &n, int input, double fallback = 0) {
        const auto link = n.links[input];
        return link.node < 0 ? fallback : v.signals[link.node][link.port];
    }

    static double white(Stage &st) {
        uint32_t x = st.rng;
        x ^= x << 13; x ^= x >> 17; x ^= x << 5;
        st.rng = x;
        return double(x) / 4294967296.0 * 2 - 1;
    }

    // One-pole smoothing step for a time constant in seconds; zero follows instantly.
    double lag(double time) const { return time <= 0 ? 1 : 1 - std::exp(-1 / (time * rate)); }

    static double line_read(const Line &line, int write, double delay) {
        const double pos = write - delay, base = std::floor(pos), frac = pos - base;
        const int i = int(base);
        return line[size_t(i & kLineMask)] * (1 - frac) + line[size_t((i + 1) & kLineMask)] * frac;
    }

    static double blep(double phase, double step) {
        if (phase < step) { const double x = phase / step; return x + x - x * x - 1; }
        if (phase > 1 - step) { const double x = (phase - 1) / step; return x * x + x + x + 1; }
        return 0;
    }

    void sample_node(Voice &v, int i, const Macros &macros) {
        const auto &n = graph.nodes[i];
        auto p = n.knobs;
        if (n.modulated) {
            for (size_t index = 0; index < p.size(); ++index) {
                if (!n.specs[index] || n.links[index + kMaxInputs].node < 0) continue;
                const auto &spec = *n.specs[index];
                const double value = std::clamp(read(v, n, int(index + kMaxInputs)), spec.min, spec.max);
                p[index] = spec.stepped ? std::floor(value + 0.5) : value;
            }
        }
        auto &st = v.stages[i];
        auto &sig = v.signals[i];
        switch (n.type) {
        case Type::midi:
            sig = {v.key + bend[v.channel], v.held ? 1.0 : 0.0, v.velocity};
            break;
        case Type::vco: {
            const double note = read(v, n, 0, 69) + 12 * p[1] + p[2] / 100 + read(v, n, 1) * 12;
            const double step = std::clamp(440 * std::exp2((note - 69) / 12), 0.01, rate * 0.45) / rate;
            const double phase = st.phase;
            double wave;
            switch (int(p[0])) {
            case 0: wave = std::sin(2 * kPi * phase); break;
            case 1: wave = 2 * phase - 1 - blep(phase, step); break;
            case 2: wave = (phase < 0.5 ? 1 : -1) + blep(phase, step) - blep(std::fmod(phase + 0.5, 1.0), step); break;
            default: wave = 2 / kPi * std::asin(std::sin(2 * kPi * phase)); break;
            }
            sig[0] = wave * p[3];
            st.phase = std::fmod(phase + step, 1.0);
            break;
        }
        case Type::lfo:
            sig[0] = (p[2] ? 1 - 4 * std::abs(st.phase - 0.5) : std::sin(2 * kPi * st.phase)) * p[1];
            st.phase = std::fmod(st.phase + p[0] / rate, 1.0);
            break;
        case Type::adsr: {
            const bool gate = read(v, n, 0) >= 0.5;
            if (gate && !st.gate) st.mode = 1;
            if (!gate && st.gate) { st.mode = 4; st.release = st.env; }
            st.gate = gate;
            switch (st.mode) {
            case 1:
                st.env += 1 / std::max(1.0, p[0] * rate);
                if (st.env >= 1) { st.env = 1; st.mode = 2; }
                break;
            case 2:
                st.env -= (1 - p[2]) / std::max(1.0, p[1] * rate);
                if (st.env <= p[2]) { st.env = p[2]; st.mode = 3; }
                break;
            case 3: st.env = p[2]; break;
            case 4:
                st.env -= st.release / std::max(1.0, p[3] * rate);
                if (st.env <= 0) { st.env = 0; st.mode = 0; }
                break;
            }
            sig[0] = st.env;
            break;
        }
        case Type::vcf: {
            const double track = p[3] * (read(v, n, 2, 60) - 60) / 12;
            const double cutoff = std::clamp(p[0] * std::exp2(read(v, n, 1) * 2 + track), 20.0, rate * 0.45);
            const double g = std::tan(kPi * cutoff / rate), k = 2 - 1.95 * p[1];
            const double hp = (read(v, n, 0) - (g + k) * st.ic1 - st.ic2) / (1 + g * (g + k));
            const double bp = g * hp + st.ic1, lp = g * bp + st.ic2;
            st.ic1 = 2 * bp - st.ic1;
            st.ic2 = 2 * lp - st.ic2;
            const int mode = int(p[2]);
            const double out = mode == 0 ? lp : mode == 1 ? hp : mode == 2 ? bp : lp + hp;
            sig[0] = std::isfinite(out) ? std::clamp(out, -16.0, 16.0) : 0.0;
            break;
        }
        case Type::noise: {
            const double w = white(st);
            if (p[0] != 0) {
                // Paul Kellet's economy pink filter.
                st.p0 = 0.99765 * st.p0 + w * 0.0990460;
                st.p1 = 0.96300 * st.p1 + w * 0.2965164;
                st.p2 = 0.57000 * st.p2 + w * 1.0526913;
                sig[0] = (st.p0 + st.p1 + st.p2 + w * 0.1848) * 0.25 * p[1];
            } else sig[0] = w * p[1];
            break;
        }
        case Type::sh: {
            bool fire = !st.ready;
            if (n.links[1].node >= 0) {
                const bool gate = read(v, n, 1) >= 0.5;
                if (gate && !st.gate) fire = true;
                st.gate = gate;
            } else {
                st.phase += p[0] / rate;
                if (st.phase >= 1) { st.phase -= 1; fire = true; }
            }
            if (fire) st.value = n.links[0].node >= 0 ? read(v, n, 0) : white(st);
            st.ready = true;
            sig[0] = st.value;
            break;
        }
        case Type::slew: {
            const double x = read(v, n, 0);
            if (!st.ready) { st.value = x; st.ready = true; }
            else st.value += (x - st.value) * lag(x > st.value ? p[0] : p[1]);
            sig[0] = st.value;
            break;
        }
        case Type::follower: {
            const double x = std::abs(read(v, n, 0));
            st.value += (x - st.value) * lag(x > st.value ? p[0] : p[1]);
            sig[0] = st.value * p[2];
            break;
        }
        case Type::ring: sig[0] = read(v, n, 0) * read(v, n, 1, 1) * p[0]; break;
        case Type::comb: {
            auto &line = v.lines[size_t(n.line)];
            const double delay = std::clamp(p[0] * rate / 1000, 1.0, double(kLineSamples - 2));
            const double y = line_read(line, st.write, delay);
            st.prev = y * (1 - p[2]) + st.prev * p[2];
            const double x = read(v, n, 0);
            line[size_t(st.write)] = float(std::clamp(x + p[1] * st.prev, -4.0, 4.0));
            st.write = (st.write + 1) & kLineMask;
            sig[0] = x * (1 - p[3]) + y * p[3];
            break;
        }
        case Type::string: {
            auto &line = v.lines[size_t(n.line)];
            const bool gate = read(v, n, 1, 1) >= 0.5;
            if (gate && !st.gate) {
                // Pluck: fill the loop with noise, low-passed more for a darker tone.
                const double c = 0.1 + 0.9 * p[2];
                double f = 0;
                for (auto &sample : line) { f += c * (white(st) - f); sample = float(f); }
            }
            st.gate = gate;
            const double hz = std::clamp(440 * std::pow(2.0, (read(v, n, 0, 69) - 69) / 12),
                rate / double(kLineSamples - 4), rate * 0.45);
            // The loop filter adds half a sample of delay.
            const double y = line_read(line, st.write, std::max(1.0, rate / hz - 0.5));
            const double smooth = 0.5 * (1 - p[2]);
            const double filtered = (1 - smooth) * y + smooth * st.prev;
            st.prev = y;
            const double t60 = gate ? p[0] : std::min(p[0], p[1]);
            line[size_t(st.write)] = float(std::clamp(filtered * std::exp(-kLn1000 / (t60 * hz)) + read(v, n, 2), -4.0, 4.0));
            st.write = (st.write + 1) & kLineMask;
            st.amp = std::max(std::abs(y), st.amp * 0.9995);
            st.mode = st.amp > 1e-4 ? 1 : 0;
            sig[0] = y * p[3];
            break;
        }
        case Type::modal: {
            const bool gate = read(v, n, 2, 1) >= 0.5;
            const double strike = gate && !st.gate ? 1 : 0;
            st.gate = gate;
            const double material = p[0], t60 = gate ? p[1] : std::min(p[1], p[2]), brightness = p[3];
            const double hz = 440 * std::pow(2.0, (read(v, n, 1, 69) - 69) / 12);
            if (st.key[0] != hz || st.key[1] != material || st.key[2] != t60 || st.key[3] != brightness) {
                st.key = {hz, material, t60, brightness};
                const auto &mat = kMaterials[size_t(material)];
                for (size_t k = 0; k < kModes; ++k) {
                    const double ratio = mat.ratios[k], f = hz * ratio;
                    if (!(f > 0 && f < rate * 0.45)) { st.a1[k] = st.a2[k] = st.b[k] = 0; continue; }
                    // Darker settings damp the upper modes faster, as in the Physical instrument.
                    const double t = t60 / std::max(0.25, 1 + (1 - brightness) * 4 * (ratio - 1));
                    const double r = std::exp(-kLn1000 / (t * rate));
                    const double w = 2 * kPi * f / rate;
                    st.a1[k] = 2 * r * std::cos(w); st.a2[k] = r * r; st.b[k] = mat.gains[k] * std::sin(w);
                }
            }
            const double x = read(v, n, 0) + strike;
            double sum = 0;
            for (size_t k = 0; k < kModes; ++k) {
                const double y = st.b[k] * x + st.a1[k] * st.y1[k] - st.a2[k] * st.y2[k];
                st.y2[k] = st.y1[k]; st.y1[k] = y; sum += y;
            }
            st.amp = std::max(std::abs(sum), st.amp * 0.9995);
            st.mode = st.amp > 1e-4 ? 1 : 0;
            sig[0] = std::clamp(sum * p[4], -16.0, 16.0);
            break;
        }
        case Type::vca: sig[0] = read(v, n, 0) * read(v, n, 1, 1) * p[0]; break;
        case Type::mix: sig[0] = read(v, n, 0) * p[0] + read(v, n, 1) * p[1]; break;
        case Type::cv: sig[0] = read(v, n, 0) * p[0] + p[1]; break;
        case Type::macro: sig[0] = macros[size_t(p[0]) - 1]; break;
        case Type::delay: sig[0] = st.memory; break;
        case Type::output: sig[0] = read(v, n, 0) * p[0]; break;
        }
        sig[0] = std::clamp(sig[0], -1e6, 1e6);
    }

    double sample(const Macros &macros) {
        double out = 0;
        for (auto &v : voices) {
            if (!v.active) continue;
            for (int i = 0; i < graph.size; ++i) sample_node(v, graph.order[i], macros);
            for (int i = 0; i < graph.delay_count; ++i) {
                const int index = graph.delays[i];
                v.stages[index].memory = std::clamp(read(v, graph.nodes[index], 0), -4.0, 4.0);
            }
            double value = 0;
            for (int i = 0; i < graph.output_count; ++i) value += v.signals[graph.outputs[i]][0];
            if (!v.held) {
                ++v.tail;
                const auto limit = graph.envelope_count ? uint64_t(10 * rate) : 0;
                if (v.tail > limit) {
                    const double fade = std::max(1.0, std::round(0.005 * rate));
                    value *= std::clamp(1 - double(v.tail - limit) / fade, 0.0, 1.0);
                    if (double(v.tail - limit) >= fade) v.active = false;
                } else {
                    const auto last = graph.envelopes.begin() + graph.envelope_count;
                    v.active = !std::all_of(graph.envelopes.begin(), last, [&](int i) {
                        return v.stages[i].mode == 0 && !v.stages[i].gate;
                    });
                }
            }
            out += value;
        }
        return std::tanh(out);
    }
};

} // namespace modular
