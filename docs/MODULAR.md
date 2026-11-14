# AmiSynth Modular

Modular is a polyphonic patchable synth available in the Web app and as **AmiSynth Modular**, one of the five plugins in `AmiSynth.clap`.

## Web rack

1. Open **Modular** and play the keyboard. **Subtractive** starts with MIDI pitch → VCO → lowpass VCF → VCA → output. A gate-controlled ADSR drives VCA gain.
2. Drag a module title to move it. Scroll or drag the background to pan. Right-click the background to add a module at the cursor: type to search by name, category or keyword (for example "pluck", "filter" or "glide"), then press Enter for the first match or use the arrow keys. Use the copy button or the module's right-click menu to duplicate its knob settings.
   Drag either jack to connect. When dragging from an input, you can drop on the body of a card with one output. Click a connected input to unplug it, or drag it to a new source. The **Cable activity** toggle highlights changing signals from the first active voice.
3. Choose a factory patch from **Preset**. **Vibrato Lead** uses LFO pitch modulation. **Feedback Bass** uses a Unit Delay in its feedback path and Macro 1 for filter cutoff. **Plucked String**, **Marimba** and **Church Bell** use the physical modules. The remaining patches are Synth presets of the same name rebuilt from Modular modules (see [Synth presets](#synth-presets)).
4. **Save patch** and **Open patch** exchange portable JSON files. The app also restores the latest patch from browser storage. Module positions travel with the patch. Piano Roll share links include the patch. To export a sequence, select **Modular** as the Piano Roll melody instrument and choose WAV or MP3.

Patches support up to 32 modules and eight voices. The first **MIDI / Note** module sets the voice mode: **Poly**, **Mono** (last-note priority; releasing a key returns to the one still held) or **Legato** (a new key while one is held keeps the envelopes running), with **glide** time and whether glide happens **Always** or only between overlapping notes. These three knobs are patch settings and take no cable. A structural edit resets the voices. Turning a knob or changing a macro keeps them running. Audio is mono per voice and goes to both stereo channels.

### Signal conventions

| Port or module | Meaning |
| --- | --- |
| MIDI / Note | Pitch is a MIDI note number, gate is 0 or 1, and velocity is 0–1. |
| VCO FM | 1 adds one octave. VCO pitch and FM run at audio rate. |
| VCO PM | Phase modulation in radians, as the Synth instrument's FM index. |
| VCO sync | The **sync** output is 1 on the sample where the cycle restarts. Patched into another VCO's **sync** input, it restarts that oscillator (hard sync). |
| VCO pw, phase | Pulse width for the square wave, which has no DC offset at any width. **phase** is where each note's cycle starts. |
| VCF | Lowpass, highpass, bandpass or notch; 12 or 24 dB (a Butterworth stage before the resonant one); drive soft-clips the input. Key tracking follows the **pitch** input relative to middle C. |
| ADSR curve | **Linear**, or **Exponential**: decay and release fall to −60 dB in their time, as in the Synth instrument. |
| Parameter input | The cable replaces the slider value in the parameter’s native units. Discrete parameters round to the nearest step. Unplugging restores the slider value. |
| VCF cutoff CV | 1 adds two octaves to the cutoff, with a sample-rate-dependent limit. |
| VCA gain | A linear gain multiplier. An unpatched input uses 1. |
| CV Scale / Offset | Applies `input × scale + offset`. An unpatched input uses 0. |
| Macro CV | Outputs one of eight shared 0–1 macro values per voice. |
| Unit Delay | Outputs the previous sample. The value stored at its input is limited to ±4. Every feedback loop needs a delay. |
| Noise | White, or pink (Paul Kellet's filter). Each voice's noise is seeded from its note, identically in the Web and CLAP engines. |
| Sample & Hold | Holds **in** (or new noise when unpatched) on each rising **trigger**, or at **rate** when the trigger is unpatched. |
| Slew / Glide, Envelope Follower | One-pole smoothing with separate rise and fall times; the follower smooths the input's magnitude. |
| Multiply / Ring | `a × b × level`; an unpatched **b** is 1. |
| Comb / Delay Line | Delay of 0.05–40 ms with damped feedback and a dry/wet mix. |
| Pluck String | Karplus-Strong string: a rising **gate** plucks it at **pitch**; **excite** adds input to the loop. **decay** is the time to −60 dB while held, **release** after. |
| Modal Resonator | Eight resonant modes from the Physical instrument's materials, struck by a rising **gate** and excited by **in**. |
| Delay lines | Strings and comb filters share four preallocated lines per voice, so a patch can use four of them. A released voice stays alive while an ADSR, string or modal resonator still rings. |

### Synth presets

`src/presets/modular.js` rebuilds Synth presets from Modular modules: one VCO pair per unison copy, a VCO an octave down for the sub oscillator, VCO sync and PM for hard sync and FM, the same filter slope, drive, resonance curve and key tracking, exponential ADSRs scaled by velocity, LFO pitch, filter, pulse-width and amplitude modulation, the noise filter, and the voice mode and glide. A preset that uses anything else (wavetables, the arpeggiator, effects, the modulation matrix, tempo-synced LFOs or chip noise) is not converted, so a patch never sounds unlike its name. Remaining differences: Modular is mono, its LFO restarts with each voice, its oscillators start at fixed spaced phases instead of random ones, and performance controls (mod wheel, pitch-bend range) are not part of a patch.

## CLAP

Build with `npm ci && npm run clap:build`, then install with `npm run install:clap`. Release archives contain one `AmiSynth.clap` with Synth, Physical, Drums, Tuning and Modular. The installer renames a former standalone `AmiSynthModular.clap` in the destination to an unused `.disabled` backup. Modular retains its plugin ID and JSON state format; projects that stored the old file path may need their instrument replaced with Modular from `AmiSynth.clap`.

Add **AmiSynth Modular** to an instrument track. The plug-in accepts CLAP notes and MIDI and exposes **Macro 1–8** with stable IDs 0–7. Open a factory preset using a DAW that supports CLAP preset discovery. The CLAP preset-load file interface also accepts JSON exported by the Web rack. DAW support for selecting custom preset files varies.

On Windows, open the plugin's editor to use the same node rack as the Web app: add, duplicate, move or remove modules; connect or disconnect cables; and turn each module's knobs. **Save patch** and **Open patch** exchange the same JSON files as the Web rack. Changes apply to the native instrument and mark the DAW project as changed. The complete patch is stored in the DAW project. Knob and layout changes preserve running voices; structural changes end them at the next audio block. Macros remain the eight DAW automation parameters; the other module knobs are edited in the rack. Cable activity visualization is currently available in the Web app only.

The Windows editor requires the Microsoft Edge WebView2 Runtime. Its HTML, scripts and styles are embedded in `AmiSynth.clap`; no web server or internet connection is required to edit a patch. Embedded and floating CLAP windows are supported. macOS and Linux currently use the host's generic parameter controls and JSON patch loading.

The window is created immediately and its WebView2 initialization is scheduled asynchronously after the host's GUI callback returns. This avoids nested host message dispatch during `clap.gui.create`, which can otherwise crash hosts with a borrowed UI context, such as GPUI-based applications. Closing the editor before initialization completes cancels its pending callbacks through weak references.

Developer checks: `tests/modular-parity.test.js` renders every module and factory patch through the Web engine and the native engine (`modular_render`) and requires the same samples. `modular_edit_check` tests the native edit bridge. On Windows, `modular_edit_check --gui-smoke <preview.png>` also opens a temporary editor, exercises adding/removing nodes, connecting cables and changing knobs, and renders a preview image.

`clap.state` stores the complete versioned JSON patch and current macro values. Existing Web patches with no version field are treated as version 1. Invalid or oversized loads leave the current patch intact. Patch compilation runs on the main thread, then publishes the result for the next audio block. Note events and macro automation apply at their sample offsets. The processing callback uses preallocated voice and graph storage.

## Current limits

Modular uses 12-TET and per-voice audio-rate signals. The Web DSP and native DSP share module definitions and factory patch data and have separate sample loops. Hosting external CLAP modules is a follow-up to the built-in engine.
