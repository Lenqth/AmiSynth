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
#include "modular_catalog.h"

constexpr size_t kNodes = 32;
constexpr double kPi = 3.14159265358979323846;
using Json = nlohmann::json;
using Macros = std::array<double, kMacroCount>;

struct Link { int node = -1, port = 0; };
struct Node {
    Type type{};
    std::array<double, 4> knobs{};
    // Signal inputs occupy the first two slots, parameter inputs the next four.
    std::array<Link, 6> links{};
    std::array<const Param *, 4> specs{};
    bool modulated = false;
};
struct Graph {
    std::array<Node, kNodes> nodes{};
    std::array<int, kNodes> order{}, delays{}, outputs{}, envelopes{};
    int size = 0, delay_count = 0, output_count = 0, envelope_count = 0;
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
            dest_port = 2 + int(knob - params.begin());
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
        if (graph.nodes[index].type == Type::adsr) graph.envelopes[graph.envelope_count++] = index;
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
    int mode = 0;
    bool gate = false;
};

struct Voice {
    bool active = false, key_down = false, held = false, clap_note = false;
    int16_t channel = 0, key = -1;
    int32_t note_id = -1;
    uint64_t age = 0, tail = 0;
    double velocity = 0;
    std::array<Stage, kNodes> stages{};
    std::array<std::array<double, 3>, kNodes> signals{};
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

    void reset() { voices = {}; bend = {}; sustain = {}; clock = 0; }

    NoteEnd note_on(int channel, int key, int32_t id, double velocity, bool clap_note) {
        auto chosen = voices.begin();
        for (auto it = voices.begin(); it != voices.end(); ++it) {
            if (!it->active) { chosen = it; break; }
            if (it->held == chosen->held ? it->age < chosen->age : !it->held) chosen = it;
        }
        const NoteEnd previous{chosen->active && chosen->clap_note, chosen->channel, chosen->key, chosen->note_id};
        *chosen = Voice{true, true, true, clap_note, int16_t(channel), int16_t(key), id, ++clock, 0, velocity};
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

    static double blep(double phase, double step) {
        if (phase < step) { const double x = phase / step; return x + x - x * x - 1; }
        if (phase > 1 - step) { const double x = (phase - 1) / step; return x * x + x + x + 1; }
        return 0;
    }

    void sample_node(Voice &v, int i, const Macros &macros) const {
        const auto &n = graph.nodes[i];
        auto p = n.knobs;
        if (n.modulated) {
            for (size_t index = 0; index < p.size(); ++index) {
                if (n.links[index + 2].node < 0) continue;
                const auto &spec = *n.specs[index];
                const double value = std::clamp(read(v, n, int(index + 2)), spec.min, spec.max);
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
            const double cutoff = std::clamp(p[0] * std::exp2(read(v, n, 1) * 2), 20.0, rate * 0.45);
            const double g = std::tan(kPi * cutoff / rate), k = 2 - 1.95 * p[1];
            const double hp = (read(v, n, 0) - (g + k) * st.ic1 - st.ic2) / (1 + g * (g + k));
            const double bp = g * hp + st.ic1, lp = g * bp + st.ic2;
            st.ic1 = 2 * bp - st.ic1;
            st.ic2 = 2 * lp - st.ic2;
            sig[0] = std::clamp(lp, -16.0, 16.0);
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
