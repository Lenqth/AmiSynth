// Exercise the same main-thread edit bridge used by the native GUI, without a browser runtime.
#include "../src/modular_clap.cpp"
#include <iostream>
#if defined(_WIN32)
#define NOMINMAX
#include <windows.h>
#include <commctrl.h>
// Hosts usually run with Common Controls v6, which replaces the STATIC/BUTTON window procedures.
#pragma comment(linker, "/manifestdependency:\"type='win32' name='Microsoft.Windows.Common-Controls' version='6.0.0.0' processorArchitecture='*' publicKeyToken='6595b64144ccf1df' language='*'\"")
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
        // Voices hold their delay lines; keep the instance off the stack.
        auto owned = std::make_unique<Instance>();
        auto &self = *owned;
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
                if (args[0].value("action", "") == "smoke-presets") {
                    Json presets = Json::array();
                    for (const auto &preset : kPresets)
                        presets.push_back({{"name", preset.name}, {"nodes", Json::parse(preset.patch).at("nodes")}});
                    return presets.dump();
                }
                ++reads;
                return self.editor_message(request);
            }, [] {}, true);
            check(!sentinel_dispatched, "GUI initialization re-entered the host before create returned");
            editor.show(true);
            {
                const HWND floating = FindWindowW(nullptr, L"AmiSynth Modular");
                RECT frame{}; GetWindowRect(floating, &frame);
                const POINT caption{(frame.left + frame.right) / 2, frame.top + GetSystemMetrics(SM_CYFRAME) + GetSystemMetrics(SM_CYCAPTION) / 2};
                check(floating && SendMessageW(floating, WM_NCHITTEST, 0, MAKELPARAM(caption.x, caption.y)) == HTCAPTION,
                    "Floating editor caption cannot be dragged");
            }
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
            if (argc > 1 && std::strcmp(argv[argc - 1], "--gui-drag") == 0) {
                // Manual check: moves the real mouse cursor to drag the floating caption.
                const HWND floating = FindWindowW(nullptr, L"AmiSynth Modular");
                RECT before{}; GetWindowRect(floating, &before);
                SetForegroundWindow(floating);
                const int x = (before.left + before.right) / 2 - 150, y = before.top + GetSystemMetrics(SM_CYFRAME) + GetSystemMetrics(SM_CYCAPTION) / 2;
                const auto at = [](int px, int py, DWORD flags) {
                    INPUT in{}; in.type = INPUT_MOUSE;
                    in.mi.dx = px * 65535 / (GetSystemMetrics(SM_CXSCREEN) - 1); in.mi.dy = py * 65535 / (GetSystemMetrics(SM_CYSCREEN) - 1);
                    in.mi.dwFlags = flags | MOUSEEVENTF_MOVE | MOUSEEVENTF_ABSOLUTE; SendInput(1, &in, sizeof in);
                };
                at(x, y, 0); at(x, y, MOUSEEVENTF_LEFTDOWN);
                for (int i = 1; i <= 10; ++i) at(x + i * 8, y + i * 6, 0);
                at(x + 80, y + 60, MOUSEEVENTF_LEFTUP);
                pump([&] { RECT r{}; GetWindowRect(floating, &r); return r.left != before.left; });
                RECT after{}; GetWindowRect(floating, &after);
                std::cout << "drag: " << before.left << "," << before.top << " -> " << after.left << "," << after.top << std::endl;
                check(after.left != before.left, "Dragging the floating caption did not move the editor");
            }
            DestroyWindow(sentinel);
            editor.evaluate(R"JS(
                (async () => {
                  const wait = async (test, label) => { for (let i=0;i<100;i++) { if (await test()) return; await new Promise(r=>setTimeout(r,50)); } throw Error('UI update timed out: '+label); };
                  const state = async () => (await window.amisynthBridge({action:'read'})).patch;
                  await wait(()=>document.querySelectorAll('[data-module]').length === 6,'initial rack');
                  const picker = document.querySelector('[data-preset-picker]');
                  const presetSearch = document.querySelector('[data-preset-search]');
                  const choose = index => {
                    picker.value = String(index);
                    picker.dispatchEvent(new Event('change', { bubbles: true }));
                  };
                  const presets = await window.amisynthBridge({action:'smoke-presets'});
                  presetSearch.value = 'physical wine';
                  presetSearch.dispatchEvent(new Event('input', { bubbles: true }));
                  await wait(() => Array.from(picker.options).some(option => option.text === 'Wine Glass (Modular)') &&
                    !Array.from(picker.options).some(option => option.text === 'Digital Pulse'), 'preset search');
                  if (picker.selectedOptions[0].text !== presets[0].name) throw Error('Search lost the current preset');
                  presetSearch.value = '';
                  presetSearch.dispatchEvent(new Event('input', { bubbles: true }));
                  await wait(() => picker.options.length === presets.length + 1, 'clear preset search');
                  for (const [index, preset] of presets.entries()) {
                    choose(index);
                    await wait(() => {
                      const cards = Array.from(document.querySelectorAll('[data-module]'));
                      return picker.value === String(index) && cards.length === preset.nodes.length &&
                        cards.every((card, i) => card.dataset.module === preset.nodes[i].id &&
                          card.offsetLeft === preset.nodes[i].position.x && card.offsetTop === preset.nodes[i].position.y);
                    }, 'render preset ' + preset.name);
                    const cards = Array.from(document.querySelectorAll('[data-module]'));
                    const rects = cards.map(card => card.getBoundingClientRect());
                    for (let i = 0; i < rects.length; i++) {
                      for (let j = i + 1; j < rects.length; j++) {
                        const a = rects[i], b = rects[j];
                        if (a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom)
                          throw Error(preset.name + ': ' + cards[i].dataset.module + ' overlaps ' + cards[j].dataset.module +
                            ' by ' + (Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)) + ' px');
                      }
                    }
                  }
                  choose(presets.findIndex(preset => preset.name === 'Wine Glass (Modular)'));
                  const material = () => document.querySelector('select[aria-label="resonator material"]');
                  await wait(() => material()?.selectedOptions[0]?.text === 'Wine Glass', 'material dropdown');
                  const shortWidth = material().getBoundingClientRect().width;
                  const longChoice = Array.from(material().options).find(option => option.text === 'Harmonic (string-like)');
                  material().value = longChoice.value;
                  material().dispatchEvent(new Event('change', { bubbles: true }));
                  await wait(async () => (await state()).nodes.find(n => n.id === 'resonator')?.params.material ===
                    Number(longChoice.value), 'select a long material name');
                  if (Math.abs(material().getBoundingClientRect().width - shortWidth) > 0.1)
                    throw Error('Material selector width changed with the selected label');
                  choose(0);
                  await wait(async ()=>(await state()).nodes.length===6,'restore initial rack');
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
                  const rack=document.querySelector('.modular-rack'), bounds=rack.getBoundingClientRect();
                  rack.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:bounds.left+640,clientY:bounds.top+390}));
                  await wait(()=>document.querySelector('[data-modular-menu] input[type=search]'),'search menu');
                  const search=document.querySelector('[data-modular-menu] input[type=search]');
                  search.value='pluck'; search.dispatchEvent(new Event('input',{bubbles:true}));
                  await wait(()=>document.querySelectorAll('[data-modular-menu] [role=menuitem]').length===1,'search filter');
                  search.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));
                  await wait(async ()=>(await state()).nodes.some(n=>n.type==='string'),'add from search');
                  await window.amisynthBridge({action:'smoke-result',ok:true,presets:presets.length,nodes:7,cutoff:1700});
                })().catch(e=>window.amisynthBridge({action:'smoke-result',ok:false,error:e.message}));
            )JS");
            check(pump([&] { return finished; }) && passed, "Editor UI interactions failed");
            if (argc > 2 && std::strcmp(argv[2], "--gui-drag") != 0) {
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
