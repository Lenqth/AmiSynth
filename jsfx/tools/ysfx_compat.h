// Small shims so the tools build against both upstream ysfx (jpcima) and the
// maintained fork ysfx-s (JoepVanlier), which is what the VST3 / CLAP / AU plugin uses.
#pragma once
#include "ysfx.h"
#include <utility>

namespace ysfx_compat {
// ysfx-s added a `notify` argument to ysfx_slider_set_value; true runs @slider like a host change.
template <class F>
auto set_slider(F f, ysfx_t *fx, uint32_t index, ysfx_real value, int) -> decltype(f(fx, index, value, true), void()) {
    f(fx, index, value, true);
}
template <class F>
auto set_slider(F f, ysfx_t *fx, uint32_t index, ysfx_real value, long) -> decltype(f(fx, index, value), void()) {
    f(fx, index, value);
}
}

inline void set_slider(ysfx_t *fx, uint32_t index, ysfx_real value) {
    ysfx_compat::set_slider(&ysfx_slider_set_value, fx, index, value, 0);
}
