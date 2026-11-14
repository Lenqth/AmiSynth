# AmiSynth Modular

Modular is a polyphonic patchable synth available in the Web app and as the standalone `AmiSynthModular.clap` instrument.

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

Build with `npm ci && npm run clap:build`, then install with `npm run install:clap -- --modular`. Release archives built by the CLAP workflow include both `AmiSynth.clap` and `AmiSynthModular.clap`.

Add **AmiSynth Modular** to an instrument track. The plug-in accepts CLAP notes and MIDI and exposes **Macro 1–8** with stable IDs 0–7. Open a factory preset using a DAW that supports CLAP preset discovery. The CLAP preset-load file interface also accepts JSON exported by the Web rack. DAW support for selecting custom preset files varies. The current plug-in uses the host's generic parameter controls. Patch editing takes place in the Web rack.

`clap.state` stores the complete versioned JSON patch and current macro values. Existing Web patches with no version field are treated as version 1. Invalid or oversized loads leave the current patch intact. Patch compilation runs on the main thread, then publishes the result for the next audio block. Note events and macro automation apply at their sample offsets. The processing callback uses preallocated voice and graph storage.

## Current limits

Modular uses 12-TET and per-voice audio-rate signals. The Web DSP and native DSP share module definitions and factory patch data and have separate sample loops. Hosting external CLAP modules is a follow-up to the built-in engine.
