// Exercise the same main-thread edit bridge used by the native GUI, without a browser runtime.
#include "../src/modular_clap.cpp"
#include <iostream>
#if defined(_WIN32)
#define NOMINMAX
#include <windows.h>
#include <commctrl.h>
#endif

namespace {
unsigned dirty_count = 0;
const clap_host_state_t test_state{[](const clap_host_t *) { ++dirty_count; }};
const void *test_extension(const clap_host_t *, const char *id) {
    return std::strcmp(id, CLAP_EXT_STATE) == 0 ? &test_state : nullptr;
}
void noop(const clap_host_t *) {}
const clap_host_t test_host{CLAP_VERSION_INIT, nullptr, "modular_edit_check", "AmiSynth", "", "1",
    test_extension, noop, noop, noop};
void check(bool condition, const char *message) {
    if (!condition) throw std::runtime_error(message);
}
}

int main(int argc, char **argv) {
    try {
        Instance self;
        self.host = &test_host;
        self.plugin.plugin_data = &self;
        check(init(&self.plugin), "Initial patch failed");
        self.dsp.note_on(0, 60, -1, 0.8, false);
        const auto active = [&] { return std::any_of(self.dsp.voices.begin(), self.dsp.voices.end(), [](const auto &v) { return v.active; }); };
        const auto edit = [&](const Json &patch, bool macro = false) {
            return Json::parse(self.editor_message(Json::array({Json{{"action", "edit"}, {"patch", patch}, {"macroMask", macro ? 1 : 0}}}).dump()));
        };
        auto patch = self.snapshot();
        patch["nodes"][3]["params"]["cutoff"] = 1700;
        self.values[0].store(0.6); // Automation arrived after the GUI's last snapshot.
        check(edit(patch).at("ok"), "Knob edit failed");
        self.sync_graph(nullptr);
        check(active() && self.dsp.graph.nodes[3].knobs[0] == 1700, "Knob edit reset voices or failed to update DSP");
        check(self.values[0].load() == 0.6, "Knob edit overwrote macro automation");
        patch = self.snapshot();
        patch["nodes"][1]["position"] = {{"x", 90}, {"y", 120}};
        check(edit(patch).at("ok"), "Layout edit failed");
        self.sync_graph(nullptr);
        check(active(), "Moving a node reset voices");
        patch = self.snapshot();
        patch["nodes"].push_back({{"id", "test_lfo"}, {"type", "lfo"}});
        patch["cables"].push_back({{"from", "test_lfo"}, {"port", "out"}, {"to", "osc"}, {"input", "fm"}});
        check(edit(patch).at("ok"), "Node and cable edit failed");
        patch = self.snapshot(); patch["nodes"][3]["params"]["cutoff"] = 1800;
        check(edit(patch).at("ok"), "Following knob edit failed");
        self.sync_graph(nullptr);
        check(!active() && self.dsp.graph.size == 7, "Pending structural edit lost its reset");
        const auto saved = self.snapshot();
        patch = saved; patch["cables"].push_back(patch["cables"][0]);
        check(!edit(patch).at("ok") && self.snapshot() == saved, "Invalid edit changed the state");
        check(!Json::parse(self.editor_message("[]")).at("ok"), "Invalid bridge message accepted");
        patch = self.snapshot(); patch["macros"][0] = 0.25;
        self.values[1].store(0.8);
        check(edit(patch, true).at("ok") && self.values[0].load() == 0.25, "GUI macro edit failed");
        check(self.values[1].load() == 0.8, "GUI macro edit overwrote another automation lane");
        std::vector<uint16_t> output_types;
        clap_output_events_t output{&output_types, [](const clap_output_events_t *out, const clap_event_header_t *event) {
            static_cast<std::vector<uint16_t> *>(out->ctx)->push_back(event->type); return true;
        }};
        self.emit_macro_changes(&output);
        check(output_types == std::vector<uint16_t>{CLAP_EVENT_PARAM_GESTURE_BEGIN, CLAP_EVENT_PARAM_VALUE, CLAP_EVENT_PARAM_GESTURE_END},
            "GUI macro gestures were not reported to the DAW");
        self.emit_macro_changes(&output);
        check(output_types.size() == 3, "GUI macro gestures repeated");
        check(dirty_count == 5, "Successful edits did not mark the project dirty");
#if defined(_WIN32)
        if (argc > 1 && std::strcmp(argv[1], "--gui-smoke") == 0) {
            check(self.load(kPresets[0].patch), "GUI initial state failed");
            unsigned reads = 0;
            bool finished = false, passed = false;
            bool sentinel_dispatched = false;
            const HWND sentinel = CreateWindowW(L"STATIC", L"Host reentrancy probe", 0,
                0, 0, 1, 1, nullptr, nullptr, GetModuleHandleW(nullptr), nullptr);
            check(sentinel != nullptr, "Cannot create host probe");
            check(SetWindowSubclass(sentinel,
                [](HWND window, UINT msg, WPARAM w, LPARAM l, UINT_PTR, DWORD_PTR data) -> LRESULT {
                    if (msg == WM_APP + 99) { *reinterpret_cast<bool *>(data) = true; return 0; }
                    return DefSubclassProc(window, msg, w, l);
                }, 1, reinterpret_cast<DWORD_PTR>(&sentinel_dispatched)) != 0, "Cannot install host probe");
            check(PostMessageW(sentinel, WM_APP + 99, 0, 0) != 0, "Cannot queue host probe");
            ModularEditor editor([&](const std::string &request) {
                const auto args = Json::parse(request);
                if (args[0].value("action", "") == "smoke-result") {
                    finished = true; passed = args[0].value("ok", false);
                    std::cout << args[0].dump() << '\n'; return std::string("{}");
                }
                ++reads;
                return self.editor_message(request);
            }, [] {}, true);
            check(!sentinel_dispatched, "GUI initialization re-entered the host before create returned");
            editor.show(true);
            const auto pump = [](const std::function<bool()> &done) {
                const auto start = GetTickCount64();
                while (!done() && GetTickCount64() - start < 20000) {
                    MSG message;
                    while (PeekMessageW(&message, nullptr, 0, 0, PM_REMOVE)) { TranslateMessage(&message); DispatchMessageW(&message); }
                    MsgWaitForMultipleObjects(0, nullptr, FALSE, 10, QS_ALLINPUT);
                }
                return done();
            };
            check(pump([&] { return reads > 1; }), "Editor did not load or bridge failed");
            check(sentinel_dispatched, "Host reentrancy probe was never dispatched");
            DestroyWindow(sentinel);
            editor.evaluate(R"JS(
                (async () => {
                  const wait = async (test, label) => { for (let i=0;i<100;i++) { if (await test()) return; await new Promise(r=>setTimeout(r,50)); } throw Error('UI update timed out: '+label); };
                  const state = async () => (await window.amisynthBridge({action:'read'})).patch;
                  await wait(()=>document.querySelectorAll('[data-module]').length === 6,'initial rack');
                  const selector = document.querySelector('select');
                  selector.value='lfo'; selector.dispatchEvent(new Event('change',{bubbles:true}));
                  await wait(async ()=>(await state()).nodes.length===7,'add module; randomUUID='+typeof crypto.randomUUID);
                  const id=(await state()).nodes.find(n=>n.type==='lfo').id;
                  const knob=document.querySelector('[aria-label="filter cutoff"]');
                  knob.value=1700; knob.dispatchEvent(new Event('input',{bubbles:true}));
                  await wait(async ()=>(await state()).nodes.find(n=>n.id==='filter').params.cutoff===1700,'knob');
                  document.querySelector(`[aria-label="${id} output out"]`).click();
                  document.querySelector('[aria-label="osc input fm"]').click();
                  await wait(async ()=>(await state()).cables.some(c=>c.from===id && c.to==='osc' && c.input==='fm'),'connect');
                  document.querySelector(`[aria-label="Remove ${id}"]`).click();
                  await wait(async ()=>(await state()).nodes.length===6 && !(await state()).cables.some(c=>c.from===id),'remove');
                  await window.amisynthBridge({action:'smoke-result',ok:true,nodes:6,cutoff:1700});
                })().catch(e=>window.amisynthBridge({action:'smoke-result',ok:false,error:e.message}));
            )JS");
            check(pump([&] { return finished; }) && passed, "Editor UI interactions failed");
            if (argc > 2) {
                bool captured = false, capture_ok = false;
                editor.capture_png(argv[2], [&](bool ok) { captured = true; capture_ok = ok; });
                check(pump([&] { return captured; }) && capture_ok, "Editor image render failed");
            }
            uint32_t width, height; editor.get_size(&width, &height);
            check(width == 1120 && height == 780, "Editor initial size incorrect");
            check(editor.size(900, 640) && !editor.size(100, 100), "Editor resize contract failed");
            editor.show(false); editor.show(true); editor.show(false);
            const HWND parent = CreateWindowW(L"STATIC", L"Modular embedded test", WS_OVERLAPPEDWINDOW,
                0, 0, 900, 640, nullptr, nullptr, GetModuleHandleW(nullptr), nullptr);
            check(parent != nullptr, "Cannot create test parent");
            clap_window_t native{CLAP_WINDOW_API_WIN32}; native.win32 = parent;
            check(kGui.create(&self.plugin, CLAP_WINDOW_API_WIN32, false), "CLAP embedded GUI create failed");
            check(kGui.set_parent(&self.plugin, &native), "CLAP GUI parent failed");
            check(kGui.get_size(&self.plugin, &width, &height) && width == 1120 && height == 780,
                "Embedding changed client size");
            check(kGui.set_size(&self.plugin, 900, 640), "CLAP embedded resize failed");
            kGui.destroy(&self.plugin);
            check(!kGui.get_size(&self.plugin, &width, &height), "GUI resources survived destruction");
            DestroyWindow(parent);
            std::cout << "Modular GUI: add, connect, knobs, remove, resize, show/hide and offline bridge passed\n";
        }
#endif
        std::cout << "Modular editor bridge: knobs, layout, topology, automation, validation and dirty state passed\n";
    } catch (const std::exception &e) { std::cerr << e.what() << '\n'; return 1; }
}
