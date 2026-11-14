# AmiSynth Modular

Modular is a polyphonic patchable synth available in the Web app and as **AmiSynth Modular**, one of the five plugins in `AmiSynth.clap`.

## Web rack

1. Open **Modular** and play the keyboard. **Subtractive** starts with MIDI pitch → VCO → lowpass VCF → VCA → output. A gate-controlled ADSR drives VCA gain.
2. Drag a module title to move it. Scroll or drag the background to pan. Right-click the background to add a module at the cursor. Use the copy button or the module's right-click menu to duplicate its knob settings.
   Drag either jack to connect. When dragging from an input, you can drop on the body of a card with one output. Click a connected input to unplug it, or drag it to a new source. The **Cable activity** toggle highlights changing signals from the first active voice.
3. Choose a factory patch from **Preset**. **Vibrato Lead** uses LFO pitch modulation. **Feedback Bass** uses a Unit Delay in its feedback path and Macro 1 for filter cutoff.
4. **Save patch** and **Open patch** exchange portable JSON files. The app also restores the latest patch from browser storage. Module positions travel with the patch. Piano Roll share links include the patch. To export a sequence, select **Modular** as the Piano Roll melody instrument and choose WAV or MP3.

Patches support up to 32 modules and eight voices. A structural edit resets the voices. Turning a knob or changing a macro keeps them running. Audio is mono per voice and goes to both stereo channels.

### Signal conventions

| Port or module | Meaning |
| --- | --- |
| MIDI / Note | Pitch is a MIDI note number, gate is 0 or 1, and velocity is 0–1. |
| VCO FM | 1 adds one octave. VCO pitch and FM run at audio rate. |
| Parameter input | The cable replaces the slider value in the parameter’s native units. Discrete parameters round to the nearest step. Unplugging restores the slider value. |
| VCF cutoff CV | 1 adds two octaves to the cutoff, with a sample-rate-dependent limit. |
| VCA gain | A linear gain multiplier. An unpatched input uses 1. |
| CV Scale / Offset | Applies `input × scale + offset`. An unpatched input uses 0. |
| Macro CV | Outputs one of eight shared 0–1 macro values per voice. |
| Unit Delay | Outputs the previous sample. The value stored at its input is limited to ±4. Every feedback loop needs a delay. |

## CLAP

Build with `npm ci && npm run clap:build`, then install with `npm run install:clap`. Release archives contain one `AmiSynth.clap` with Synth, Physical, Drums, Tuning and Modular. The installer renames a former standalone `AmiSynthModular.clap` in the destination to an unused `.disabled` backup. Modular retains its plugin ID and JSON state format; projects that stored the old file path may need their instrument replaced with Modular from `AmiSynth.clap`.

Add **AmiSynth Modular** to an instrument track. The plug-in accepts CLAP notes and MIDI and exposes **Macro 1–8** with stable IDs 0–7. Open a factory preset using a DAW that supports CLAP preset discovery. The CLAP preset-load file interface also accepts JSON exported by the Web rack. DAW support for selecting custom preset files varies.

On Windows, open the plugin's editor to use the same node rack as the Web app: add, duplicate, move or remove modules; connect or disconnect cables; and turn each module's knobs. **Save patch** and **Open patch** exchange the same JSON files as the Web rack. Changes apply to the native instrument and mark the DAW project as changed. The complete patch is stored in the DAW project. Knob and layout changes preserve running voices; structural changes end them at the next audio block. Macros remain the eight DAW automation parameters; the other module knobs are edited in the rack. Cable activity visualization is currently available in the Web app only.

The Windows editor requires the Microsoft Edge WebView2 Runtime. Its HTML, scripts and styles are embedded in `AmiSynth.clap`; no web server or internet connection is required to edit a patch. Embedded and floating CLAP windows are supported. macOS and Linux currently use the host's generic parameter controls and JSON patch loading.

Developer checks: `modular_edit_check` tests the native edit bridge. On Windows, `modular_edit_check --gui-smoke <preview.png>` also opens a temporary editor, exercises adding/removing nodes, connecting cables and changing knobs, and renders a preview image.

`clap.state` stores the complete versioned JSON patch and current macro values. Existing Web patches with no version field are treated as version 1. Invalid or oversized loads leave the current patch intact. Patch compilation runs on the main thread, then publishes the result for the next audio block. Note events and macro automation apply at their sample offsets. The processing callback uses preallocated voice and graph storage.

## Current limits

Modular uses 12-TET and per-voice audio-rate signals. The Web DSP and native DSP share module definitions and factory patch data and have separate sample loops. Hosting external CLAP modules is a follow-up to the built-in engine.
