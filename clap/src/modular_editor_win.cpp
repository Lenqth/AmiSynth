#define NOMINMAX
#include <windows.h>
#include <commctrl.h>
#include <shlobj.h>
#include <shlwapi.h>
#include <wrl.h>
#include <WebView2.h>
#include <nlohmann/json.hpp>
#include "modular_editor.h"
#include "modular_editor_html.h"
#include <cstring>
#include <filesystem>
#include <stdexcept>
#include <cstdio>

using Microsoft::WRL::Callback;
using Microsoft::WRL::ComPtr;
using EditorJson = nlohmann::json;

namespace {
constexpr UINT kInitialize = WM_APP + 31;
std::wstring wide(const std::string &text) {
    const int n = MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, text.data(), int(text.size()), nullptr, 0);
    std::wstring result(n, L'\0');
    MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, text.data(), int(text.size()), result.data(), n);
    return result;
}
std::string utf8(const wchar_t *text) {
    const int n = WideCharToMultiByte(CP_UTF8, 0, text, -1, nullptr, 0, nullptr, nullptr);
    std::string result(n, '\0');
    WideCharToMultiByte(CP_UTF8, 0, text, -1, result.data(), n, nullptr, nullptr);
    if (!result.empty()) result.pop_back();
    return result;
}
}

struct ModularEditor::Impl : std::enable_shared_from_this<Impl> {
    HWND window = nullptr;
    ComPtr<ICoreWebView2Controller> controller;
    ComPtr<ICoreWebView2> browser;
    Bridge bridge;
    std::function<void()> closed;
    bool floating = false, com = false, visible = false;

    void resize() {
        if (controller) { RECT r{}; GetClientRect(window, &r); controller->put_Bounds(r); }
    }
    void failed(const char *stage = "initialization", HRESULT error = E_FAIL) {
        std::fprintf(stderr, "[AmiSynth Modular GUI] %s failed: 0x%08lx\n", stage, static_cast<unsigned long>(error));
        SetWindowTextW(window, L"Cannot open the editor. Check the Microsoft Edge WebView2 Runtime.");
    }

    void document_ready() {
        std::weak_ptr<Impl> weak = shared_from_this();
        EventRegistrationToken token{};
        browser->add_WebMessageReceived(Callback<ICoreWebView2WebMessageReceivedEventHandler>(
            [weak](ICoreWebView2 *, ICoreWebView2WebMessageReceivedEventArgs *args) -> HRESULT {
                auto self = weak.lock(); if (!self) return S_OK;
                LPWSTR raw = nullptr;
                if (FAILED(args->get_WebMessageAsJson(&raw))) return S_OK;
                std::unique_ptr<wchar_t, decltype(&CoTaskMemFree)> owned(raw, CoTaskMemFree);
                try {
                    if (!raw || std::wcslen(raw) > 200000) return S_OK;
                    const auto message = EditorJson::parse(utf8(raw));
                    const auto reply = self->bridge(message.at("args").dump());
                    const auto response = EditorJson{{"id", message.at("id")}, {"reply", EditorJson::parse(reply)}}.dump();
                    self->browser->PostWebMessageAsJson(wide(response).c_str());
                } catch (...) {}
                return S_OK;
            }).Get(), &token);
        browser->add_NavigationStarting(Callback<ICoreWebView2NavigationStartingEventHandler>(
            [](ICoreWebView2 *, ICoreWebView2NavigationStartingEventArgs *args) -> HRESULT {
                LPWSTR uri = nullptr; args->get_Uri(&uri);
                if (!uri || std::wcscmp(uri, L"about:blank")) args->put_Cancel(TRUE);
                CoTaskMemFree(uri); return S_OK;
            }).Get(), &token);
        browser->add_NewWindowRequested(Callback<ICoreWebView2NewWindowRequestedEventHandler>(
            [](ICoreWebView2 *, ICoreWebView2NewWindowRequestedEventArgs *args) -> HRESULT {
                args->put_Handled(TRUE); return S_OK;
            }).Get(), &token);
        const wchar_t *binding = LR"JS(
            (() => {
              let id = 0; const pending = new Map();
              window.amisynthBridge = (...args) => new Promise(resolve => {
                const key = ++id; pending.set(key, resolve);
                window.chrome.webview.postMessage({id:key,args});
              });
              window.chrome.webview.addEventListener('message', event => {
                const {id,reply} = event.data;
                const resolve = pending.get(id); if (resolve) { pending.delete(id); resolve(reply); }
              });
            })();
        )JS";
        const auto result = browser->AddScriptToExecuteOnDocumentCreated(binding,
            Callback<ICoreWebView2AddScriptToExecuteOnDocumentCreatedCompletedHandler>(
                [weak](HRESULT error, LPCWSTR) -> HRESULT {
                    if (auto self = weak.lock()) {
                        if (FAILED(error)) self->failed("bridge script", error);
                        else {
                            const auto result = self->browser->NavigateToString(wide(modular_editor_html()).c_str());
                            if (FAILED(result)) self->failed("document", result);
                        }
                    }
                    return S_OK;
                }).Get());
        if (FAILED(result)) failed();
    }

    void start() {
        // This runs from our posted window message, after clap.gui.create has returned.
        // Never pump/dispatch the host's messages while its UI callback is on the stack.
        try {
            wchar_t local[MAX_PATH];
            if (FAILED(SHGetFolderPathW(nullptr, CSIDL_LOCAL_APPDATA, nullptr, 0, local))) { failed(); return; }
            const auto profile = std::filesystem::path(local) / L"AmiSynth" / L"ModularEditor";
            std::filesystem::create_directories(profile);
            std::weak_ptr<Impl> weak = shared_from_this();
            const auto result = CreateCoreWebView2EnvironmentWithOptions(nullptr, profile.c_str(), nullptr,
                Callback<ICoreWebView2CreateCoreWebView2EnvironmentCompletedHandler>(
                    [weak](HRESULT error, ICoreWebView2Environment *env) -> HRESULT {
                        auto self = weak.lock(); if (!self) return S_OK;
                        if (FAILED(error) || !env) { self->failed("environment callback", error); return S_OK; }
                        const auto result = env->CreateCoreWebView2Controller(self->window,
                            Callback<ICoreWebView2CreateCoreWebView2ControllerCompletedHandler>(
                                [weak](HRESULT error, ICoreWebView2Controller *controller) -> HRESULT {
                                    auto self = weak.lock();
                                    if (!self) { if (controller) controller->Close(); return S_OK; }
                                    if (FAILED(error) || !controller) { self->failed("controller callback", error); return S_OK; }
                                    self->controller = controller;
                                    controller->get_CoreWebView2(&self->browser);
                                    if (!self->browser) { self->failed(); return S_OK; }
                                    self->resize();
                                    controller->put_IsVisible(self->visible);
                                    ComPtr<ICoreWebView2Settings> settings;
                                    if (SUCCEEDED(self->browser->get_Settings(&settings))) {
                                        settings->put_AreDefaultContextMenusEnabled(FALSE);
                                        settings->put_AreDevToolsEnabled(FALSE);
                                        settings->put_IsStatusBarEnabled(FALSE);
                                    }
                                    self->document_ready();
                                    return S_OK;
                                }).Get());
                        if (FAILED(result)) self->failed("controller request", result);
                        return S_OK;
                    }).Get());
            if (FAILED(result)) failed("environment request", result);
        } catch (...) { failed(); }
    }

    static LRESULT CALLBACK proc(HWND window, UINT message, WPARAM w, LPARAM l, UINT_PTR, DWORD_PTR data) {
        auto *self = reinterpret_cast<Impl *>(data);
        if (message == kInitialize) { self->start(); return 0; }
        if (message == WM_CLOSE) {
            self->visible = false; ShowWindow(window, SW_HIDE);
            const auto closed = self->closed; if (closed) closed();
            return 0;
        }
        if (message == WM_SIZE) self->resize();
        if (message == WM_MOVE && self->controller) self->controller->NotifyParentWindowPositionChanged();
        if (message == WM_SETFOCUS && self->controller) self->controller->MoveFocus(COREWEBVIEW2_MOVE_FOCUS_REASON_PROGRAMMATIC);
        return DefSubclassProc(window, message, w, l);
    }
    ~Impl() {
        if (controller) controller->Close();
        browser.Reset(); controller.Reset();
        if (window) { RemoveWindowSubclass(window, proc, 1); DestroyWindow(window); }
        if (com) CoUninitialize();
    }
};

ModularEditor::ModularEditor(Bridge bridge, std::function<void()> closed, bool floating)
    : impl(std::make_shared<Impl>()) {
    impl->floating = floating;
    impl->bridge = std::move(bridge);
    impl->closed = std::move(closed);
    const HRESULT hr = CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED);
    if (FAILED(hr)) throw std::runtime_error("The editor needs an STA UI thread");
    impl->com = true;
    impl->window = CreateWindowExW(WS_EX_CONTROLPARENT, L"STATIC", L"AmiSynth Modular",
        WS_OVERLAPPEDWINDOW | WS_CLIPCHILDREN, CW_USEDEFAULT, CW_USEDEFAULT, 1120, 780,
        nullptr, nullptr, GetModuleHandleW(nullptr), nullptr);
    if (!impl->window || !SetWindowSubclass(impl->window, Impl::proc, 1, reinterpret_cast<DWORD_PTR>(impl.get())))
        throw std::runtime_error("Cannot create editor window");
    size(1120, 780);
    if (!PostMessageW(impl->window, kInitialize, 0, 0)) throw std::runtime_error("Cannot schedule editor initialization");
}

ModularEditor::~ModularEditor() = default;

bool ModularEditor::parent(const clap_window_t *window) {
    if (impl->floating || !window || !window->api || std::strcmp(window->api, CLAP_WINDOW_API_WIN32) || !IsWindow(static_cast<HWND>(window->win32))) return false;
    uint32_t width, height; get_size(&width, &height);
    SetLastError(0);
    const auto old = SetParent(impl->window, static_cast<HWND>(window->win32));
    if (!old && GetLastError()) return false;
    SetWindowLongPtrW(impl->window, GWL_STYLE, WS_CHILD | WS_CLIPCHILDREN | WS_CLIPSIBLINGS);
    SetWindowPos(impl->window, nullptr, 0, 0, int(width), int(height), SWP_NOZORDER | SWP_FRAMECHANGED);
    return true;
}
bool ModularEditor::transient(const clap_window_t *window) {
    if (!impl->floating || !window || !window->api || std::strcmp(window->api, CLAP_WINDOW_API_WIN32) || !IsWindow(static_cast<HWND>(window->win32))) return false;
    SetLastError(0);
    SetWindowLongPtrW(impl->window, GWLP_HWNDPARENT, reinterpret_cast<LONG_PTR>(window->win32));
    return GetLastError() == 0;
}
bool ModularEditor::size(uint32_t width, uint32_t height) {
    if (width < 640 || height < 480 || width > 8192 || height > 8192) return false;
    RECT rect{0, 0, LONG(width), LONG(height)};
    AdjustWindowRectEx(&rect, GetWindowLongPtrW(impl->window, GWL_STYLE), FALSE, GetWindowLongPtrW(impl->window, GWL_EXSTYLE));
    return SetWindowPos(impl->window, nullptr, 0, 0, rect.right - rect.left, rect.bottom - rect.top, SWP_NOMOVE | SWP_NOZORDER) != 0;
}
void ModularEditor::get_size(uint32_t *width, uint32_t *height) const {
    RECT rect{}; GetClientRect(impl->window, &rect);
    *width = uint32_t(rect.right); *height = uint32_t(rect.bottom);
}
bool ModularEditor::show(bool visible) {
    impl->visible = visible;
    if (impl->controller) impl->controller->put_IsVisible(visible);
    ShowWindow(impl->window, visible ? SW_SHOW : SW_HIDE);
    return true;
}
void ModularEditor::title(const char *text) { SetWindowTextW(impl->window, wide(text).c_str()); }
void ModularEditor::evaluate(const std::string &script) {
    if (!impl->browser) throw std::runtime_error("Editor is still initializing");
    impl->browser->ExecuteScript(wide(script).c_str(), nullptr);
}
void ModularEditor::capture_png(const std::string &path, std::function<void(bool)> complete) {
    if (!impl->browser) { complete(false); return; }
    ComPtr<IStream> stream;
    if (FAILED(SHCreateStreamOnFileEx(wide(path).c_str(), STGM_CREATE | STGM_WRITE | STGM_SHARE_EXCLUSIVE,
        FILE_ATTRIBUTE_NORMAL, TRUE, nullptr, &stream))) { complete(false); return; }
    const auto result = impl->browser->CapturePreview(COREWEBVIEW2_CAPTURE_PREVIEW_IMAGE_FORMAT_PNG, stream.Get(),
        Callback<ICoreWebView2CapturePreviewCompletedHandler>(
            [complete, stream](HRESULT result) -> HRESULT { complete(SUCCEEDED(result)); return S_OK; }).Get());
    if (FAILED(result)) complete(false);
}
