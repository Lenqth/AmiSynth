#define NOMINMAX
#include <windows.h>
#include <commctrl.h>
#include <wrl.h>
#include "amisynth_webview.h"
#include "modular_editor.h"
#include "modular_editor_html.h"
#include <stdexcept>
#include <cstring>

namespace { unsigned editor_count = 0; }

struct ModularEditor::Impl {
    HWND window = nullptr;
    std::unique_ptr<webview::webview> view;
    std::function<void()> closed;
    bool floating, com = false;
    Impl() { ++editor_count; }

    static LRESULT CALLBACK proc(HWND window, UINT message, WPARAM w, LPARAM l, UINT_PTR, DWORD_PTR data) {
        auto *self = reinterpret_cast<Impl *>(data);
        if (message == WM_CLOSE) {
            ShowWindow(window, SW_HIDE);
            const auto closed = self->closed;
            if (closed) closed();
            return 0;
        }
        if (message == WM_SIZE && self->view) {
            const auto widget = static_cast<HWND>(self->view->widget().value());
            MoveWindow(widget, 0, 0, LOWORD(l), HIWORD(l), TRUE);
        }
        if (message == WM_SETFOCUS && self->view) {
            auto *controller = static_cast<ICoreWebView2Controller *>(self->view->browser_controller().value());
            controller->MoveFocus(COREWEBVIEW2_MOVE_FOCUS_REASON_PROGRAMMATIC);
        }
        return DefSubclassProc(window, message, w, l);
    }

    ~Impl() {
        view.reset();
        if (window) { RemoveWindowSubclass(window, proc, 1); DestroyWindow(window); }
        // A DAW may unload and reload the DLL at a different address.
        if (--editor_count == 0) {
            UnregisterClassW(L"AmiSynthModular_webview_widget", GetModuleHandleW(nullptr));
            UnregisterClassW(L"AmiSynthModular_webview_message", GetModuleHandleW(nullptr));
        }
        if (com) CoUninitialize();
    }
};

ModularEditor::ModularEditor(Bridge bridge, std::function<void()> closed, bool floating)
    : impl(std::make_unique<Impl>()) {
    impl->floating = floating;
    impl->closed = std::move(closed);
    const HRESULT hr = CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED);
    if (FAILED(hr)) throw std::runtime_error("The editor needs an STA UI thread");
    impl->com = true;
    impl->window = CreateWindowExW(WS_EX_CONTROLPARENT, L"STATIC", L"AmiSynth Modular",
        WS_OVERLAPPEDWINDOW | WS_CLIPCHILDREN, CW_USEDEFAULT, CW_USEDEFAULT, 1120, 780,
        nullptr, nullptr, GetModuleHandleW(nullptr), nullptr);
    if (!impl->window || !SetWindowSubclass(impl->window, Impl::proc, 1, reinterpret_cast<DWORD_PTR>(impl.get())))
        throw std::runtime_error("Cannot create editor window");
    impl->view = std::make_unique<webview::webview>(false, impl->window);
    impl->view->bind("amisynthBridge", std::move(bridge)).ensure_ok();
    impl->view->set_html(modular_editor_html()).ensure_ok();
    size(1120, 780);
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
    AdjustWindowRectEx(&rect, GetWindowLongPtrW(impl->window, GWL_STYLE), FALSE,
        GetWindowLongPtrW(impl->window, GWL_EXSTYLE));
    return SetWindowPos(impl->window, nullptr, 0, 0, rect.right - rect.left, rect.bottom - rect.top,
        SWP_NOMOVE | SWP_NOZORDER) != 0;
}
void ModularEditor::get_size(uint32_t *width, uint32_t *height) const {
    RECT rect{}; GetClientRect(impl->window, &rect);
    *width = uint32_t(rect.right); *height = uint32_t(rect.bottom);
}
bool ModularEditor::show(bool visible) {
    ShowWindow(impl->window, visible ? SW_SHOW : SW_HIDE);
    return true;
}
void ModularEditor::title(const char *text) { impl->view->set_title(text); }

void ModularEditor::evaluate(const std::string &script) { impl->view->eval(script); }
void ModularEditor::capture_png(const std::string &path, std::function<void(bool)> complete) {
    const int n = MultiByteToWideChar(CP_UTF8, 0, path.data(), int(path.size()), nullptr, 0);
    std::wstring filename(n, L'\0');
    MultiByteToWideChar(CP_UTF8, 0, path.data(), int(path.size()), filename.data(), n);
    Microsoft::WRL::ComPtr<IStream> stream;
    if (FAILED(SHCreateStreamOnFileEx(filename.c_str(), STGM_CREATE | STGM_WRITE | STGM_SHARE_EXCLUSIVE,
        FILE_ATTRIBUTE_NORMAL, TRUE, nullptr, &stream))) { complete(false); return; }
    auto *controller = static_cast<ICoreWebView2Controller *>(impl->view->browser_controller().value());
    Microsoft::WRL::ComPtr<ICoreWebView2> browser;
    controller->get_CoreWebView2(&browser);
    const auto result = browser->CapturePreview(COREWEBVIEW2_CAPTURE_PREVIEW_IMAGE_FORMAT_PNG, stream.Get(),
        Microsoft::WRL::Callback<ICoreWebView2CapturePreviewCompletedHandler>(
            [complete, stream](HRESULT result) -> HRESULT { complete(SUCCEEDED(result)); return S_OK; }).Get());
    if (FAILED(result)) complete(false);
}
