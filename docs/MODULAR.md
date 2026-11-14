# AmiSynth Modular (experimental)

AmiSynth Modular is a fourth **independent** sound engine beside Synth, Physical and Drums. The initial implementation runs in the browser AudioWorklet and in the offline renderer. **It is not yet exposed as a CLAP or JSFX instrument.**

## First milestone

1. Select the **Modular** tab and start audio by playing the on-screen keyboard.
2. The default patch is MIDI pitch → VCO → VCF → VCA → output, with a gate-controlled ADSR connected to VCA gain.
3. Add up to 32 modules, configure parameters, and route output ports to input ports using the cable editor.
4. Each input permits one incoming cable (use Mixer modules for multiple sources); multiple outputs and multiple destination connections are permitted.
5. Graphs are topologically sorted. Cycles and malformed connections are rejected. Feedback needs an explicit delay module in a later milestone.
6. Graph patches are stored in localStorage, included in share links, and rendered by the WAV/MP3 offline renderer. Preset browsing for complete patches is planned.

The included nodes are MIDI/Note, VCO, LFO, ADSR, lowpass VCF, VCA, two-input mixer and audio output. VCO has four waveforms, including band-limited saw/pulse; VCF is a state-variable lowpass; ADSR is gated per voice. The first version supports 8 voices. Port signals are audio-rate scalar values per voice.

### Architecture

- `src/dsp/modular.js`: portable, pure JavaScript graph compiler, validator and DSP runtime.
- `src/worklets/modular-processor.js`: AudioWorklet adapter reusing the MIDI/sample-accurate event queue.
- `src/ui/ModularRack.svelte`: patch and parameter editor.
- `src/lib/engine.js`, `state.svelte.js`, `song.js`, `render.js`, `share.js`: integration with the existing application.
- `tests/modular.test.js`: graph correctness, finite audio, note release, update and validation tests.

**Current limitations:** The UI edits cables using dropdowns rather than drag-and-drop patch cords. There is no module positioning, CV scaling/attenuverter, feedback/delay block, sample-rate independent control bus, patch preset library, or polyphony routing modes. Tuning from the separate scale editor is not wired to Modular yet. Structural graph edits reset active voices; parameter-only edits keep them. Audio is mono per voice then summed to both stereo channels.

## CLAP migration plan

The existing `clap/src/amisynth_clap.cpp` runs bundled **JSFX** via ysfx; it cannot simply embed this arbitrary graph JSON as a JSFX slider group. A future Modular CLAP plugin should be a separate plugin descriptor with its own native modular runtime (or a dedicated graph interpreter), with a versioned state serializer and macro-based CLAP parameter automation. It should not require adding/removing host-visible CLAP parameters for every module.

Proposed milestones:

- **A1:** Web runtime and graph patch editor (this branch).
- **A2:** Better patch-cable UI, per-voice/global separation, attenuverters, feedback/delay, preset management, tuning and regression/performance tests.
- **A3:** Dedicated CLAP Modular descriptor, graph serialization through `clap.state`, host-visible macro automation; ensure round-trip patch compatibility and test with clap-check / offline render.
- **B:** Optional CLAP-hosting modules with sandboxing/lifecycle, plugin state, audio/note port adapters and clear failure isolation. Plugin-hosting modules are explicitly *not* required for A.
