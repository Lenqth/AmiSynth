# AmiSynth Modular

Modular is a polyphonic patchable synth available in the Web app and as **AmiSynth Modular**, one of the five plugins in `AmiSynth.clap`.

## Web rack

1. Open **Modular** and play the keyboard. **Subtractive** starts with MIDI pitch → VCO → lowpass VCF → VCA → output. A gate-controlled ADSR drives VCA gain.
2. Drag a module title to move it. Scroll or drag the background to pan. Hold Ctrl (⌘ on Mac) and scroll, or pinch a trackpad, to zoom around the pointer; the **−**, **+** and percentage buttons zoom from the centre or reset to 100%, and **Fit** shows every module. Right-click the background to add a module at the cursor: type to search by name, category or keyword (for example "pluck", "filter" or "glide"), then press Enter for the first match or use the arrow keys. Use the copy button or the module's right-click menu to duplicate its knob settings.
   Drag either jack to connect. When dragging from an input, you can drop on the body of a card with one output. Click a connected input to unplug it, or drag it to a new source. The **Cable activity** toggle shows the signals of the first active voice on each cable: a glow as bright as the signal's level, a cable as thick as its swing, and dashes that flow faster and closer together as it cycles faster. A steady value, such as a held gate or pitch, glows without flowing.
3. Choose a factory patch from **Preset**. **Vibrato Lead** uses LFO pitch modulation. **Feedback Bass** uses a Unit Delay in its feedback path and Macro 1 for filter cutoff. **Plucked String**, **Marimba** and **Church Bell** use the physical modules. The remaining patches are Synth presets of the same name rebuilt from Modular modules (see [Synth presets](#synth-presets)).
4. **Save patch** and **Open patch** exchange portable JSON files. The app also restores the latest patch from browser storage. Module positions travel with the patch. Piano Roll share links include the patch. To export a sequence, select **Modular** as the Piano Roll melody instrument and choose WAV or MP3.

Use the checkboxes on module cards to select a group. **Duplicate selection** copies the modules and cables within the group. **Save selection** writes the group to a fragment JSON file, and **Insert fragment** adds it to any open rack. **Undo** and **Redo** step through rack edits without changing the current macro values.

On the Web, choose any module output in **Scope** to see the most recent 1024 samples from the first active voice, along with the current value and range. The output need not have a cable connected.

Patches support up to 32 modules and eight voices. The first **MIDI / Note** module sets the voice mode: **Poly**, **Mono** (last-note priority; releasing a key returns to the one still held) or **Legato** (a new key while one is held keeps the envelopes running), with **glide** time and whether glide happens **Always** or only between overlapping notes. These three knobs are patch settings and take no cable. A structural edit resets the voices. Turning a knob or changing a macro keeps them running. Each cable carries one signal. Connect both Audio output inputs for stereo.

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
| Pan / Spread | **In** is a mono signal. **Pan** sets its position and **spread** distributes polyphonic voices across alternating positions. Patch **left** to Audio output's **audio** input and **right** to **right**. |
| Audio output | **Audio** feeds the left channel. An unpatched **right** copies that signal, so existing mono patches play in both channels. |
| CV Scale / Offset | Applies `input × scale + offset`. An unpatched input uses 0. |
| Macro CV | Reads one of eight shared 0–1 macros and maps it from **from** to **to**. Reverse the endpoints to invert the response. **curve** changes the response between the endpoints. Use a separate Macro CV module per range. Name macros in the rack to identify them in the patch and in CLAP hosts. |
| Unit Delay | Outputs the previous sample. The value stored at its input is limited to ±4. Every feedback loop needs a delay. |
| Noise | White, or pink (Paul Kellet's filter). Each voice's noise is seeded from its note, identically in the Web and CLAP engines. |
| Sample & Hold | Holds **in** (or new noise when unpatched) on each rising **trigger**, or at **rate** when the trigger is unpatched. |
| Function Generator | A rising **trigger** restarts the envelope from zero. **rise** and **fall** are in seconds, and **curve** shapes the 0–1 output. **eoc** pulses for one sample at the end of the fall. In **Loop** mode, a high **run** starts or repeats cycles. Lowering **run** lets the current cycle finish. Unpatched trigger and run follow the voice's note gate. |
| Clock | Generates a shared **gate** pulse and a 0–1 **phase** ramp. Set **bpm**, **pulses** per beat and the fraction of each pulse spent high (**duty**). |
| Clock Divider | Passes the first and every Nth **clock** pulse, keeping its width. Hold **reset** high to clear the count and suppress the output. |
| Step Sequencer | Advances on rising **clock**, starting at step 1. **CV** holds the current step value. **Gate** follows the clock when that step passes the **probability** check. **Reset** returns to step 1 and suppresses the gate while high. |
| Drum Voice | A rising **trigger** starts a kick, snare, clap, closed hat, open hat, or tom. **Velocity** scales the hit and a high **choke** cuts its tail. **Tune** shifts the selected sound in semitones; **decay** scales its tail time. Try **Patch Beat** for a rack that sequences its own percussion. |
| Pitch Quantizer | Rounds MIDI note values to the closest note in the chosen **root** and **scale**, choosing the lower note on ties. |
| Slew / Glide, Envelope Follower | One-pole smoothing with separate rise and fall times; the follower smooths the input's magnitude. |
| Multiply / Ring | `a × b × level`; an unpatched **b** is 1. |
| Wavefolder / Shaper | **Drive** amplifies the signal before **bias** shifts it. **Fold** reflects it at ±1, while **Soft clip** saturates it smoothly. **Mix** blends the result with the input. |
| Bowed String | Two string sections and a nonlinear bow contact sustain a note while **gate** is high. Patch velocity or CV into **bow** to scale the bow speed. **Pressure**, **position**, and **damping** change the response. It rings after note-off and uses two of the four available delay lines. Try **Bow Grain**. |
| Reed Pipe | A clarinet-style reed and bore sustain a tone while **gate** is high. **Pitch** tunes the bore; **breath** scales **pressure** from 0 to 1. **Embouchure** changes the reed stiffness. The module uses one of the four delay lines. Try **Velvet Reed** and its **Breath** macro. |
| Comb / Delay Line | Delay of 0.05–40 ms with damped feedback and a dry/wet mix. |
| Pluck String | Karplus-Strong string: a rising **gate** plucks it at **pitch**; **excite** adds input to the loop. **decay** is the time to −60 dB while held, **release** after. |
| Modal Resonator | Uses a built-in material or a custom table of up to eight resonant modes. A rising **gate** strikes it and **in** adds continuous excitation. |
| Delay lines | Strings and comb filters share four preallocated lines per voice, so a patch can use four of them. A released voice stays alive while an ADSR, function generator, string or modal resonator is still active, up to the voice tail limit. |

### Custom resonance tables

On a Modal Resonator, choose **Edit resonance**. The table starts with a copy of the selected material; **Copy selected material** restores that starting point in the editor. Add or remove modes and set each mode's frequency ratio, gain and decay multiplier. A ratio of 2 sounds an octave above the pitch input. Gain 0 silences a mode. A decay multiplier of 1 keeps the decay set by the module's Decay, Release and Brightness controls. Modes above 45% of the sample rate are skipped.

Choose **Apply table** to use the draft, or **Use built-in material** to return to the original material knob and its CV input. Applying or removing a table is a structural edit and ends current voices. Tables are part of the patch JSON and CLAP project state. To reuse a table in another rack, select its module and use **Save selection**. **Twin Glass** demonstrates two close frequencies that beat against each other.

### Percussion layers

Drum Voice also offers **Rimshot**, **Cowbell**, **Shaker**, **Crash**, and **Ride**. The **Cowbell and Shaker** and **Rim and Cymbal** patches trigger two Drum Voice modules from the same note and route them through a mixer. Set their **Tune**, **Tone**, or **Decay** individually.

### Synth presets

`src/presets/modular.js` rebuilds Synth presets from Modular modules: one VCO pair per unison copy, a VCO an octave down for the sub oscillator, VCO sync and PM for hard sync and FM, the same filter slope, drive, resonance curve and key tracking, exponential ADSRs scaled by velocity, LFO pitch, filter, pulse-width and amplitude modulation, the noise filter, and the voice mode and glide. A preset that uses anything else (wavetables, the arpeggiator, effects, the modulation matrix, tempo-synced LFOs or chip noise) is not converted, so a patch never sounds unlike its name. Remaining differences: these patches use mono output, the Modular LFO restarts with each voice, its oscillators start at fixed spaced phases instead of random ones, and performance controls (mod wheel, pitch-bend range) are not part of a patch.

## CLAP

Build with `npm ci && npm run clap:build`, then install with `npm run install:clap`. Release archives contain one `AmiSynth.clap` with Synth, Physical, Drums, Tuning and Modular. The installer renames a former standalone `AmiSynthModular.clap` in the destination to an unused `.disabled` backup. Modular retains its plugin ID and JSON state format; projects that stored the old file path may need their instrument replaced with Modular from `AmiSynth.clap`.

Add **AmiSynth Modular** to an instrument track. The plug-in accepts CLAP notes and MIDI and exposes **Macro 1–8** with stable IDs 0–7. Open a factory preset using a DAW that supports CLAP preset discovery. The CLAP preset-load file interface also accepts JSON exported by the Web rack. DAW support for selecting custom preset files varies.

On Windows, open the plugin's editor to use the same node rack as the Web app: add, duplicate, move or remove modules; connect or disconnect cables; and turn each module's knobs. **Save patch** and **Open patch** exchange the same JSON files as the Web rack. Changes apply to the native instrument and mark the DAW project as changed. The complete patch is stored in the DAW project. Knob and layout changes preserve running voices; structural changes end them at the next audio block. Macros remain the eight DAW automation parameters; the other module knobs are edited in the rack. Cable activity visualization is currently available in the Web app only.

The Windows editor requires the Microsoft Edge WebView2 Runtime. Its HTML, scripts and styles are embedded in `AmiSynth.clap`; no web server or internet connection is required to edit a patch. Embedded and floating CLAP windows are supported. macOS and Linux currently use the host's generic parameter controls and JSON patch loading.

The window is created immediately and its WebView2 initialization is scheduled asynchronously after the host's GUI callback returns. This avoids nested host message dispatch during `clap.gui.create`, which can otherwise crash hosts with a borrowed UI context, such as GPUI-based applications. Closing the editor before initialization completes cancels its pending callbacks through weak references.

Developer checks: `tests/modular-parity.test.js` renders every module and factory patch through the Web engine and the native engine (`modular_render`) and requires the same samples. `modular_edit_check` tests the native edit bridge. On Windows, `modular_edit_check --gui-smoke <preview.png>` also opens a temporary editor, exercises adding/removing nodes, connecting cables and changing knobs, and renders a preview image.

`clap.state` stores the complete versioned JSON patch and current macro values. Existing Web patches with no version field are treated as version 1. Invalid or oversized loads leave the current patch intact. Patch compilation runs on the main thread, then publishes the result for the next audio block. Note events and macro automation apply at their sample offsets. The processing callback uses preallocated voice and graph storage.

## Current limits

Clock uses the rack's own tempo. Patches that contain Clock and omit MIDI / Note run as a single voice without MIDI, as in **Clockwork Plucks**. With MIDI / Note present, playing a note starts a voice and its sequencer, while all voices read the same clock phase.

Modular uses 12-TET and per-voice audio-rate signals. The Web DSP and native DSP share module definitions and factory patch data and have separate sample loops. Hosting external CLAP modules is a follow-up to the built-in engine.
