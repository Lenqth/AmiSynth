// Minimal host for Modular's patch, state, automation, and sample-accurate note tests.
#include <clap/clap.h>
#include <algorithm>
#include <array>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <filesystem>
#include <string>
#include <vector>
#if defined(_WIN32)
#include <windows.h>
#else
#include <dlfcn.h>
#endif

namespace {
void check(bool condition, const char *message) {
    if (!condition) { std::fprintf(stderr, "%s\n", message); std::exit(1); }
}

struct Stream {
    std::string data;
    size_t offset = 0;
    clap_istream_t input{this, [](const clap_istream_t *s, void *dst, uint64_t size) -> int64_t {
        auto &self = *static_cast<Stream *>(s->ctx);
        const auto n = std::min<uint64_t>({size, 23, self.data.size() - self.offset});
        std::memcpy(dst, self.data.data() + self.offset, n);
        self.offset += size_t(n);
        return int64_t(n);
    }};
    clap_ostream_t output{this, [](const clap_ostream_t *s, const void *src, uint64_t size) -> int64_t {
        const auto n = std::min<uint64_t>(size, 31);
        static_cast<Stream *>(s->ctx)->data.append(static_cast<const char *>(src), size_t(n));
        return int64_t(n);
    }};
};

struct Events {
    std::vector<const clap_event_header_t *> input;
    std::vector<clap_event_note_t> ended;
    clap_input_events_t in{this,
        [](const clap_input_events_t *l) { return uint32_t(static_cast<Events *>(l->ctx)->input.size()); },
        [](const clap_input_events_t *l, uint32_t i) { return static_cast<Events *>(l->ctx)->input.at(i); }};
    clap_output_events_t out{this, [](const clap_output_events_t *l, const clap_event_header_t *e) {
        if (e->type == CLAP_EVENT_NOTE_END && e->size == sizeof(clap_event_note_t))
            static_cast<Events *>(l->ctx)->ended.push_back(*reinterpret_cast<const clap_event_note_t *>(e));
        return true;
    }};
};

int rescans = 0, info_rescans = 0, loads = 0, dirty_calls = 0;
const clap_host_params_t host_params{[](const clap_host_t *, clap_param_rescan_flags f) {
    if (f & CLAP_PARAM_RESCAN_VALUES) ++rescans;
    if (f & CLAP_PARAM_RESCAN_INFO) ++info_rescans;
}, [](const clap_host_t *, clap_id, clap_param_clear_flags) {}, [](const clap_host_t *) {}};
const clap_host_preset_load_t host_presets{
    [](const clap_host_t *, uint32_t, const char *, const char *, int32_t, const char *) {},
    [](const clap_host_t *, uint32_t, const char *, const char *) { ++loads; }};
const clap_host_state_t host_state{[](const clap_host_t *) { ++dirty_calls; }};
const auto noop = [](const clap_host_t *) {};
const clap_host_t host{CLAP_VERSION_INIT, nullptr, "Modular check", "AmiSynth", "", "1",
    [](const clap_host_t *, const char *id) -> const void * {
        if (std::strcmp(id, CLAP_EXT_PARAMS) == 0) return &host_params;
        if (std::strcmp(id, CLAP_EXT_PRESET_LOAD) == 0) return &host_presets;
        if (std::strcmp(id, CLAP_EXT_STATE) == 0) return &host_state;
        return nullptr;
    }, noop, noop, noop};

template<class T> const T *ext(const clap_plugin_t *p, const char *id) {
    const auto *value = static_cast<const T *>(p->get_extension(p, id));
    check(value, id);
    return value;
}

std::array<float, 128> render(const clap_plugin_t *p, Events &events) {
    std::array<float, 128> left{}, right{};
    float *channels[]{left.data(), right.data()};
    clap_audio_buffer_t audio{channels, nullptr, 2, 0, 0};
    const clap_process_t block{-1, uint32_t(left.size()), nullptr, nullptr, &audio, 0, 1, &events.in, &events.out};
    check(p->process(p, &block) != CLAP_PROCESS_ERROR && left == right, "Stereo render failed");
    return left;
}
} // namespace

int main(int argc, char **argv) {
    check(argc == 4, "Usage: modular_check plugin.clap web-patch.json state.json");
    std::filesystem::path binary(argv[1]);
#if defined(__APPLE__)
    binary /= std::filesystem::path("Contents/MacOS") / binary.stem();
#endif
#if defined(_WIN32)
    const auto handle = LoadLibraryW(binary.c_str());
    const auto *entry = handle ? reinterpret_cast<const clap_plugin_entry_t *>(GetProcAddress(handle, "clap_entry")) : nullptr;
#else
    const auto handle = dlopen(binary.c_str(), RTLD_NOW | RTLD_LOCAL);
    const auto *entry = handle ? static_cast<const clap_plugin_entry_t *>(dlsym(handle, "clap_entry")) : nullptr;
#endif
    check(entry && entry->init(argv[1]), "Cannot load Modular CLAP");
    const auto *factory = static_cast<const clap_plugin_factory_t *>(entry->get_factory(CLAP_PLUGIN_FACTORY_ID));
    check(factory && factory->get_plugin_count(factory) == 5, "Expected five instruments in AmiSynth.clap");
    check(!factory->get_plugin_descriptor(factory, 5), "Accepted out-of-range plugin index");
    check(!factory->create_plugin(factory, &host, "unknown"), "Accepted unknown plugin ID");
    const clap_plugin_descriptor_t *desc = nullptr;
    for (uint32_t i = 0; i < factory->get_plugin_count(factory); ++i) {
        const auto *candidate = factory->get_plugin_descriptor(factory, i);
        if (candidate && std::strcmp(candidate->id, "com.github.lenqth.amisynth.modular") == 0) desc = candidate;
    }
    check(desc && std::strcmp(desc->name, "AmiSynth Modular") == 0, "Wrong descriptor");
    const auto create = [&] {
        const auto *plugin = factory->create_plugin(factory, &host, desc->id);
        check(plugin && plugin->init(plugin), "Cannot create instrument");
        return plugin;
    };
    const auto *p = create();
    const auto *params = ext<clap_plugin_params_t>(p, CLAP_EXT_PARAMS);
    const auto *state = ext<clap_plugin_state_t>(p, CLAP_EXT_STATE);
    const auto *presets = ext<clap_plugin_preset_load_t>(p, CLAP_EXT_PRESET_LOAD);
    check(params->count(p) == 9, "Wrong parameter count");
    {
        // After the macros: the GM Program Change switch, off by default.
        clap_param_info_t info{};
        double value = -1;
        check(params->get_info(p, 8, &info) && info.id == 8 && info.max_value == 1 && (info.flags & CLAP_PARAM_IS_STEPPED) &&
            !std::strcmp(info.name, "GM Program Change") && params->get_value(p, 8, &value) && value == 0, "Invalid program change switch");
    }
    for (clap_id i = 0; i < 8; ++i) {
        clap_param_info_t info{};
        check(params->get_info(p, i, &info) && info.id == i && info.min_value == 0 && info.max_value == 1 &&
            (info.flags & CLAP_PARAM_IS_AUTOMATABLE), "Invalid macro");
    }
    const auto *discovery = static_cast<const clap_preset_discovery_factory_t *>(entry->get_factory(CLAP_PRESET_DISCOVERY_FACTORY_ID));
    check(discovery && discovery->count(discovery) == 2, "Missing preset discovery providers");
    check(!discovery->get_descriptor(discovery, 2), "Accepted out-of-range preset provider index");
    check(!discovery->create(discovery, nullptr, "unknown"), "Accepted unknown preset provider ID");
    clap_preset_discovery_indexer_t indexer{};
    indexer.declare_location = [](const clap_preset_discovery_indexer_t *, const clap_preset_discovery_location_t *l) {
        return l->kind == CLAP_PRESET_DISCOVERY_LOCATION_PLUGIN && l->location == nullptr;
    };
    const auto *provider = discovery->create(discovery, &indexer, "com.github.lenqth.amisynth.modular");
    check(provider && provider->init(provider), "Preset location failed");
    unsigned discovered = 0;
    clap_preset_discovery_metadata_receiver_t receiver{};
    receiver.receiver_data = &discovered;
    receiver.begin_preset = [](const clap_preset_discovery_metadata_receiver_t *r, const char *, const char *) {
        ++*static_cast<unsigned *>(r->receiver_data); return true;
    };
    receiver.add_plugin_id = [](const clap_preset_discovery_metadata_receiver_t *, const clap_universal_plugin_id_t *) {};
    check(provider->get_metadata(provider, CLAP_PRESET_DISCOVERY_LOCATION_PLUGIN, nullptr, &receiver) && discovered >= 3,
        "Factory presets not discoverable");
    provider->destroy(provider);
    check(presets->from_location(p, CLAP_PRESET_DISCOVERY_LOCATION_PLUGIN, nullptr, "Feedback Bass"), "Factory preset failed");
    check(presets->from_location(p, CLAP_PRESET_DISCOVERY_LOCATION_FILE, argv[2], nullptr), "Web patch failed to load");
    check(rescans == 2 && info_rescans == 1 && loads == 2 && dirty_calls == 2, "Host notifications missing");
    clap_param_info_t renamed{};
    check(params->get_info(p, 0, &renamed) && renamed.id == 0 && std::strcmp(renamed.name, "Brightness") == 0,
        "Renamed macro lost its label or automation ID");

    check(p->activate(p, 48000, 1, 128) && p->start_processing(p), "Cannot activate");
    clap_event_note_t on{{sizeof(on), 17, 0, CLAP_EVENT_NOTE_ON, 0}, 42, 0, 2, 69, 0.8};
    clap_event_param_value_t change{{sizeof(change), 64, 0, CLAP_EVENT_PARAM_VALUE, 0}, 0, nullptr, -1, -1, -1, -1, 0.75};
    Events e;
    e.input = {&on.header, &change.header};
    const auto first = render(p, e);
    check(std::all_of(first.begin(), first.begin() + 17, [](float x) { return x == 0; }), "Note started too soon");
    check(std::any_of(first.begin() + 64, first.end(), [](float x) { return x > 0.01f; }), "Macro or note was silent");
    check(std::abs(first[63] - first[64]) > 0.01f, "Macro change missed its sample offset");
    const double sum_before = 0.15 / (1 - 0.1);
    const double expected = std::tanh((0.75 + 0.1 * sum_before) * 0.75);
    check(std::abs(first[64] - expected) < 1e-6, "Patched parameter did not replace its knob");

    Stream saved;
    check(state->save(p, &saved.output), "Could not save patch through partial writes");
    auto *file = std::fopen(argv[3], "wb");
    check(file && std::fwrite(saved.data.data(), 1, saved.data.size(), file) == saved.data.size(), "Could not write state fixture");
    std::fclose(file);
    const auto *q = create();
    check(state->load(q, &saved.input), "Could not restore patch through partial reads");
    double value = 0;
    check(params->get_value(q, 0, &value) && value == 0.75, "Lost macro value");
    Stream invalid{"{\"nodes\":[],\"cables\":[]}"};
    check(!state->load(q, &invalid.input), "Accepted invalid state");
    Stream oversized{std::string(65537, ' ')};
    check(!state->load(q, &oversized.input), "Accepted oversized state");
    Stream after;
    check(state->save(q, &after.output) && after.data == saved.data, "Failed restore altered the patch");
    check(q->activate(q, 48000, 1, 128) && q->start_processing(q), "Cannot activate restored instance");
    Events one, two;
    one.input = two.input = {&on.header};
    check(state->load(p, &after.input), "Active state restoration failed");
    check(render(p, one) == render(q, two), "Restored patch changed the audio");
    check(one.ended.size() == 1 && one.ended[0].note_id == 42, "Replacing an active graph did not end its note");

    clap_event_note_t choke{{sizeof(choke), 20, 0, CLAP_EVENT_NOTE_CHOKE, 0}, 42, 0, -1, -1, 0};
    Events stop;
    stop.input = {&choke.header};
    const auto stopped = render(q, stop);
    check(stop.ended.size() == 1 && stop.ended[0].note_id == 42 && stop.ended[0].header.time == 20 &&
          std::all_of(stopped.begin() + 20, stopped.end(), [](float x) { return x == 0; }), "CLAP choke failed");
    for (const auto *plugin : {p, q}) {
        plugin->stop_processing(plugin);
        plugin->deactivate(plugin);
        plugin->destroy(plugin);
    }
    entry->deinit();
    return 0;
}
