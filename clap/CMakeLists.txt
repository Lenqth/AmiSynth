# AmiSynth CLAP plugin: the JSFX in ../jsfx run by the ysfx library and embedded in one .clap file.
#   cmake -S clap -B .cache/clap-build -DCMAKE_BUILD_TYPE=Release && cmake --build .cache/clap-build
cmake_minimum_required(VERSION 3.21)
project(amisynth_clap VERSION 0.1.0 LANGUAGES C CXX ASM)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_POSITION_INDEPENDENT_CODE ON)
set(CMAKE_C_VISIBILITY_PRESET hidden)
set(CMAKE_CXX_VISIBILITY_PRESET hidden)
set(CMAKE_VISIBILITY_INLINES_HIDDEN ON)
if(MSVC)
  set(CMAKE_MSVC_RUNTIME_LIBRARY "MultiThreaded$<$<CONFIG:Debug>:Debug>")
endif()

include(FetchContent)
FetchContent_Declare(clap
  GIT_REPOSITORY https://github.com/free-audio/clap.git
  GIT_TAG 1.2.6)
# ysfx-s: the JSFX engine checked by `npm run test:ysfx-s`; only its Apache-2.0 library is used
# (no JUCE plugin, no graphics)
set(YSFX_PLUGIN OFF CACHE BOOL "" FORCE)
set(YSFX_GFX OFF CACHE BOOL "" FORCE)
set(YSFX_TOOLS OFF CACHE BOOL "" FORCE)
set(YSFX_TESTS OFF CACHE BOOL "" FORCE)
set(YSFX_SKIP_CHECKSUM ON CACHE BOOL "" FORCE)
FetchContent_Declare(ysfx
  GIT_REPOSITORY https://github.com/JoepVanlier/ysfx.git
  GIT_TAG 5c3452fee62583aa3d1b7e877d0c758c4024af89 # v0.0.47
  GIT_SUBMODULES thirdparty/dr_libs
  GIT_SUBMODULES_RECURSE OFF)
FetchContent_MakeAvailable(clap ysfx)

set(JSFX_DIR "${CMAKE_CURRENT_SOURCE_DIR}/../jsfx")
set(JSFX_FILES
  "${JSFX_DIR}/AmiSynth Synth.jsfx"
  "${JSFX_DIR}/AmiSynth Physical.jsfx"
  "${JSFX_DIR}/AmiSynth Drums.jsfx"
  "${JSFX_DIR}/AmiSynth Tuning.jsfx"
  "${JSFX_DIR}/amisynth_lib.jsfx-inc"
  "${JSFX_DIR}/amisynth_meter.jsfx-inc"
  "${JSFX_DIR}/amisynth_modulation.jsfx-inc"
  "${JSFX_DIR}/AmiSynth Synth.jsfx.rpl"
  "${JSFX_DIR}/AmiSynth Physical.jsfx.rpl"
  "${JSFX_DIR}/AmiSynth Drums.jsfx.rpl")
set(EMBEDDED "${CMAKE_CURRENT_BINARY_DIR}/generated/amisynth_embedded.h")
list(JOIN JSFX_FILES "\n" JSFX_LIST)
file(WRITE "${CMAKE_CURRENT_BINARY_DIR}/generated/jsfx-files.txt" "${JSFX_LIST}\n")
add_custom_command(
  OUTPUT "${EMBEDDED}"
  COMMAND "${CMAKE_COMMAND}" "-DOUT=${EMBEDDED}" "-DLIST=${CMAKE_CURRENT_BINARY_DIR}/generated/jsfx-files.txt"
    "-DAUTOMATION=${JSFX_DIR}/generated/automation.json" -P "${CMAKE_CURRENT_SOURCE_DIR}/cmake/embed-jsfx.cmake"
  DEPENDS ${JSFX_FILES} "${JSFX_DIR}/generated/automation.json" "${CMAKE_CURRENT_SOURCE_DIR}/cmake/embed-jsfx.cmake"
  VERBATIM)

add_library(AmiSynth MODULE src/amisynth_clap.cpp "${EMBEDDED}")
target_include_directories(AmiSynth PRIVATE "${CMAKE_CURRENT_BINARY_DIR}/generated")
target_link_libraries(AmiSynth PRIVATE clap ysfx::ysfx)
target_compile_definitions(AmiSynth PRIVATE "AMISYNTH_VERSION=\"${PROJECT_VERSION}\"")
set_target_properties(AmiSynth PROPERTIES PREFIX "" SUFFIX ".clap")
if(APPLE)
  set_target_properties(AmiSynth PROPERTIES
    BUNDLE TRUE
    BUNDLE_EXTENSION clap
    MACOSX_BUNDLE_GUI_IDENTIFIER com.github.lenqth.amisynth
    MACOSX_BUNDLE_BUNDLE_NAME AmiSynth
    MACOSX_BUNDLE_BUNDLE_VERSION "${PROJECT_VERSION}"
    MACOSX_BUNDLE_SHORT_VERSION_STRING "${PROJECT_VERSION}"
    MACOSX_BUNDLE_INFO_PLIST "${CMAKE_CURRENT_SOURCE_DIR}/cmake/Info.plist.in")
  target_link_libraries(AmiSynth PRIVATE "-framework CoreFoundation")
elseif(UNIX)
  target_link_options(AmiSynth PRIVATE "-Wl,--no-undefined")
endif()

# offline host for the tests: loads the built .clap like a DAW does (see tests/jsfx.test.js)
add_executable(clap_render tools/clap_render.cpp)
target_link_libraries(clap_render PRIVATE clap ${CMAKE_DL_LIBS})
add_dependencies(clap_render AmiSynth)
add_executable(clap_check tools/clap_check.cpp)
target_link_libraries(clap_check PRIVATE clap ${CMAKE_DL_LIBS})
add_dependencies(clap_check AmiSynth)
