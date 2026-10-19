#!/usr/bin/env bash
# Build jsfx/tools/jsfx_render (offline JSFX host on top of ysfx) into .cache/.
# Used by tests/jsfx.test.js to compare the JSFX port with the JS DSP.
#
#   npm run jsfx:tools          upstream ysfx (jpcima)        -> .cache/jsfx_render
#   npm run jsfx:tools:ysfx-s   ysfx-s (JoepVanlier), the core of the VST3 / CLAP / AU
#                               plugin used outside REAPER    -> .cache/jsfx_render_s
#                               (+ .cache/jsfx_meter_check_s when freetype / fontconfig exist)
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p .cache
if [ "${1:-}" = "--ysfx-s" ]; then
  YSFX_REPO=https://github.com/JoepVanlier/ysfx.git
  YSFX_COMMIT=${YSFX_COMMIT:-5c3452fee62583aa3d1b7e877d0c758c4024af89} # v0.0.47
  DIR=.cache/ysfx-s
  SUFFIX=_s
else
  YSFX_REPO=https://github.com/jpcima/ysfx.git
  YSFX_COMMIT=${YSFX_COMMIT:-8077347ccf4115567aed81400281dca57acbb0cc}
  DIR=.cache/ysfx
  SUFFIX=
fi
if [ ! -d "$DIR" ]; then
  git clone "$YSFX_REPO" "$DIR"
  git -C "$DIR" checkout -q "$YSFX_COMMIT" || true
  git -C "$DIR" submodule update --init --recursive --depth 1
fi
cmake -S "$DIR" -B "$DIR/build" -DCMAKE_BUILD_TYPE=Release -DYSFX_PLUGIN=OFF -DYSFX_GFX=OFF -DYSFX_TOOLS=OFF > /dev/null
cmake --build "$DIR/build" -j > /dev/null
g++ -O2 -std=c++17 -I"$DIR/include" jsfx/tools/jsfx_render.cpp "$DIR/build/libysfx.a" -o ".cache/jsfx_render$SUFFIX" -lpthread -ldl
echo "built .cache/jsfx_render$SUFFIX"
if [ -n "$SUFFIX" ] && pkg-config --exists freetype2 fontconfig 2> /dev/null; then
  cmake -S "$DIR" -B "$DIR/build-gfx" -DCMAKE_BUILD_TYPE=Release -DYSFX_PLUGIN=OFF -DYSFX_GFX=ON -DYSFX_TOOLS=OFF > /dev/null
  cmake --build "$DIR/build-gfx" -j > /dev/null
  g++ -O2 -std=c++17 -I"$DIR/include" jsfx/tools/jsfx_meter_check.cpp "$DIR/build-gfx/libysfx.a" -o ".cache/jsfx_meter_check$SUFFIX" \
    -lpthread -ldl $(pkg-config --libs freetype2 fontconfig)
  echo "built .cache/jsfx_meter_check$SUFFIX"
fi
