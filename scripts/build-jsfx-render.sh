#!/usr/bin/env bash
# Build jsfx/tools/jsfx_render (offline JSFX host on top of ysfx) into .cache/.
# Used by tests/jsfx.test.js to compare the JSFX port with the JS DSP.
set -euo pipefail
cd "$(dirname "$0")/.."
YSFX_REPO=https://github.com/jpcima/ysfx.git
YSFX_COMMIT=${YSFX_COMMIT:-8077347ccf4115567aed81400281dca57acbb0cc}
mkdir -p .cache
if [ ! -d .cache/ysfx ]; then
  git clone --recurse-submodules --shallow-submodules "$YSFX_REPO" .cache/ysfx
  git -C .cache/ysfx checkout -q "$YSFX_COMMIT" || true
fi
cmake -S .cache/ysfx -B .cache/ysfx/build -DCMAKE_BUILD_TYPE=Release -DYSFX_PLUGIN=OFF -DYSFX_GFX=OFF -DYSFX_TOOLS=OFF > /dev/null
cmake --build .cache/ysfx/build -j > /dev/null
g++ -O2 -std=c++17 -I.cache/ysfx/include jsfx/tools/jsfx_render.cpp .cache/ysfx/build/libysfx.a -o .cache/jsfx_render -lpthread -ldl
echo "built .cache/jsfx_render"
