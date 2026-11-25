# AmiSynth Modular

Modular is a polyphonic patchable synth available in the Web app and as **AmiSynth Modular**, one of the five plugins in `AmiSynth.clap`.

## Web rack

1. Open **Modular** and play the keyboard. **Subtractive** starts with MIDI pitch → VCO → lowpass VCF → VCA → output. A gate-controlled ADSR drives VCA gain.
2. Drag a module title to move it. Scroll or drag the background to pan. Hold Ctrl (⌘ on Mac) and scroll, or pinch a trackpad, to zoom around the pointer; the **−**, **+** and percentage buttons zoom from the centre or reset to 100%, and **Fit** shows every module. Right-click the background to add a module at the cursor: type to search by name, category or keyword (for example "pluck", "filter" or "glide"), then press Enter for the first match or use the arrow keys. Use the copy button or the module's right-click menu to duplicate its knob settings.
   Drag either jack to connect. When dragging from an input, you can drop on the body of a card with one output. Click a connected input to unplug it, or drag it to a new source. The **Cable activity** toggle shows the signals of the first active voice on each cable: a glow as bright as the signal's level, a cable as thick as its swing, and dashes that flow faster and closer together as it cycles faster. A steady value, such as a held gate or pitch, glows without flowing.
3. Choose a factory patch from **Preset**. Use **Search presets** for a name, genre, source instrument or description, and **Preset genre** to narrow the list. The current preset stays visible while you search. Factory patches include Synth conversions, physical instruments, and rhythm patches.
4. **Save patch** and **Open patch** exchange portable JSON files. The app also restores the latest patch from browser storage. Module positions travel with the patch. Piano Roll share links include the patch. To export a sequence, select **Modular** as the Piano Roll melody instrument and choose WAV or MP3.

Use the checkboxes on module cards to select a group. **Duplicate selection** copies the modules and cables within the group. **Save selection** writes the group to a fragment JSON file, and **Insert fragment** adds it to any open rack. **Undo** and **Redo** step through rack edits without changing the current macro values.

On the Web, choose any module output in **Scope** to see the most recent 1024 samples from the first active voice, along with the current value and range. The output need not have a cable connected.

Patches support up to 32 modules and eight voices. The first **MIDI / Note** module sets the voice mode: **Poly**, **Mono** (last-note priority; releasing a key returns to the one still held) or **Legato** (a new key while one is held keeps the envelopes running), with **glide** time and whether glide happens **Always** or only between overlapping notes. These three knobs are patch settings and take no cable. A structural edit resets the voices. Turning a knob or changing a macro keeps them running. Each cable carries one signal. Connect both Audio output inputs for stereo.

### Signal conventions

Type an exact value next to a numeric slider or macro. Press Enter or leave the field to apply it, or press Escape to cancel. Values stay within the control's range. A parameter driven by a cable can be edited again after unplugging it.

| Port or module | Meaning |
| --- | --- |
| MIDI / Note | Pitch is a MIDI note number, gate is 0 or 1, and velocity is 0–1. **bend** is the pitch wheel from −1 to 1; it also moves **pitch** by **bendRange** semitones (default 2, set by the first MIDI / Note module). **mod** is the modulation wheel (CC1), 0–1. **pressure** is the larger of channel aftertouch and the note's own polyphonic aftertouch, 0–1. **cc** reads the controller chosen by the **cc** knob (default 74), 0–1. Use another MIDI / Note module to read a second CC. Controllers are tracked per MIDI channel, so MPE input works. Volume (CC7) starts at 100, pan (CC10) at 64 and expression (CC11) at 127; Reset All Controllers (CC121) restores these defaults. |
| VCO FM | 1 adds one octave. VCO pitch and FM run at audio rate. |
| VCO PM | Phase modulation in radians, as the Synth instrument's FM index. |
| VCO sync | The **sync** output is 1 on the sample where the cycle restarts. Patched into another VCO's **sync** input, it restarts that oscillator (hard sync). |
| Wavetable Oscillator | Select a **bank** and sweep **position** from 0 to 1 to blend its frames. **Pitch**, **FM**, **PM** and rising **sync** control the oscillator. **Voices** sets 1–7 copies, **detune** is their total pitch spread in cents, and **spread** sets their stereo width. Use **out** for mono, or patch **left** and **right** to separate channels. |
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
| Synth Noise | The Synth instrument's special noises. **Chip Long** and **Chip Short** are an 8-bit console's 15-bit shift register (Short repeats every 93 steps, so it has a metallic pitch), and **Sample & Hold** is stepped white noise; these three are clocked from **pitch**. **Rotor** (blade thumps with an air wash), **Crowd Claps** (eighteen independently timed claps), **Shot** (a short crack with one early reflection, restarted with each note) and **Rain** (a wash with irregular droplets) have their own timing. **clock** shifts every clock by octaves. It keeps its timers in one delay line. |
| Sample & Hold | Holds **in** (or new noise when unpatched) on each rising **trigger**, or at **rate** when the trigger is unpatched. |
| Function Generator | A rising **trigger** restarts the envelope from zero. **rise** and **fall** are in seconds, and **curve** shapes the 0–1 output. **eoc** pulses for one sample at the end of the fall. In **Loop** mode, a high **run** starts or repeats cycles. Lowering **run** lets the current cycle finish. Unpatched trigger and run follow the voice's note gate. |
| Clock | Generates a shared **gate** pulse and a 0–1 **phase** ramp. Set **bpm**, **pulses** per beat and the fraction of each pulse spent high (**duty**). With **sync** set to **Host**, the clock follows the DAW's tempo and beat position instead of **bpm**: pulses land on the host's beat grid while the transport plays, and while it is stopped the gate and phase stay at 0 and **reset** is high. Connect **reset** to a sequencer's **reset** so playback restarts at step 1. In Free mode **reset** stays 0. |
| Gated Clock | Emits **gate** pulses and a **phase** ramp while a key is physically held, or while a connected **run** signal is positive. It starts with a pulse, resets its phase when released, and holds **reset** high while stopped. Connect that output to the sequencer's **reset** input to restart at step 1. With **sync** set to **Host**, the DAW's tempo replaces **bpm**; the clock still starts when a key goes down. |
| Beat Grid | Patch a pulse source into **clock**. Each rising edge advances one column in the grid, starting at step 1. Click a cell to send that step's pulse to output **A**, **B**, **C**, or **D**. Set **Steps** to show and loop over 1–32 columns; scroll horizontally to reach later columns. Shortening the loop keeps the hidden cells for later use. A high **reset** silences the outputs and returns to step 1 for the next rising edge. |
| Clock Divider | Passes the first and every Nth **clock** pulse, keeping its width. Hold **reset** high to clear the count and suppress the output. |
| Step Sequencer | Advances on rising **clock**, starting at step 1. **CV** holds the current step value. **Gate** follows the clock when that step passes the **probability** check. **Reset** returns to step 1 and suppresses the gate while high. |
| Drum Voice | A rising **trigger** starts a kick, snare, clap, closed hat, open hat, or tom. **Velocity** scales the hit and a high **choke** cuts its tail. **Tune** shifts the selected sound in semitones; **decay** scales its tail time. Hold a note in **Patch Beat** to play the percussion pattern. |
| Pitch Quantizer | Rounds MIDI note values to the closest note in the chosen **root** and **scale**, choosing the lower note on ties. |
| Slew / Glide, Envelope Follower | One-pole smoothing with separate rise and fall times; the follower smooths the input's magnitude. |
| Multiply / Ring | `a × b × level`; an unpatched **b** is 1. |
| Wavefolder / Shaper | **Drive** amplifies the signal before **bias** shifts it. **Fold** reflects it at ±1, while **Soft clip** saturates it smoothly. **Mix** blends the result with the input. |
| Bowed String | Two string sections and a nonlinear bow contact sustain a note while **gate** is high. Patch velocity or CV into **bow** to scale the bow speed. **Pressure**, **position**, and **damping** change the response. It rings after note-off and uses two of the four available delay lines. Try **Bow Grain**. |
| Reed Pipe | A clarinet-style reed and bore sustain a tone while **gate** is high. **Pitch** tunes the bore; **breath** scales **pressure** from 0 to 1. **Embouchure** changes the reed stiffness. The module uses one of the four delay lines. Try **Velvet Reed** and its **Breath** macro. |
| Comb / Delay Line | Delay of 0.05–40 ms with damped feedback and a dry/wet mix. |
| Pluck String | Karplus-Strong string: a rising **gate** plucks it at **pitch**; **excite** adds input to the loop. **decay** is the time to −60 dB while held, **release** after. |
| Physical String | The Physical instrument's String model. A rising **gate** fills the loop with a noise burst (**Pluck**) or a smooth pulse (**Strike**), combed at the **pick** position and brightened by **velocity**. **decay** is the time to −60 dB while held, **release** after, and **damping** darkens each round trip. **sawari** adds the buzzing jawari bridge of a sitar or shamisen, **plectrum** blends the noise burst towards the shape a plectrum releases, and **body** adds a skin or body resonance struck by the plectrum (**hardness**, **contact**). |
| Physical Bowed String | The Physical instrument's Bowed model: bridge and nut delay lines meet at the bow **position**, a friction curve set by **pressure** couples bow and string, and two body resonances color the bridge signal. **bow** is the bow envelope from 0 to 1, scaled by **speed**. **brightness** sets the bridge's high-frequency loss. It uses two of the four delay lines. |
| Physical Wind | The Physical instrument's Wind model. **type** picks a clarinet reed on a cylindrical bore, a flute's air jet, a saxophone or double reed on a conical bore, or a free reed (accordion, harmonica). **breath** is the breath envelope from 0 to 1, and **pressure** sets how hard it blows within the range where the instrument speaks. **noise** adds breath turbulence and **embouchure** changes the reed stiffness or jet offset. **musette** detunes two extra free reeds in cents. It uses two of the four delay lines. |
| Physical Brass | The Physical instrument's Brass model: a lip valve driving a bore with a flared bell. **breath** is the breath envelope from 0 to 1 and **pressure** sets how hard it blows. **lip** tunes the lips against the bore resonance, **bell** sets how bright the bell radiates, and **attack** and **velocity** shape the onset boost that makes the note speak. Loud notes steepen into the brassy, buzzy tone. It uses two of the four delay lines. |
| Physical Piano | The Physical instrument's Stiff String model: two strings per note, detuned by **detune** cents, struck by a felt hammer on each rising gate. Raw **velocity** sets the hammer speed, so harder notes are louder and brighter. **hardness** is the felt, **position** the strike point along the string, **inharmonicity** stretches the upper partials like a stiff string, **damping** dulls them over time, **decay** is the ring of a middle note and **release** the damper after the gate falls. It uses three of the four delay lines. |
| Physical Mesh | The Physical instrument's Mesh model: a 2D membrane of **size** x **size** cells, a **Circular drum** or a **Square plate**, struck by a mallet on each rising gate. The pitch tunes its lowest mode and the other, inharmonic modes follow from the shape. **strikeX** and **strikeY** place the strike, **hardness** (and raw **velocity**) make the mallet smaller and brighter, **highDamping** shortens the upper modes, **decay** sets the ring and **release** the damping after the gate falls. It uses one delay line for its three time steps. |
| Physical Organ | The Physical instrument's tonewheel organ: nine drawbars (**d16** to **d1**, 0 to 8, 3 dB a step) of sine partials, those above the top tonewheel folding down an octave. **percussion** adds a decaying second or third harmonic (**percDecay**, **percLevel**) that only strikes when no earlier key is still down, and **click** a short noise burst at each key. It has no envelope: patch an ADSR and a VCA after it. |
| Modal Resonator | Uses a built-in material or a custom table of up to eight resonant modes. A rising **gate** strikes it and **in** adds continuous excitation. |
| Patch effects | **Echo**, **Chorus** and **Reverb** run once for the whole patch, after the voices. Each input adds up that signal from every voice, so a released note's tail keeps ringing through them after the voice ends. Their outputs can feed only other patch effects and **FX output**, which adds them to the final mix; keep an **Audio output** for the dry sound or use the effect's **mix**. An unpatched **right** input copies **left**. A patch can use four of Echo, Chorus, Guitar Amp and Reverb. Their knobs are set in the rack or patch, not by cables. |
| Echo | A stereo delay of 1–2000 ms. With **sync** set to **Host**, **beats** picks a note value at the DAW's (or Piano Roll's) tempo, including dotted and triplet values from 1/32 to dotted 1/2. **Feedback** sets the repeats, **damping** darkens each repeat and **pingPong** bounces repeats between the channels. |
| Chorus | Two delay lines of **delay** ms swept by **depth** ms at **rate** Hz; **spread** offsets the right channel's sweep by up to a quarter cycle. |
| Guitar Amp | The Physical instrument's guitar amp as a patch effect: a pre high-pass, **Clean**, **Crunch**, **Overdrive** or two-stage **Distortion** clipping driven by **gain**, then a speaker cabinet whose brightness follows **tone**, at **level** dB. It counts as one of the four patch effects. |
| Soundboard | A patch effect: the piano soundboard of the Physical instrument, 16 resonances fed by the sum of the voices and leaning alternately left and right. **body** blends from the dry strings to the board. |
| Sympathetic Strings | A patch effect: the Physical instrument's sympathetic strings, 24 resonators a semitone apart from **root** (a MIDI note) that ring on with the sum of the voices for about **decay** seconds, alternately panned left and right, added at **mix**. |
| Rotary Speaker | A patch effect: the Physical instrument's rotary speaker. An 800 Hz crossover sends the treble through a spinning horn (Doppler and level) and the bass through a drum; **speed** Slow or Fast, and the mod wheel past half on any channel switches Slow to Fast. The rotors speed up and slow down gradually. **mix** blends it with the dry sound. |
| Reverb | A Freeverb-style room: **size** sets the decay, **damping** the high-frequency loss, and **width** the stereo spread of the reverb. **Mix** blends it with the input. |
| Delay lines | Strings and comb filters share four preallocated lines per voice, so a patch can use four of them. A released voice stays alive while an ADSR, function generator, string or modal resonator is still active, up to the voice tail limit. |

### Patch effect presets

**Echo Hall Pluck** sends a plucked string to a host-synced dotted-eighth ping-pong Echo and a hall Reverb while the dry string goes to Audio output.

### Wavetable presets

Try **Vowel Halo** for an LFO sweep through the Vocal Formants bank or **Digital Pulse** for a short envelope sweep through the Digital bank. Both demonstrate stereo unison.

### Custom resonance tables

On a Modal Resonator, choose **Edit resonance**. The table starts with a copy of the selected material; **Copy selected material** restores that starting point in the editor. Add or remove modes and set each mode's frequency ratio, gain and decay multiplier. A ratio of 2 sounds an octave above the pitch input. Gain 0 silences a mode. A decay multiplier of 1 keeps the decay set by the module's Decay, Release and Brightness controls. Modes above 45% of the sample rate are skipped.

Choose **Apply table** to use the draft, or **Use built-in material** to return to the original material knob and its CV input. Applying or removing a table is a structural edit and ends current voices. Tables are part of the patch JSON and CLAP project state. To reuse a table in another rack, select its module and use **Save selection**. **Twin Glass** demonstrates two close frequencies that beat against each other.

### Percussion layers

Drum Voice also offers **Rimshot**, **Cowbell**, **Shaker**, **Crash**, and **Ride**. The **Cowbell and Shaker** and **Rim and Cymbal** patches trigger two Drum Voice modules from the same note and route them through a mixer. Set their **Tune**, **Tone**, or **Decay** individually.

**808-ish Groove** uses the source kit's tuning, decay, and tone for the kick, snare, and closed hat. The kick's **kickSweep** is its initial pitch rise in octaves and **kickSweepTime** is the sweep time constant in seconds. A value of −1 keeps the original Modular kick sweep. Snare noise balance, hat metal mix, and the rest of the original kit are outside this approximation.

**Wine Glass (Modular)** and **Kalimba (Modular)** take their material, damping, hardness, and strike position from Physical. **Hardness** below 1 makes the strike a finite contact pulse; the **velocity** input controls the hit. **Strike Position** shifts which modes are excited, and 0 keeps the unweighted Modular response. The original Physical room, stereo, and release behavior can still differ.

### Synth presets

`src/presets/modular.js` rebuilds supported Synth presets from Modular modules. It maps classic oscillators, wavetable banks and position sweeps, per-copy unison, sync and PM, filter settings, velocity, and supported LFO and envelope controls. It also maps the Synth's effects, Mod Env, LFO 2 and mod matrix:

- **Chorus** and **Delay** become patch **Chorus** and **Echo** in the Synth's order. A tempo-synced delay uses Echo **sync** = **Host** with the same note value. The delay's high cut sets Echo **damping**.
- **Reverb** becomes a patch **Reverb** at mix 1 with its own FX output beside the dry FX output. The converter picks the Reverb **size** that reaches −60 dB in the Synth's decay time. The wet level is reduced by a table measured with white noise, because Modular's Freeverb-style reverb is louder than the Synth's reverb at the same mix.
- **Mod Env** is a third ADSR. **LFO 2** is a second LFO or Sample & Hold.
- Mod matrix slots become CV Scale modules summed into the destination. The supported sources are LFO 1, LFO 2, Mod Env, Velocity, Key Track, Mod Wheel, Pressure and Random (a Sample & Hold triggered by the gate). The supported destinations are Pitch, Osc2 Pitch, Filter Cutoff, FM Index, Pan, LFO 1 Rate, Noise Level and the wavetable positions. **LFO 1 Rate** is linear between source values 0 and 1, where the Synth's rate is exponential.

The converter rejects unsupported features such as the arpeggiator, tempo-synced LFOs, the Sidechain source, and the Resonance, Pulse Width, Amp and LFO 2 Rate destinations. Ports restart the LFOs per voice, and use fixed oscillator start phases. Apart from Pan slots and effects, ports are mono. Performance controls such as the modulation wheel and pitch-bend range are outside the conversion; patch them from the MIDI / Note outputs.

### Physical presets

`modularFromPhysical` in the same file rebuilds Physical presets whose model has a Modular module: **Modal** presets on the Modal Resonator, **String** presets on Physical String, **Bowed** presets on Physical Bowed String with an ADSR as the bow envelope, **Wind** presets on Physical Wind with an ADSR as the breath envelope, **Brass** presets on Physical Brass with an ADSR as the breath envelope, **Stiff String** (piano) presets on Physical Piano with a Soundboard patch effect, **Mesh** presets on Physical Mesh, and **Organ** presets on Physical Organ with a Rotary Speaker patch effect. Aftertouch settings (Pressure to Bow, Brightness and Vibrato) are left out; patch the MIDI / Note **pressure** output for them. Each port is named after its preset with **(Modular)** added. Velocity is scaled by the preset's **Velocity Amount**. **Stereo Width** pans each note by its pitch with a Pan / Spread module, as Physical does. The **Room** becomes a Reverb send at mix 1 into its own FX output. Its size is chosen from the room decay, and its level comes from a table measured against Physical. A guitar amp becomes a **Guitar Amp** patch effect. The voices then play at Physical's internal level and the output gain moves to the FX outputs, because the amp clips the sum of the voices. Vibrato is an LFO added to the pitch, restarted with each voice. Sawari, plectrum and body settings go to Physical String, and sympathetic strings become a Sympathetic Strings patch effect.

Run `node scripts/modular-preset-audit.js` for the Synth conversion inventory and first blockers, and for render measurements of selected Synth, Physical, and Drums examples. These measurements compare levels over time; they do not establish timbre equivalence.

## CLAP

Build with `npm ci && npm run clap:build`, then install with `npm run install:clap`. Release archives contain one `AmiSynth.clap` with Synth, Physical, Drums, Tuning and Modular. The installer renames a former standalone `AmiSynthModular.clap` in the destination to an unused `.disabled` backup. Modular retains its plugin ID and JSON state format; projects that stored the old file path may need their instrument replaced with Modular from `AmiSynth.clap`.

Add **AmiSynth Modular** to an instrument track. The plug-in accepts CLAP notes and MIDI and exposes **Macro 1–8** with stable IDs 0–7.

MIDI CCs, pitch bend and channel or polyphonic aftertouch in the track's MIDI items reach the MIDI / Note outputs, so REAPER's CC lanes can move any patched parameter. CLAP note expressions also apply per note: **tuning** adds semitones to **pitch**, **pressure** sets **pressure**, **brightness** replaces CC74, and **expression** replaces CC11 on the **cc** output. The factory patch **Expressive Lead** uses the modulation wheel for vibrato, and aftertouch and CC74 for the filter. Open a factory preset using a DAW that supports CLAP preset discovery. The CLAP preset-load file interface also accepts JSON exported by the Web rack. DAW support for selecting custom preset files varies.

On Windows, open the plugin's editor to use the same node rack as the Web app: add, duplicate, move or remove modules; connect or disconnect cables; and turn each module's knobs. **Save patch** and **Open patch** exchange the same JSON files as the Web rack. Changes apply to the native instrument and mark the DAW project as changed. The complete patch is stored in the DAW project. Knob and layout changes preserve running voices; structural changes end them at the next audio block. Macros remain the eight DAW automation parameters; the other module knobs are edited in the rack. Cable activity visualization is currently available in the Web app only.

The Windows editor requires the Microsoft Edge WebView2 Runtime. Its HTML, scripts and styles are embedded in `AmiSynth.clap`; no web server or internet connection is required to edit a patch. Embedded and floating CLAP windows are supported. macOS and Linux currently use the host's generic parameter controls and JSON patch loading.

The window is created immediately and its WebView2 initialization is scheduled asynchronously after the host's GUI callback returns. This avoids nested host message dispatch during `clap.gui.create`, which can otherwise crash hosts with a borrowed UI context, such as GPUI-based applications. Closing the editor before initialization completes cancels its pending callbacks through weak references.

Developer checks: `tests/modular-parity.test.js` renders every module and factory patch through the Web engine and the native engine (`modular_render`) and requires the same samples. `modular_edit_check` tests the native edit bridge. On Windows, `modular_edit_check --gui-smoke <preview.png>` also opens a temporary editor, exercises adding/removing nodes, connecting cables and changing knobs, and renders a preview image.

`clap.state` stores the complete versioned JSON patch and current macro values. Existing Web patches with no version field are treated as version 1. Invalid or oversized loads leave the current patch intact. Patch compilation runs on the main thread, then publishes the result for the next audio block. Note events and macro automation apply at their sample offsets. The processing callback uses preallocated voice and graph storage.

## Current limits

The factory rhythm patches use Gated Clock and a single legato voice. Hold any key to play **Patch Beat**, **Choked Hats**, **Clap and Toms**, **Clockwork Plucks**, or **Four Lane Beat**. Overlapping notes keep the pattern running. Releasing all keys stops new hits and lets existing tails decay. The next key starts from step 1. In **Four Lane Beat**, try clicking the Beat Grid cells to change which pulses reach the kick, snare, closed hat and open hat.

Clock is available when building a free-running rack. In the Web app, **Host** sync follows the Piano Roll's tempo and playback. Patches that contain Clock and omit MIDI / Note run as a single voice without MIDI. With MIDI / Note present, playing a note starts a voice and its sequencer, while all voices read the same clock phase.

Modular uses 12-TET and per-voice audio-rate signals. The Web DSP and native DSP share module definitions and factory patch data and have separate sample loops. Hosting external CLAP modules is a follow-up to the built-in engine.
