#pragma once
#include <clap/clap.h>
#include <functional>
#include <memory>
#include <string>

// All methods and callbacks run on the host's main thread.
class ModularEditor {
public:
    using Bridge = std::function<std::string(const std::string &)>;
    ModularEditor(Bridge bridge, std::function<void()> closed, bool floating);
    ~ModularEditor();
    bool parent(const clap_window_t *window);
    bool transient(const clap_window_t *window);
    bool size(uint32_t width, uint32_t height);
    void get_size(uint32_t *width, uint32_t *height) const;
    bool show(bool visible);
    void title(const char *text);
    // Main-thread diagnostics used by the editor integration test host.
    void evaluate(const std::string &script);
    void capture_png(const std::string &path, std::function<void(bool)> complete);
private:
    struct Impl;
    std::shared_ptr<Impl> impl;
};
