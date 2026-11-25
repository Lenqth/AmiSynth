#pragma once

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>
#include <initializer_list>
#include <mutex>
#include <stdexcept>
#include <string>
#include <vector>
#include <nlohmann/json.hpp>

namespace modular {

enum class Type;
// A fixed knob is a patch setting, such as the voice mode, and takes no cable.
struct Param { const char *name; double min, max, initial; bool stepped, fixed; };
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
#include "modular_wavetable.h"
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
    std::array<uint8_t, kBeatGridMaxSteps> grid{};
    Material custom_material{};
    std::array<double, kModes> modal_decay{};
    bool custom_modal = false;
    bool modulated = false;
    int line = -1; // Delay-line slot for strings and comb filters.
    int slot = -1; // Patch effect buffer slot for Echo, Chorus and Reverb.
    const float *wavetable = nullptr;
};
// CLAP note expression IDs (clap/events.h), so the engine stays free of CLAP headers.
constexpr int kExpressionTuning = 2, kExpressionExpression = 4, kExpressionBrightness = 5, kExpressionPressure = 6;

struct Graph {
    std::array<Node, kNodes> nodes{};
    std::array<int, kNodes> order{}, delays{}, outputs{}, envelopes{}, clocks{};
    int size = 0, size_voice = 0, delay_count = 0, output_count = 0, envelope_count = 0, line_count = 0;
    int clock_count = 0;
    // Patch effects in dependency order, run once per sample after the voices. A bus link is a
    // patch effect input fed by a voice module; it reads that signal summed over the voices.
    struct BusLink { int global, input, node, port; };
    std::array<int, kNodes> globals{};
    std::array<BusLink, 2 * kNodes> bus_links{};
    int global_count = 0, bus_count = 0;
    bool autonomous = false;
    // From the first MIDI / Note module: 0 poly, 1 mono, 2 legato; glide in seconds.
    int voice_mode = 0;
    double glide = 0, bend_range = 2;
    bool glide_legato_only = false;
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
        const int lines = node.type == Type::bowed || node.type == Type::physBowed ? 2 :
            int(node.type == Type::string || node.type == Type::physString || node.type == Type::comb || node.type == Type::reedPipe);
        if (lines) {
            if (graph.line_count + lines > int(kLines)) throw std::invalid_argument("Too many delay lines");
            node.line = graph.line_count;
            graph.line_count += lines;
        }
        if (node.type == Type::output) graph.outputs[graph.output_count++] = int(ids.size());
        if (node.type == Type::delay) graph.delays[graph.delay_count++] = int(ids.size());
        if (node.type == Type::clock) graph.clocks[graph.clock_count++] = int(ids.size());
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
        if (node.type == Type::beatGrid) {
            const auto pattern = n.find("grid");
            const bool has_grid = pattern != n.end() && pattern->is_array();
            constexpr double max_mask = (1 << 4) - 1; // four lanes, A-D
            for (size_t step = 0; step < node.grid.size(); ++step) {
                const auto *value = has_grid && step < pattern->size() ? &(*pattern)[step] : nullptr;
                if (!has_grid && params != n.end() && params->is_object()) {
                    const auto legacy = params->find("step" + std::to_string(step + 1));
                    if (legacy != params->end()) value = &*legacy;
                }
                if (value && value->is_number())
                    node.grid[step] = uint8_t(std::floor(std::clamp(value->get<double>(), 0.0, max_mask) + 0.5));
            }
            saved["grid"] = node.grid;
        }
        if (const auto table = n.find("modalTable"); node.type == Type::modal && table != n.end()) {
            if (!table->is_array() || table->empty() || table->size() > kModes)
                throw std::invalid_argument("Invalid resonance table size");
            node.custom_modal = true;
            Json rows = Json::array();
            for (size_t k = 0; k < table->size(); ++k) {
                const auto &row = (*table)[k];
                const auto field = [&](const char *name, double min, double max) {
                    const auto &value = row.at(name);
                    if (!value.is_number()) throw std::invalid_argument("Invalid resonance table value");
                    const double number = value.get<double>();
                    if (!std::isfinite(number) || number < min || number > max)
                        throw std::invalid_argument("Resonance table value out of range");
                    return number;
                };
                const double ratio = field("ratio", kModalRatioMin, kModalRatioMax);
                const double gain = field("gain", kModalGainMin, kModalGainMax);
                const double decay = field("decay", kModalDecayMin, kModalDecayMax);
                node.custom_material.ratios[k] = ratio;
                node.custom_material.gains[k] = gain;
                node.modal_decay[k] = decay;
                rows.push_back({{"ratio", ratio}, {"gain", gain}, {"decay", decay}});
            }
            saved["modalTable"] = std::move(rows);
        }
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
    const auto is_global = [&](int i) { return kGlobal[size_t(graph.nodes[size_t(i)].type)]; };
    int fx_count = 0;
    bool fx_output = false;
    for (int i = 0; i < graph.size; ++i) {
        const auto type = graph.nodes[size_t(i)].type;
        fx_count += type == Type::echo || type == Type::chorus || type == Type::reverb || type == Type::guitarAmp;
        fx_output |= type == Type::fxOutput;
    }
    if (!graph.output_count && !fx_output) throw std::invalid_argument("Missing output");
    if (fx_count > int(kFxSlots)) throw std::invalid_argument("Too many patch effects");

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
            if (knob == params.end() || knob->fixed) throw std::invalid_argument("Invalid parameter input");
            dest_port = int(kMaxInputs) + int(knob - params.begin());
            node.modulated = true;
        } else {
            dest_port = port_index(specs[dest]->inputs, input);
        }
        auto &link = node.links[dest_port];
        if (link.node >= 0) throw std::invalid_argument("Duplicate input");
        if (is_global(source) && !is_global(dest)) throw std::invalid_argument("Patch effects feed only patch effects");
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
    // Voice modules keep their order; patch effects move to their own list.
    int voice_count = 0, slot = 0;
    for (int i = 0; i < count; ++i) {
        const int index = graph.order[size_t(i)];
        if (!is_global(index)) { graph.order[size_t(voice_count++)] = index; continue; }
        auto &node = graph.nodes[size_t(index)];
        if (node.type != Type::fxOutput) node.slot = slot++;
        graph.globals[size_t(graph.global_count++)] = index;
        for (int input = 0; input < 2; ++input) {
            const auto link = node.links[size_t(input)];
            if (link.node >= 0 && !is_global(link.node))
                graph.bus_links[size_t(graph.bus_count++)] = {index, input, link.node, link.port};
        }
    }
    graph.size_voice = voice_count;

    std::array<bool, kNodes> seen{};
    std::vector<int> audible(graph.outputs.begin(), graph.outputs.begin() + graph.output_count);
    for (int i = 0; i < graph.global_count; ++i)
        if (graph.nodes[size_t(graph.globals[size_t(i)])].type == Type::fxOutput) audible.push_back(graph.globals[size_t(i)]);
    for (int node : audible) seen[node] = true;
    for (size_t i = 0; i < audible.size(); ++i) {
        const int index = audible[i];
        // Modules that ring on after their gate falls keep a released voice alive until quiet.
        const auto type = graph.nodes[index].type;
        if (type == Type::adsr || type == Type::functionGen || type == Type::string || type == Type::physString || type == Type::physBowed ||
            type == Type::modal || type == Type::bowed || type == Type::reedPipe)
            graph.envelopes[graph.envelope_count++] = index;
        if (type == Type::drumVoice) graph.envelopes[graph.envelope_count++] = index;
        for (auto link : graph.nodes[index].links) {
            if (link.node < 0 || seen[link.node]) continue;
            seen[link.node] = true;
            audible.push_back(link.node);
        }
    }
    graph.autonomous = graph.clock_count != 0;
    for (int i = 0; i < graph.size; ++i) {
        if (graph.nodes[i].type != Type::midi) continue;
        graph.autonomous = false;
        graph.voice_mode = int(graph.nodes[i].knobs[0]);
        graph.glide = graph.nodes[i].knobs[1];
        graph.glide_legato_only = graph.nodes[i].knobs[2] != 0;
        graph.bend_range = graph.nodes[i].knobs[3];
        break;
    }
    macros = {};
    const auto m = patch.find("macros");
    if (m != patch.end() && m->is_array()) {
        for (size_t i = 0; i < std::min(m->size(), macros.size()); ++i) {
            if ((*m)[i].is_number()) macros[i] = std::clamp((*m)[i].get<double>(), 0.0, 1.0);
        }
    }
    std::array<std::string, kMacroCount> macro_names{};
    if (const auto names = patch.find("macroNames"); names != patch.end() && names->is_array()) {
        for (size_t i = 0; i < std::min(names->size(), macro_names.size()); ++i) {
            if (!(*names)[i].is_string()) continue;
            const auto &name = (*names)[i].get_ref<const std::string &>();
            size_t characters = 0, bytes = 0;
            for (; bytes < name.size(); ++bytes) {
                if ((static_cast<unsigned char>(name[bytes]) & 0xc0) != 0x80 && characters++ == 24) break;
            }
            macro_names[i] = name.substr(0, bytes);
        }
    }
    patch = {{"version", 1}, {"nodes", std::move(nodes)}, {"cables", std::move(cables)},
             {"macros", macros}, {"macroNames", macro_names}};
    for (int i = 0; i < graph.size; ++i) {
        auto &node = graph.nodes[i];
        if (node.type == Type::wavetable) node.wavetable = wavetable_bank(size_t(node.knobs[0]));
    }
    return graph;
}

struct Stage {
    double phase = 0, env = 0, release = 0, ic1 = 0, ic2 = 0, ic3 = 0, ic4 = 0, memory = 0;
    double p0 = 0, p1 = 0, p2 = 0, value = 0, prev = 0, amp = 0;
    uint32_t rng = 1;
    int mode = 0, write = 0;
    bool gate = false, ready = false;
    std::array<double, kModes> y1{}, y2{}, a1{}, a2{}, b{};
    std::array<double, 5> key{NAN, NAN, NAN, NAN, NAN};
};
using Line = std::array<float, kLineSamples>;

struct Voice {
    bool active = false, key_down = false, held = false, clap_note = false;
    int16_t channel = 0, key = -1;
    int32_t note_id = -1;
    uint64_t age = 0, tail = 0;
    double velocity = 0, glide = 0; // glide: semitones still to slide
    // Per-note values from polyphonic aftertouch or CLAP note expressions. NaN leaves the channel's CC.
    double pressure = 0, tuning = 0, brightness = NAN, expression = NAN;
    void reset_expressions() { pressure = 0; tuning = 0; brightness = NAN; expression = NAN; }
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
    std::array<double, 16> bend{}, pressure{}; // bend: -1..1
    std::array<double, 16 * 128> cc{};
    std::array<bool, 16> sustain{};
    std::array<double, kNodes> clock_phases{};
    // Patch effect state: one buffer per slot, sized by prepare() outside the audio thread.
    struct Fx {
        std::vector<float> buf;
        std::array<int, 24> pos{};
        std::array<double, 24> mem{};
    };
    std::array<Fx, kFxSlots> fx{};
    std::array<std::array<double, 2>, kNodes> gsig{}, bus{};
    int echo_length = 0, chorus_length = 0;

    static int reverb_length(double rate, int samples, int channel) {
        return std::max(1, int(std::round((samples + channel * kReverbSpread) * rate / 44100)));
    }
    void prepare(double sample_rate) {
        rate = sample_rate;
        echo_length = int(std::ceil(kEchoSeconds * rate)) + 4;
        chorus_length = int(std::ceil(0.064 * rate)) + 4;
        for (auto &slot : fx) slot.buf.assign(size_t(2 * echo_length), 0.0f);
        clear_fx();
    }
    void clear_fx() {
        for (auto &slot : fx) { std::fill(slot.buf.begin(), slot.buf.end(), 0.0f); slot.pos = {}; slot.mem = {}; }
        gsig = {}; bus = {};
    }

    // Host transport: tempo, play state and beat (quarter note) position, advanced every sample.
    struct Host { double bpm = 120, beat = 0; bool playing = false; } host;
    uint64_t clock = 0;
    // Held keys in Mono and Legato, most recent last.
    struct Held { int16_t channel, key; int32_t id; double velocity; bool clap_note; };
    std::array<Held, 16> stack{};
    int held_count = 0, last_key = -1;

    // Voices hold their delay lines, so they are reset in place rather than by assigning a
    // temporary, which would put hundreds of kilobytes on the stack.
    void reset() {
        for (auto &v : voices) { v.active = v.key_down = v.held = v.clap_note = false; v.tail = 0; }
        bend = {}; sustain = {}; clock_phases = {}; clock = 0; held_count = 0; last_key = -1; host = {};
        for (int channel = 0; channel < 16; ++channel) reset_controllers(channel);
    }

    // MIDI's recommended controller defaults: volume 100, pan centred, expression full; others 0.
    void reset_controllers(int channel) {
        bend[size_t(channel)] = 0;
        pressure[size_t(channel)] = 0;
        double *c = cc.data() + channel * 128;
        std::fill(c, c + 128, 0.0);
        c[7] = 100 / 127.0; c[10] = 64 / 127.0; c[11] = 1;
    }

    // Called at the start of a block; while playing the beat advances until the next call resyncs it.
    void transport(double bpm, bool playing, double beat) {
        if (bpm > 0 && std::isfinite(bpm)) host.bpm = std::clamp(bpm, 1.0, 1000.0);
        host.playing = playing;
        if (playing && std::isfinite(beat)) host.beat = beat;
    }

    void pitch_bend(int channel, int value) { bend[size_t(channel)] = (value - 8192) / 8192.0; }
    void channel_pressure(int channel, int value) { pressure[size_t(channel)] = std::clamp(value, 0, 127) / 127.0; }
    void poly_pressure(int channel, int key, int value) {
        for (auto &v : voices)
            if (matches(v, channel, key, -1)) v.pressure = std::clamp(value, 0, 127) / 127.0;
    }
    // Per-note tuning (semitones), pressure, brightness (read as CC74) and expression (read as CC11).
    void note_expression(int id, int channel, int key, int32_t note_id, double value) {
        if (!std::isfinite(value)) return;
        for (auto &v : voices) {
            if (!matches(v, channel, key, note_id)) continue;
            if (id == kExpressionTuning) v.tuning = std::clamp(value, -120.0, 120.0);
            else if (id == kExpressionPressure) v.pressure = std::clamp(value, 0.0, 1.0);
            else if (id == kExpressionBrightness) v.brightness = std::clamp(value, 0.0, 1.0);
            else if (id == kExpressionExpression) v.expression = std::clamp(value, 0.0, 1.0);
        }
    }

    // Stores a controller value; sustain and the channel-mode messages are handled by the caller.
    void controller(int channel, int number, int value) {
        if (number >= 0 && number < 120) cc[size_t(channel * 128 + number)] = std::clamp(value, 0, 127) / 127.0;
        if (number == 121) {
            reset_controllers(channel);
            for (auto &v : voices) if (v.channel == channel) v.reset_expressions();
        }
    }

    NoteEnd note_on(int channel, int key, int32_t id, double velocity, bool clap_note) {
        if (graph.autonomous) return {};
        if (graph.voice_mode) return mono_note_on(channel, key, id, velocity, clap_note);
        auto chosen = voices.begin();
        for (auto it = voices.begin(); it != voices.end(); ++it) {
            if (!it->active) { chosen = it; break; }
            if (it->held == chosen->held ? it->age < chosen->age : !it->held) chosen = it;
        }
        return start(*chosen, channel, key, id, velocity, clap_note);
    }

    NoteEnd start(Voice &v, int channel, int key, int32_t id, double velocity, bool clap_note) {
        const NoteEnd previous{v.active && v.clap_note, v.channel, v.key, v.note_id};
        v.active = v.key_down = v.held = true;
        v.clap_note = clap_note;
        v.channel = int16_t(channel); v.key = int16_t(key); v.note_id = id;
        v.age = ++clock; v.tail = 0; v.velocity = velocity; v.glide = 0;
        v.reset_expressions();
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

    // Mono and Legato play voice 0 with last-note priority, as the Synth instrument does.
    NoteEnd mono_play(const Held &note, bool retrigger, bool overlap) {
        auto &v = voices[0];
        double offset = 0;
        if (graph.glide > 0 && (overlap || !graph.glide_legato_only))
            offset = v.active ? v.key + v.glide - note.key : last_key >= 0 ? double(last_key - note.key) : 0.0;
        last_key = note.key;
        NoteEnd previous;
        if (retrigger || !v.active) {
            previous = start(v, note.channel, note.key, note.id, note.velocity, note.clap_note);
        } else {
            // A legato change hands the sounding voice to another note.
            previous = {v.clap_note && (v.note_id != note.id || v.key != note.key), v.channel, v.key, v.note_id};
            v.channel = note.channel; v.key = note.key; v.note_id = note.id; v.clap_note = note.clap_note;
            v.held = v.key_down = true; v.tail = 0;
            v.reset_expressions();
        }
        v.glide = std::clamp(offset, -96.0, 96.0);
        return previous;
    }

    void forget(int channel, int key) {
        int kept = 0;
        for (int i = 0; i < held_count; ++i)
            if ((channel >= 0 && stack[size_t(i)].channel != channel) || (key >= 0 && stack[size_t(i)].key != key))
                stack[size_t(kept++)] = stack[size_t(i)];
        held_count = kept;
    }

    NoteEnd mono_note_on(int channel, int key, int32_t id, double velocity, bool clap_note) {
        forget(channel, key);
        if (held_count == int(stack.size())) {
            std::move(stack.begin() + 1, stack.end(), stack.begin());
            --held_count;
        }
        const Held note{int16_t(channel), int16_t(key), id, velocity, clap_note};
        stack[size_t(held_count++)] = note;
        const bool overlap = voices[0].active && voices[0].key_down;
        return mono_play(note, !(graph.voice_mode == 2 && overlap), overlap);
    }

    NoteEnd mono_note_off(int channel, int key) {
        forget(channel, key);
        auto &v = voices[0];
        if (!v.active || !v.key_down || v.key != key || v.channel != channel) return {};
        if (held_count) return mono_play(stack[size_t(held_count - 1)], graph.voice_mode != 2, true);
        release(v);
        return {};
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

    // The Synth instrument's soft clipper (tanh-like, exactly +/-1 beyond |x| >= 3).
    static double soft_clip(double x) {
        if (x > 3) return 1;
        if (x < -3) return -1;
        const double x2 = x * x;
        return (x * (27 + x2)) / (27 + 9 * x2);
    }

    static double blep(double phase, double step) {
        if (phase < step) { const double x = phase / step; return x + x - x * x - 1; }
        if (phase > 1 - step) { const double x = (phase - 1) / step; return x * x + x + x + 1; }
        return 0;
    }

    double sample_drum(const Voice &v, const Node &n, Stage &st, const std::array<double, kMaxParams> &p) {
        const bool trigger = read(v, n, 0, v.held) > 0;
        const bool choke = read(v, n, 2) > 0;
        if (trigger && !st.gate && !choke) {
            st.write = int(p[0]);
            st.value = std::clamp(read(v, n, 1, v.velocity), 0.0, 1.0);
            st.env = st.value > 0 ? 1 : 0;
            st.phase = st.p0 = st.prev = st.ic1 = st.ic2 = st.ic3 = 0;
            st.y1.fill(0);
        }
        st.gate = trigger;
        st.mode = st.env > 1e-4 ? 1 : 0;
        if (!st.mode) return 0;
        const int sound = st.write;
        const double t = st.p0, tone = p[3], base_hz = kDrumPitch[sound] * std::pow(2.0, p[1] / 12);
        const double noise = white(st);
        const double corner = sound == 2 || sound == 8 ? base_hz : 900 + 3200 * tone;
        st.prev += (noise - st.prev) * lag(1 / (2 * kPi * corner));
        st.ic1 += (st.prev - st.ic1) * lag(1 / (2 * kPi * (sound == 2 ? base_hz * 0.48 : 420)));
        const double band = st.prev - st.ic1;
        double sample;
        if (sound == 3 || sound == 4 || sound >= 9) {
            constexpr size_t oscillators = sizeof(kHatRatios) / sizeof(kHatRatios[0]);
            static_assert(oscillators <= kModes, "Hat oscillator state capacity");
            double metal = 0;
            for (size_t i = 0; i < oscillators; ++i) {
                const double phase = st.y1[i] + std::min(0.45, base_hz * kHatRatios[i] / rate);
                st.y1[i] = phase - std::floor(phase);
                metal += st.y1[i] < 0.5 ? 1 : -1;
            }
            const double noise_mix = sound == 9 ? 0.86 : sound == 10 ? 0.29 : 0.55;
            const double metal_mix = sound == 10 ? 0.32 + 0.42 * tone : 0.12 + 0.38 * tone;
            sample = noise_mix * (noise - st.prev) + metal_mix * metal / oscillators;
        } else if (sound == 2) {
            const double burst_age = t < 0.024 ? std::fmod(t, 0.012) : t - 0.024;
            sample = band * (0.38 + std::exp(-burst_age / 0.0025) * (1.2 + tone));
        } else if (sound == 7) {
            const double phase1 = st.y1[0] + std::min(0.45, base_hz / rate);
            const double phase2 = st.y1[1] + std::min(0.45, base_hz * 1.48 / rate);
            st.y1[0] = phase1 - std::floor(phase1);
            st.y1[1] = phase2 - std::floor(phase2);
            const double metal = (st.y1[0] < 0.5 ? 0.5 : -0.5) + (st.y1[1] < 0.5 ? 0.5 : -0.5);
            st.ic2 += (metal - st.ic2) * lag(1 / (2 * kPi * (2 + tone) * base_hz));
            st.ic3 += (st.ic2 - st.ic3) * lag(1 / (2 * kPi * base_hz * 0.8));
            sample = (st.ic2 - st.ic3) * (0.58 + 0.42 * std::exp(-t / 0.019));
        } else if (sound == 8) {
            sample = (0.3 * (noise - st.prev) + band * (0.68 + 0.45 * tone)) * (1 - std::exp(-t / 0.009));
        } else {
            const double bend = sound == 0 ? 2.6 : sound == 5 ? 0.58 : sound == 6 ? 0 : 0.16;
            const double hz = sound == 0 && p[5] >= 0
                ? base_hz * std::exp2(p[5] * std::exp(-t / p[6]))
                : base_hz * (1 + bend * std::exp(-t / (sound == 0 ? 0.014 : 0.021)));
            const double phase = st.phase + std::min(0.45, hz / rate);
            st.phase = phase - std::floor(phase);
            const double sine = std::sin(2 * kPi * st.phase);
            if (sound == 1) {
                const double secondary = st.y1[0] + std::min(0.45, hz * 1.46 / rate);
                st.y1[0] = secondary - std::floor(secondary);
                const double body = (0.72 * sine + 0.28 * std::sin(2 * kPi * st.y1[0])) * std::exp(-t / 0.05);
                sample = body * (0.68 - 0.35 * tone) + band * (0.68 + 0.55 * tone);
            } else if (sound == 6) {
                const double secondary = st.y1[0] + std::min(0.45, hz * 0.27 / rate);
                st.y1[0] = secondary - std::floor(secondary);
                const double click = (noise - st.prev) * tone * std::exp(-t / 0.0025);
                sample = std::tanh(1.4 * sine + 0.45 * std::sin(2 * kPi * st.y1[0]) + 0.65 * click);
            } else {
                const double click = (noise - st.prev) * tone * std::exp(-t / 0.0035);
                sample = sound == 0 ? std::tanh(1.9 * sine + 0.5 * click) : 0.9 * sine + 0.38 * click;
            }
        }
        const double out = sample * st.env * st.value * p[4];
        const double t60 = choke ? 0.018 : p[2] * kDrumDecay[sound];
        st.env *= std::exp(-kLn1000 / (rate * t60));
        st.p0 += 1 / rate;
        return out;
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
        case Type::midi: {
            const double b = bend[size_t(v.channel)];
            const int number = int(p[4]);
            double value = cc[size_t(v.channel * 128 + number)];
            if (number == 74 && !std::isnan(v.brightness)) value = v.brightness;
            else if (number == 11 && !std::isnan(v.expression)) value = v.expression;
            sig = {v.key + v.glide + b * graph.bend_range + v.tuning, v.held ? 1.0 : 0.0, v.velocity, b,
                   cc[size_t(v.channel * 128 + 1)], std::max(pressure[size_t(v.channel)], v.pressure), value};
            break;
        }
        case Type::clock:
            if (p[3] != 0 && !host.playing) {
                sig[0] = sig[1] = 0;
                sig[2] = 1;
                break;
            }
            sig[1] = p[3] != 0 ? host.beat * p[1] - std::floor(host.beat * p[1]) : clock_phases[i];
            sig[0] = sig[1] < p[2] ? 1 : 0;
            sig[2] = 0;
            break;
        case Type::gatedClock: {
            const bool run = read(v, n, 0, v.key_down) > 0;
            sig[0] = run && st.phase < p[2] ? 1 : 0;
            sig[1] = run ? st.phase : 0;
            sig[2] = run ? 0 : 1;
            const double phase = st.phase + (p[3] != 0 ? host.bpm : p[0]) * p[1] / (60 * rate);
            st.phase = run ? phase - std::floor(phase) : 0;
            break;
        }
        case Type::beatGrid: {
            const bool high = read(v, n, 0) > 0;
            const bool reset = read(v, n, 1) > 0;
            const int length = int(p[0]);
            if (reset) {
                st.mode = st.write = 0;
            } else if (high && !st.ready) {
                st.write = st.mode ? (st.write + 1) % length : 0;
                st.mode = 1;
            }
            st.ready = high;
            const int step = std::min(st.write, length - 1);
            const int lanes = high && st.mode ? n.grid[step] : 0;
            for (size_t lane = 0; lane < sig.size(); ++lane) sig[lane] = (lanes >> lane) & 1;
            break;
        }
        case Type::divider:
        case Type::sequencer: {
            const bool high = read(v, n, 0) > 0;
            const bool sequence = n.type == Type::sequencer;
            const int length = int(p[0]);
            if (read(v, n, 1) > 0) {
                st.mode = st.write = 0;
                st.value = 0;
            } else if (high && !st.ready) {
                st.write = st.mode ? (st.write + 1) % length : 0;
                st.mode = 1;
                st.value = sequence ? (white(st) + 1) * 0.5 < p[1] : st.write == 0;
            }
            st.ready = high;
            if (sequence) {
                sig[0] = p[2 + std::min(st.write, length - 1)];
                sig[1] = high ? st.value : 0;
            } else sig[0] = high ? st.value : 0;
            break;
        }
        case Type::quantizer: {
            constexpr int scales[] = {0xfff, 0xab5, 0x5ad, 0x295, 0x4a9};
            const double pitch = std::clamp(read(v, n, 0, 60), 0.0, 127.0);
            const int root = int(p[0]), mask = scales[int(p[1])];
            int lower = int(std::floor(pitch)), upper = int(std::ceil(pitch));
            while (lower >= 0 && !(mask & (1 << ((lower + 12 - root) % 12)))) --lower;
            while (upper <= 127 && !(mask & (1 << ((upper + 12 - root) % 12)))) ++upper;
            sig[0] = upper > 127 || (lower >= 0 && pitch - lower <= upper - pitch) ? lower : upper;
            break;
        }
        case Type::vco: {
            const double note = read(v, n, 0, 69) + 12 * p[1] + p[2] / 100 + read(v, n, 1) * 12;
            const double step = std::clamp(440 * std::exp2((note - 69) / 12), 0.01, rate * 0.45) / rate;
            if (!st.ready) { st.phase = std::fmod(p[5], 1.0); st.ready = true; }
            if (n.links[2].node >= 0) {
                // Hard sync: restart the cycle where the sync input rises through zero.
                const double sync = read(v, n, 2);
                if (sync > 0 && st.value <= 0) st.phase = 0;
                st.value = sync;
            }
            double phase = st.phase;
            if (n.links[3].node >= 0) {
                // Phase modulation in radians, the Synth instrument's FM.
                phase += read(v, n, 3) / (2 * kPi);
                phase -= std::floor(phase);
            }
            double wave;
            switch (int(p[0])) {
            case 0: wave = std::sin(2 * kPi * phase); break;
            case 1: wave = 2 * phase - 1 - blep(phase, step); break;
            case 2: // Without its DC offset, as in the Synth instrument.
                wave = (phase < p[4] ? 1 : -1) + blep(phase, step) - blep(std::fmod(phase + 1 - p[4], 1.0), step) - (2 * p[4] - 1);
                break;
            default: wave = 2 / kPi * std::asin(std::sin(2 * kPi * phase)); break;
            }
            sig[0] = wave * p[3];
            const double next = st.phase + step;
            sig[1] = next >= 1 ? 1 : 0;
            st.phase = std::fmod(next, 1.0);
            break;
        }
        case Type::wavetable: {
            const bool sync = read(v, n, 3) > 0;
            if (!st.ready || (sync && !st.gate)) {
                for (size_t copy = 0; copy < 7; ++copy) {
                    const double phase = p[7] + copy * 0.6180339887498949;
                    st.y1[copy] = phase - std::floor(phase);
                }
                st.ready = true;
            }
            st.gate = sync;
            const double note = read(v, n, 0, 69) + p[8] / 100 + 12 * (p[2] + read(v, n, 1));
            const double pm = read(v, n, 2) / (2 * kPi);
            const int copies = int(p[4]);
            double mono = 0, left = 0, right = 0;
            sig[3] = 0;
            for (int copy = 0; copy < copies; ++copy) {
                const double offset = copies == 1 ? 0 : 2.0 * copy / (copies - 1) - 1;
                const double hz = 440 * std::exp2((note - 69 + offset * p[5] / 200) / 12);
                const double inc = std::clamp(hz / rate, 0.01 / rate, 0.45);
                const double sample = wavetable_sample(n.wavetable, st.y1[copy], inc, p[1], pm);
                const double phase = st.y1[copy] + inc;
                if (copy == 0 && phase >= 1) sig[3] = 1;
                st.y1[copy] = phase < 1 ? phase : phase - 1;
                mono += sample;
                left += sample * std::sqrt(1 - offset * p[6]);
                right += sample * std::sqrt(1 + offset * p[6]);
            }
            const double gain = p[3] / copies;
            sig[0] = mono * gain;
            sig[1] = left * gain;
            sig[2] = right * gain;
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
                if (p[4] != 0) {
                    st.env = p[2] + std::exp(-kLn1000 / (p[1] * rate)) * (st.env - p[2]);
                } else {
                    st.env -= (1 - p[2]) / std::max(1.0, p[1] * rate);
                    if (st.env <= p[2]) { st.env = p[2]; st.mode = 3; }
                }
                break;
            case 3: st.env = p[2]; break;
            case 4:
                if (p[4] != 0) {
                    st.env *= std::exp(-kLn1000 / (p[3] * rate));
                    if (st.env < 0.00001) { st.env = 0; st.mode = 0; }
                } else {
                    st.env -= st.release / std::max(1.0, p[3] * rate);
                    if (st.env <= 0) { st.env = 0; st.mode = 0; }
                }
                break;
            }
            sig[0] = st.env;
            break;
        }
        case Type::vcf: {
            const double track = p[3] * (read(v, n, 2, 60) - 60) / 12;
            const double cutoff = std::clamp(p[0] * std::exp2(read(v, n, 1) * 2 + track), 20.0, rate * 0.45);
            const double g = std::tan(kPi * cutoff / rate), k = 2 - 1.95 * p[1];
            const int mode = int(p[2]);
            double input = read(v, n, 0);
            if (p[5] > 0) input = soft_clip(input * (1 + 8 * p[5])) / (1 + 1.5 * p[5]);
            if (p[4] != 0) {
                // 24 dB: a Butterworth stage before the resonant one, as in the Synth instrument.
                const double hp = (input - (g + 1.414) * st.ic3 - st.ic4) / (1 + g * (g + 1.414));
                const double bp = g * hp + st.ic3, lp = g * bp + st.ic4;
                st.ic3 = 2 * bp - st.ic3;
                st.ic4 = 2 * lp - st.ic4;
                input = mode == 0 ? lp : mode == 1 ? hp : mode == 2 ? bp : lp + hp;
            }
            const double hp = (input - (g + k) * st.ic1 - st.ic2) / (1 + g * (g + k));
            const double bp = g * hp + st.ic1, lp = g * bp + st.ic2;
            st.ic1 = 2 * bp - st.ic1;
            st.ic2 = 2 * lp - st.ic2;
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
        case Type::functionGen: {
            const bool trigger = read(v, n, 0, v.held) > 0;
            const bool loop = p[3] != 0 && read(v, n, 1, v.held) > 0;
            if ((trigger && !st.ready) || (loop && st.mode == 0)) {
                st.mode = 1;
                st.phase = 0;
            }
            st.ready = trigger;
            sig[1] = 0;
            if (st.mode == 1) {
                st.phase = std::min(1.0, st.phase + 1 / (rate * p[0]));
                if (st.phase == 1) st.mode = 2;
            } else if (st.mode == 2) {
                st.phase = std::max(0.0, st.phase - 1 / (rate * p[1]));
                if (st.phase == 0) {
                    st.mode = 0;
                    sig[1] = 1;
                }
            }
            sig[0] = std::pow(st.phase, std::pow(4.0, p[2]));
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
        case Type::drumVoice: sig[0] = sample_drum(v, n, st, p); break;
        case Type::ring: sig[0] = read(v, n, 0) * read(v, n, 1, 1) * p[0]; break;
        case Type::wavefolder: {
            const double input = read(v, n, 0);
            const double x = input * p[0] + p[1];
            const double period = x + 1 - 4 * std::floor((x + 1) / 4);
            const double wet = p[3] ? std::tanh(x) : 1 - std::abs(period - 2);
            sig[0] = input + (wet - input) * p[2];
            break;
        }
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
        case Type::physString: {
            // The Physical instrument's String model (see the Web engine).
            auto &line = v.lines[size_t(n.line)];
            const bool gate = read(v, n, 1, 1) >= 0.5;
            const double hz = std::clamp(440 * std::pow(2.0, (read(v, n, 0, 69) - 69) / 12),
                rate / double(kLineSamples - 4), rate * 0.45);
            const double damping = 0.05 + 0.9 * p[3];
            if (st.key[0] != hz || st.key[1] != damping) {
                st.key[0] = hz;
                st.key[1] = damping;
                const double w = 2 * kPi * hz / rate;
                st.a1[0] = std::clamp(rate / hz - std::atan2(damping * std::sin(w), 1 - damping * std::cos(w)) / w,
                    2.0, double(kLineSamples - 2));
                st.a1[1] = 1.2 * std::clamp(std::pow(hz / 220, 0.3), 0.7, 2.0);
                st.key[2] = NAN;
            }
            if (gate && !st.gate) {
                line.fill(0);
                const int count = int(std::ceil(st.a1[0]));
                const double bright = std::clamp(p[5] * (0.6 + 0.4 * std::clamp(read(v, n, 2, 1), 0.0, 1.0)), 0.02, 1.0);
                const double a = bright * bright, norm = 1 / std::sqrt(a / (2 - a));
                const bool strike = p[0] >= 0.5;
                const double width = std::max(2.0, count * (0.5 - 0.45 * bright));
                double lp = 0;
                for (int i = 0; i < count; ++i) {
                    double x;
                    if (strike) x = i < width ? 0.5 - 0.5 * std::cos(2 * kPi * i / width) : 0;
                    else { lp += a * (white(st) - lp); x = lp * norm * 0.5; }
                    line[size_t((st.write + i) & kLineMask)] = float(x);
                }
                const int pick = std::max(1, int(std::round(p[4] * count)));
                for (int i = count - 1; i >= pick; --i)
                    line[size_t((st.write + i) & kLineMask)] = float(double(line[size_t((st.write + i) & kLineMask)]) -
                        double(line[size_t((st.write + i - pick) & kLineMask)]));
                st.write = (st.write + count) & kLineMask;
                st.prev = 0;
            }
            st.gate = gate;
            const double t60 = gate ? p[1] : std::min(p[1], p[2]);
            if (st.key[2] != t60) { st.key[2] = t60; st.a2[0] = std::exp(-kLn1000 / (hz * t60)); }
            const double y = line_read(line, st.write, st.a1[0]);
            st.prev = (1 - damping) * y + damping * st.prev;
            const double feedback = std::clamp(st.prev * st.a2[0], -4.0, 4.0);
            line[size_t(st.write)] = float(feedback);
            st.write = (st.write + 1) & kLineMask;
            st.amp = std::max(std::abs(feedback), st.amp * 0.9995);
            st.mode = st.amp > 1e-4 ? 1 : 0;
            sig[0] = feedback * st.a1[1] * p[6];
            break;
        }
        case Type::physBowed: {
            // The Physical instrument's Bowed model (see the Web engine).
            auto &bridge = v.lines[size_t(n.line)], &nut = v.lines[size_t(n.line + 1)];
            const double hz = std::clamp(440 * std::pow(2.0, (read(v, n, 0, 69) - 69) / 12),
                rate / double(kLineSamples - 4), rate * 0.45);
            const double damping = 0.1 + 0.75 * (1 - p[3]), position = p[2];
            if (st.key[0] != hz || st.key[1] != damping || st.key[2] != position) {
                st.key[0] = hz;
                st.key[1] = damping;
                st.key[2] = position;
                const double w = 2 * kPi * hz / rate;
                const double total = rate / hz - std::atan2(damping * std::sin(w), 1 - damping * std::cos(w)) / w;
                st.a1[0] = std::clamp(total * position, 2.0, double(kLineSamples - 2));
                st.a1[1] = std::clamp(total * (1 - position), 2.0, double(kLineSamples - 2));
            }
            if (!st.ready) {
                st.ready = true;
                const double body_hz[2] = {290, 1150}, body_k[2] = {0.6, 0.9};
                for (int k = 0; k < 2; ++k) {
                    const double g = std::tan(kPi * body_hz[k] / rate);
                    st.a2[size_t(3 * k)] = 1 / (1 + g * (g + body_k[k]));
                    st.a2[size_t(3 * k + 1)] = g * st.a2[size_t(3 * k)];
                    st.a2[size_t(3 * k + 2)] = g * st.a2[size_t(3 * k + 1)];
                }
            }
            const double bow = std::clamp(read(v, n, 1), 0.0, 1.0) * (0.03 + 0.25 * p[0]);
            const double bridge_out = line_read(bridge, st.write, st.a1[0]), nut_out = line_read(nut, st.write, st.a1[1]);
            st.prev = (1 - damping) * bridge_out + damping * st.prev;
            const double reflected_bridge = -st.prev * 0.95, reflected_nut = -nut_out;
            const double relative = bow - (reflected_bridge + reflected_nut);
            const double friction = std::min(1.0, std::pow(std::abs(relative * (5 - 4 * p[1])) + 0.75, -4.0));
            nut[size_t(st.write)] = float(std::clamp(reflected_bridge + relative * friction, -4.0, 4.0));
            bridge[size_t(st.write)] = float(std::clamp(reflected_nut + relative * friction, -4.0, 4.0));
            st.write = (st.write + 1) & kLineMask;
            double body = 0;
            for (int k = 0; k < 2; ++k) {
                double &ic1 = k ? st.ic3 : st.ic1, &ic2 = k ? st.ic4 : st.ic2;
                const double a1 = st.a2[size_t(3 * k)], a2 = st.a2[size_t(3 * k + 1)], a3 = st.a2[size_t(3 * k + 2)];
                const double v3 = bridge_out - ic2, v1 = a1 * ic1 + a2 * v3, v2 = ic2 + a2 * ic1 + a3 * v3;
                ic1 = 2 * v1 - ic1;
                ic2 = 2 * v2 - ic2;
                body += (k ? 0.8 : 1.2) * v1;
            }
            st.amp = std::max(std::abs(bridge_out), st.amp * 0.9995);
            st.mode = bow > 1e-5 || st.amp > 1e-4 ? 1 : 0;
            sig[0] = (bridge_out + body) * 1.6 * p[4];
            break;
        }
        case Type::bowed: {
            const bool gate = read(v, n, 1, v.held) >= 0.5;
            const double target = gate ? p[0] * std::clamp(read(v, n, 2, 1), 0.0, 1.0) : 0;
            st.env += (target - st.env) * lag(gate ? 0.015 : 0.008);
            const double hz = std::clamp(440 * std::pow(2.0, (read(v, n, 0, 69) - 69) / 12),
                rate / (2 * (kLineSamples - 2)), rate * 0.2);
            const double half_period = 0.5 * rate / hz;
            auto &bridge = v.lines[size_t(n.line)], &nut = v.lines[size_t(n.line + 1)];
            const double bridge_out = line_read(bridge, st.write, std::max(1.0, half_period * p[2]));
            const double nut_out = line_read(nut, st.write, std::max(1.0, half_period * (1 - p[2])));
            st.prev += (bridge_out - st.prev) * (1 - p[3]);
            const double reflected_bridge = -0.95 * st.prev, reflected_nut = -0.995 * nut_out;
            const double relative = st.env - reflected_bridge - reflected_nut;
            const double friction = st.env > 1e-5 ? std::min(1.0, std::pow(0.75 + std::abs(relative * p[1]), -4)) : 0;
            const double bow = relative * friction;
            bridge[st.write] = float(std::clamp(reflected_nut + bow, -4.0, 4.0));
            nut[st.write] = float(std::clamp(reflected_bridge + bow, -4.0, 4.0));
            st.write = (st.write + 1) & kLineMask;
            st.amp = std::max(std::abs(bridge_out), st.amp * 0.9995);
            st.gate = gate;
            st.mode = st.env > 1e-5 || st.amp > 1e-4 ? 1 : 0;
            sig[0] = bridge_out * p[4];
            break;
        }
        case Type::reedPipe: {
            auto &line = v.lines[size_t(n.line)];
            const bool gate = read(v, n, 1, v.held) >= 0.5;
            const double breath = std::clamp(read(v, n, 2, 1), 0.0, 1.0) * p[0];
            st.env += ((gate ? breath : 0) - st.env) * lag(gate ? p[3] : 0.018);
            const double hz = std::clamp(440 * std::pow(2.0, (read(v, n, 0, 69) - 69) / 12),
                rate / (2 * (kLineSamples - 2)), rate * 0.2);
            if (st.key[0] != hz || st.key[1] != p[2]) {
                // Compensate the reflection filter's phase delay at the fundamental.
                st.key[0] = hz;
                st.key[1] = p[2];
                const double w = 2 * kPi * hz / rate;
                const double damping = std::exp(-2 * kPi * std::max(1100 + 1800 * p[2], 5 * hz) / rate);
                const double phase_delay = std::atan2(damping * std::sin(w), 1 - damping * std::cos(w)) / w;
                st.a1[0] = damping;
                st.a2[0] = std::max(1.0, rate * 0.5 / hz - phase_delay);
            }
            const double bore = line_read(line, st.write, st.a2[0]);
            st.prev += (bore - st.prev) * (1 - st.a1[0]);
            const double stiffness = 0.2 + 0.25 * p[1];
            const double noise = white(st);
            const double pressure = st.env * (0.52 + 0.16 * st.env) / stiffness * (1 + 0.07 * p[4] * noise);
            const double delta = -0.95 * st.prev - pressure;
            const double opening = std::clamp(0.7 - stiffness * delta, -1.0, 1.0);
            line[st.write] = float(std::clamp(pressure + delta * opening, -2.0, 2.0));
            st.write = (st.write + 1) & kLineMask;
            st.ic1 += (bore - st.ic1) * lag(1 / (2 * kPi * 22));
            st.ic2 += (noise - st.ic2) * lag(1 / (2 * kPi * 1400));
            const double ringing = bore - st.ic1;
            st.amp = std::max(std::abs(ringing), st.amp * 0.9995);
            st.gate = gate;
            st.mode = st.env > 1e-5 || st.amp > 1e-4 ? 1 : 0;
            sig[0] = (ringing + (noise - st.ic2) * st.env * p[4] * 0.07) * p[5];
            break;
        }
        case Type::modal: {
            const bool gate = read(v, n, 2, 1) >= 0.5;
            const bool hit = gate && !st.gate;
            st.gate = gate;
            const double material = n.custom_modal ? -1 : p[0];
            const double t60 = gate ? p[1] : std::min(p[1], p[2]), brightness = p[3];
            const double hz = 440 * std::pow(2.0, (read(v, n, 1, 69) - 69) / 12);
            if (st.key[0] != hz || st.key[1] != material || st.key[2] != t60 || st.key[3] != brightness || st.key[4] != p[6]) {
                st.key = {hz, material, t60, brightness, p[6]};
                const auto &mat = n.custom_modal ? n.custom_material : kMaterials[size_t(material)];
                for (size_t k = 0; k < kModes; ++k) {
                    const double ratio = mat.ratios[k], f = hz * ratio;
                    if (!(f > 0 && f < rate * 0.45)) { st.a1[k] = st.a2[k] = st.b[k] = 0; continue; }
                    // Darker settings damp the upper modes faster, as in the Physical instrument.
                    const double t = t60 * (n.custom_modal ? n.modal_decay[k] : 1) /
                        std::max(0.25, 1 + (1 - brightness) * 4 * (ratio - 1));
                    const double r = std::exp(-kLn1000 / (t * rate));
                    const double w = 2 * kPi * f / rate;
                    const double strike_gain = p[6] == 0 ? 1 : 0.3 + 0.7 * std::abs(std::sin(kPi * (k + 1) * p[6]));
                    st.a1[k] = 2 * r * std::cos(w); st.a2[k] = r * r; st.b[k] = strike_gain * mat.gains[k] * std::sin(w);
                }
            }
            if (hit) {
                st.value = std::clamp(read(v, n, 3, 1), 0.0, 1.0);
                st.write = 0;
                const double contact = 0.6 - 0.56 * p[5] * (0.7 + 0.3 * st.value);
                st.p0 = p[5] >= 1 ? 1 : std::clamp(std::round(rate * contact / std::max(1.0, hz)), 2.0, 4096.0);
            }
            double strike = 0;
            if (st.write < st.p0) {
                strike = st.p0 == 1 ? st.value : st.value * (1 - std::cos(2 * kPi * st.write / st.p0)) / st.p0;
                ++st.write;
            }
            const double x = read(v, n, 0) + strike;
            double sum = 0;
            for (size_t k = 0; k < kModes; ++k) {
                const double y = st.b[k] * x + st.a1[k] * st.y1[k] - st.a2[k] * st.y2[k];
                st.y2[k] = st.y1[k]; st.y1[k] = y; sum += y;
            }
            st.amp = std::max(std::abs(sum), st.amp * 0.9995);
            st.mode = st.write < st.p0 || st.amp > 1e-4 ? 1 : 0;
            sig[0] = std::clamp(sum * p[4], -16.0, 16.0);
            break;
        }
        case Type::vca: sig[0] = read(v, n, 0) * read(v, n, 1, 1) * p[0]; break;
        case Type::mix: sig[0] = read(v, n, 0) * p[0] + read(v, n, 1) * p[1]; break;
        case Type::mix4:
            sig[0] = read(v, n, 0) * p[0] + read(v, n, 1) * p[1] + read(v, n, 2) * p[2] + read(v, n, 3) * p[3];
            break;
        case Type::cv: sig[0] = read(v, n, 0) * p[0] + p[1]; break;
        case Type::macro:
            sig[0] = p[1] + (p[2] - p[1]) * std::pow(macros[size_t(p[0]) - 1], std::pow(4.0, p[3]));
            break;
        case Type::delay: sig[0] = st.memory; break;
        case Type::pan: {
            const int slot = int(&v - voices.data());
            const double spread = graph.voice_mode ? 0 : (slot % 2 ? 1 : -1) * (1 - (slot / 2) / 4.0);
            const double pan = std::clamp(p[0] + spread * p[1], -1.0, 1.0);
            const double input = read(v, n, 0);
            sig[0] = input * std::sqrt((1 - pan) * 0.5);
            sig[1] = std::clamp(input * std::sqrt((1 + pan) * 0.5), -1e6, 1e6);
            break;
        }
        case Type::output: {
            const double left = read(v, n, 0);
            sig[0] = left * p[0];
            sig[1] = std::clamp(read(v, n, 1, left) * p[0], -1e6, 1e6);
            break;
        }
        }
        sig[0] = std::clamp(sig[0], -1e6, 1e6);
    }

    static double fx_read(const std::vector<float> &buf, int start, int length, int write, double delay) {
        const double pos = write - delay, base = std::floor(pos), frac = pos - base;
        const int a = ((int(base) % length) + length) % length, b = a + 1 == length ? 0 : a + 1;
        return buf[size_t(start + a)] * (1 - frac) + buf[size_t(start + b)] * frac;
    }
    static double flush(double x) { return std::abs(x) < 1e-20 ? 0 : x; }

    void echo(Fx &f, const Node &n, double in_l, double in_r, std::array<double, 2> &sig) {
        const auto &p = n.knobs; // time, sync, beats, feedback, damping, pingPong, mix
        const int L = echo_length, w = f.pos[0];
        const double target = std::clamp(p[1] != 0 ? kEchoBeats[int(p[2])] * 60 / host.bpm * rate : p[0] * 0.001 * rate,
                                          1.0, double(L - 2));
        if (!f.pos[1]) { f.mem[0] = target; f.pos[1] = 1; }
        f.mem[0] += (target - f.mem[0]) * lag(0.05);
        const double dl = fx_read(f.buf, 0, L, w, f.mem[0]), dr = fx_read(f.buf, L, L, w, f.mem[0]);
        f.mem[1] = flush(f.mem[1] + (dl - f.mem[1]) * (1 - p[4]));
        f.mem[2] = flush(f.mem[2] + (dr - f.mem[2]) * (1 - p[4]));
        const double wl = p[5] != 0 ? (in_l + in_r) * 0.5 + p[3] * f.mem[2] : in_l + p[3] * f.mem[1];
        const double wr = p[5] != 0 ? p[3] * f.mem[1] : in_r + p[3] * f.mem[2];
        f.buf[size_t(w)] = float(std::clamp(wl, -4.0, 4.0));
        f.buf[size_t(L + w)] = float(std::clamp(wr, -4.0, 4.0));
        f.pos[0] = w + 1 == L ? 0 : w + 1;
        sig = {in_l * (1 - p[6]) + dl * p[6], in_r * (1 - p[6]) + dr * p[6]};
    }

    void chorus(Fx &f, const Node &n, double in_l, double in_r, std::array<double, 2> &sig) {
        const auto &p = n.knobs; // rate, depth, delay, spread, mix
        const int L = chorus_length, w = f.pos[0];
        const double ms = 0.001 * rate, phase = f.mem[0];
        const double dl = (p[2] + p[1] * 0.5 * (1 + std::sin(2 * kPi * phase))) * ms;
        const double dr = (p[2] + p[1] * 0.5 * (1 + std::sin(2 * kPi * (phase + p[3] * 0.25)))) * ms;
        const double wet_l = fx_read(f.buf, 0, L, w, dl), wet_r = fx_read(f.buf, L, L, w, dr);
        f.buf[size_t(w)] = float(std::clamp(in_l, -4.0, 4.0));
        f.buf[size_t(L + w)] = float(std::clamp(in_r, -4.0, 4.0));
        f.pos[0] = w + 1 == L ? 0 : w + 1;
        const double next = phase + p[0] / rate;
        f.mem[0] = next - std::floor(next);
        sig = {in_l * (1 - p[4]) + wet_l * p[4], in_r * (1 - p[4]) + wet_r * p[4]};
    }

    // Freeverb: eight damped combs in parallel, then four allpasses, per channel.
    void reverb(Fx &f, const Node &n, double in_l, double in_r, std::array<double, 2> &sig) {
        const auto &p = n.knobs; // size, damping, width, mix
        const double room = p[0] * 0.28 + 0.7, damp = p[1] * 0.4, input = (in_l + in_r) * 0.015;
        double wet[2] = {0, 0};
        int start = 0, k = 0;
        for (int channel = 0; channel < 2; ++channel) {
            double sum = 0;
            for (int comb : kReverbCombs) {
                const int length = reverb_length(rate, comb, channel), i = f.pos[size_t(k)];
                const double y = f.buf[size_t(start + i)];
                f.mem[size_t(k)] = flush(y * (1 - damp) + f.mem[size_t(k)] * damp);
                f.buf[size_t(start + i)] = float(input + f.mem[size_t(k)] * room);
                f.pos[size_t(k)] = i + 1 == length ? 0 : i + 1;
                sum += y;
                start += length;
                ++k;
            }
            for (int allpass : kReverbAllpasses) {
                const int length = reverb_length(rate, allpass, channel), i = f.pos[size_t(k)];
                const double held = f.buf[size_t(start + i)];
                f.buf[size_t(start + i)] = float(sum + held * 0.5);
                sum = held - sum;
                f.pos[size_t(k)] = i + 1 == length ? 0 : i + 1;
                start += length;
                ++k;
            }
            wet[channel] = sum;
        }
        const double wet1 = p[3] * (p[2] / 2 + 0.5), wet2 = p[3] * ((1 - p[2]) / 2);
        sig = {wet[0] * wet1 + wet[1] * wet2 + in_l * (1 - p[3]), wet[1] * wet1 + wet[0] * wet2 + in_r * (1 - p[3])};
    }

    // The Physical instrument's guitar amp (see the Web engine).
    std::array<double, 2> svf_step(Fx &f, int i, double x, double cutoff, double k) const {
        const double g = std::tan(kPi * std::clamp(cutoff, 5.0, rate * 0.49) / rate);
        const double a1 = 1 / (1 + g * (g + k)), a2 = g * a1, a3 = g * a2;
        const double v3 = x - f.mem[size_t(i + 1)];
        const double v1 = a1 * f.mem[size_t(i)] + a2 * v3, v2 = f.mem[size_t(i + 1)] + a2 * f.mem[size_t(i)] + a3 * v3;
        f.mem[size_t(i)] = 2 * v1 - f.mem[size_t(i)];
        f.mem[size_t(i + 1)] = 2 * v2 - f.mem[size_t(i + 1)];
        return {v2, x - k * v1 - v2};
    }
    void amp(Fx &f, const Node &n, double in_l, double in_r, std::array<double, 2> &sig) {
        const auto &p = n.knobs; // type, gain, tone, level
        const auto &t = kAmpTypes[int(p[0])];
        const double drive = t[1] * std::pow(t[2] / t[1], p[1]), bias_out = soft_clip(t[3]);
        const double cabinet = t[5] * std::pow(t[6] / t[5], p[2]), out = std::pow(10.0, p[3] / 20);
        const double pre = 1 - std::exp(-2 * kPi * std::clamp(t[0], 1.0, rate * 0.49) / rate);
        const double inter = 1 - std::exp(-2 * kPi * 5000 / rate);
        const auto channel = [&](double x, int base) {
            auto &mem = f.mem;
            mem[size_t(base)] += pre * (x - mem[size_t(base)]);
            double y = soft_clip((x - mem[size_t(base)]) * drive + t[3]) - bias_out;
            if (t[4] > 1) { mem[size_t(base + 1)] += inter * (y - mem[size_t(base + 1)]); y = soft_clip(mem[size_t(base + 1)] * 4); }
            const double low = svf_step(f, base + 2, y, cabinet, 1.1)[0];
            return svf_step(f, base + 4, low, 80, 1.4)[1] * out;
        };
        sig = {channel(in_l, 0), channel(in_r, 6)};
    }

    // Runs the patch effects once on the summed voice signals; returns what FX outputs add.
    std::array<double, 2> sample_globals() {
        double left = 0, right = 0;
        for (int i = 0; i < graph.global_count; ++i) {
            const int g = graph.globals[size_t(i)];
            const auto &n = graph.nodes[size_t(g)];
            const auto input = [&](int port, double fallback) {
                const auto link = n.links[size_t(port)];
                if (link.node < 0) return fallback;
                return kGlobal[size_t(graph.nodes[size_t(link.node)].type)] ? gsig[size_t(link.node)][size_t(link.port)]
                                                                            : bus[size_t(g)][size_t(port)];
            };
            const double in_l = input(0, 0), in_r = input(1, in_l);
            if (n.type == Type::fxOutput) {
                left += in_l * n.knobs[0];
                right += in_r * n.knobs[0];
                continue;
            }
            auto &sig = gsig[size_t(g)];
            auto &f = fx[size_t(n.slot)];
            if (n.type == Type::echo) echo(f, n, in_l, in_r, sig);
            else if (n.type == Type::chorus) chorus(f, n, in_l, in_r, sig);
            else if (n.type == Type::guitarAmp) amp(f, n, in_l, in_r, sig);
            else reverb(f, n, in_l, in_r, sig);
            sig[0] = std::clamp(sig[0], -1e6, 1e6);
            sig[1] = std::clamp(sig[1], -1e6, 1e6);
        }
        return {left, right};
    }

    std::array<double, 2> sample(const Macros &macros) {
        double out = 0, right = 0;
        if (graph.autonomous && !voices[0].active) {
            start(voices[0], 0, 60, -1, 1, false);
            voices[0].key_down = false;
        }
        // Glide decays like the Synth instrument: about 95% of the way after the glide time.
        const double glide_coef = graph.glide > 0 ? std::exp(-1 / (graph.glide / 3 * rate)) : 0;
        for (auto &v : voices) {
            if (!v.active) continue;
            for (int i = 0; i < graph.size_voice; ++i) sample_node(v, graph.order[size_t(i)], macros);
            for (int i = 0; i < graph.delay_count; ++i) {
                const int index = graph.delays[i];
                v.stages[index].memory = std::clamp(read(v, graph.nodes[index], 0), -4.0, 4.0);
            }
            if (v.glide != 0) {
                v.glide *= glide_coef;
                if (std::abs(v.glide) < 0.0012) v.glide = 0;
            }
            double value = 0, value_right = 0, gain = 1;
            for (int i = 0; i < graph.output_count; ++i) {
                value += v.signals[graph.outputs[i]][0];
                value_right += v.signals[graph.outputs[i]][1];
            }
            if (!v.held) {
                ++v.tail;
                const auto limit = graph.envelope_count ? uint64_t(10 * rate) : 0;
                if (v.tail > limit) {
                    const double fade = std::max(1.0, std::round(0.005 * rate));
                    gain = std::clamp(1 - double(v.tail - limit) / fade, 0.0, 1.0);
                    value *= gain;
                    value_right *= gain;
                    if (double(v.tail - limit) >= fade) v.active = false;
                } else {
                    const auto last = graph.envelopes.begin() + graph.envelope_count;
                    v.active = !std::all_of(graph.envelopes.begin(), last, [&](int i) {
                        return v.stages[i].mode == 0 && !v.stages[i].gate;
                    });
                }
            }
            for (int i = 0; i < graph.bus_count; ++i) {
                const auto &link = graph.bus_links[size_t(i)];
                bus[size_t(link.global)][size_t(link.input)] += v.signals[size_t(link.node)][size_t(link.port)] * gain;
            }
            out += value;
            right += value_right;
        }
        if (graph.global_count) {
            const auto wet = sample_globals();
            out += wet[0];
            right += wet[1];
            for (int i = 0; i < graph.bus_count; ++i) {
                const auto &link = graph.bus_links[size_t(i)];
                bus[size_t(link.global)][size_t(link.input)] = 0;
            }
        }
        if (host.playing) host.beat += host.bpm / (60 * rate);
        for (int i = 0; i < graph.clock_count; ++i) {
            const int index = graph.clocks[i];
            const auto &params = graph.nodes[index].knobs;
            const double phase = clock_phases[index] + params[0] * params[1] / (60 * rate);
            clock_phases[index] = phase - std::floor(phase);
        }
        return {std::tanh(out), std::tanh(right)};
    }
};

} // namespace modular
