# AmiSynth ReaScripts / MCP guide

Install this whole `reaper/` directory as `REAPER resource path/Scripts/AmiSynth/reaper/`, with `generated/catalog.lua` in `Scripts/AmiSynth/generated/`. Keep these sibling directories together. The resource path is available from REAPER Options → Show REAPER resource path; portable installations may use a different location.

From the repository, copy the required files automatically:

```powershell
# Inspect destinations first; replace this example with the actual REAPER resource path.
npm run install:reaper -- --resource "C:/Users/your-name/AppData/Roaming/REAPER" --dry-run
npm run install:reaper -- --resource "C:/Users/your-name/AppData/Roaming/REAPER"
```

The installer updates only bundled AmiSynth JSFX, Lua scripts, catalog files and this guide. It does not register actions, delete other files, touch REAPER projects or copy the production report. It overwrites the named bundled files when updating; keep custom wrappers under a different filename.

## Choose the right entry point

| Script | Purpose / prerequisites | Project changes | MCP result |
| --- | --- | --- | --- |
| `AmiSynth - MCP guide.lua` | Read this guide; no selection required | None | Guide text in `reaper_mcp_script_result/last_result` |
| `AmiSynth - Read sound.lua` | Read the current sound of a track's Synth/Physical/Drums as a JSON diff; optional request | None | `ok: {type, name, params, tuning, ...}` or `error: ...` |
| `AmiSynth - Apply sound.lua` | Apply a JSON diff (real units) to a track; inserts the JSFX if missing; request required | Changes parameters (may add one FX); one Undo step | `ok: {applied, clamped, rejected, changed, sound, meter}` or `error: ...` |
| `AmiSynth Companion.lua` | Interactive GUI; select a track containing an installed AmiSynth JSFX | User edits presets, macros or parameters; Undo available | No completion result; background GUI stays open |
| `AmiSynth Drums - Create routed tracks.lua` | Create an instrument and four buses; install JSFX first | Adds 5 tracks and routes outputs; Undo available | No completion result; query tracks/routing afterwards |
| `toolkit.lua` | Function library, loaded by `dofile`; requires sibling `../generated/catalog.lua` | Only when a caller invokes editing functions | None by itself; wrapper must publish a result |
| `../generated/catalog.lua` | Generated data library; also visible in script discovery | None; returns a Lua table | None; not an action |

Register interactive actions with Actions → New action → Load ReaScript. For the current REAPER MCP, `script_list(filter="AmiSynth")` discovers `.lua` / `.eel` files **only inside REAPER's Scripts directory**, reading the `@description` / `@about` headers. The filter matches paths, so keep “AmiSynth” in the directory or filename. Pass the relative path returned by `script_list` unchanged to `script_run`; do not assume a repository path is runnable.

Start with `AmiSynth - MCP guide.lua`. To design a sound, use **Read sound → edit the diff → Apply sound** (next section). It is read-only and returns instructions without requiring a GUI. Running Companion does not expose its buttons as MCP tools; running toolkit.lua does not apply a preset. `result_found=false` means no completion result was reported and does not prove failure.

## Design a sound in one round trip (Read sound / Apply sound)

`script_run` takes no arguments, so both actions read a JSON **request** placed beforehand:

1. ExtState section `AmiSynthMCP`, key `apply_sound` (or `read_sound`), non-persistent. It is **deleted when read**, so a request is used once. Use this when your MCP server can set ExtState (or run one line of Lua: `reaper.SetExtState('AmiSynthMCP', 'apply_sound', json, false)`).
2. Otherwise the file `Scripts/AmiSynth/apply_sound.json` (or `read_sound.json`), next to the `reaper/` directory. Files are **not** deleted; the result's `request_source` says which one was used, so overwrite or remove a stale file yourself.

Both publish one line to `reaper_mcp_script_result/last_result`: `ok: <JSON>` or `error: <message>`. On `error:` nothing was changed.

### Read sound

Request (all optional; with no request, the first selected track's only AmiSynth instrument is read):

```json
{ "track": "Bass", "instrument": "Synth" }
```

Result (`params` holds only values that differ from the defaults, in real units, exactly like the web **JSON コピー**):

```json
{"fx":0,"instrument":"synth","meter":{...},"name":"Bass","ok":true,
 "params":{"amp_release_ms":180,"filter_cutoff_hz":650,"voice_mode":1},
 "request_source":"ExtState AmiSynthMCP/read_sound","track":"Bass",
 "tuning":{"tuning_divisions":12,...},"type":"amisynth-synth-preset"}
```

The whole object can be pasted into the web **JSON 貼り付け**. Tuning is reported separately and never changed by Apply sound.

### Apply sound

```json
{
  "track": "Bass",
  "instrument": "Synth",
  "base": "Sub Bass",
  "params": { "filter_cutoff_hz": 650, "voice_mode": "Mono", "amp_release_ms": 180 }
}
```

- `track`: `"selected"` (default; first selected track) or an exact track name (case-insensitive if unique).
- `instrument`: `Synth`, `Physical` or `Drums` (also `synth`/`phys`/`drums` or a web `type` such as `amisynth-phys-preset`). If omitted, the track's only AmiSynth instrument is used. If the track has none, the JSFX `Effects/AmiSynth/AmiSynth <instrument>.jsfx` is inserted at the end of the chain (`"insert": false` forbids this). `fx` (zero-based) picks one instance when there are several.
- `base`: what unspecified parameters become. `"current"` (**default**: edit the current sound), `"default"` (all defaults: same meaning as the web paste, use it to reproduce a Read sound result exactly) or a built-in preset name from `generated/automation.json`.
- `params`: parameter id → real value (Hz/ms/dB/…), enum index or enum label. Out-of-range values are clamped and integer parameters rounded (`clamped`, with the range); unknown ids, `tuning_*`, file indices and non-numbers are skipped (`rejected`, with a reason). The rest is still applied. If every given id is rejected, nothing changes and an error is returned.
- `dry_run: true`: validate and preview the resulting `sound` without changing the project.
- `audition: true`: currently answered with `"audition": "skipped: ..."`. A one-shot ReaScript cannot play and measure audio before it returns; start playback yourself and look at the meter.

All writes (plus an inserted JSFX) form **one Undo step** named `AmiSynth MCP: apply sound (<track>)`. Each write is verified by readback; on failure the previous values are restored and an inserted JSFX is removed. Result:

```json
{"applied":{"amp_release_ms":180,"filter_cutoff_hz":650,"voice_mode":1},"base":"Sub Bass",
 "changed":["filter_cutoff_hz","voice_mode","amp_release_ms", ...],"clamped":[],"dry_run":false,
 "fx":0,"inserted":false,"instrument":"synth","meter":{...},"ok":true,"rejected":[],
 "sound":{"params":{...},"type":"amisynth-synth-preset"},"track":"Bass"}
```

`sound` is the resulting diff (same as a following Read sound). `meter` is REAPER's **track** meter at the moment of the call (`peak_l_db`/`peak_r_db`, absent at -inf, plus `playing`); it only shows something while the project is playing. The JSFX's own peak/RMS display is drawing state inside the plug-in and cannot be read from ReaScript.

Typical LLM loop: Read sound → change a few values → Apply sound with `"base": "current"` (or the full edited diff with `"base": "default"`) → ask the user to listen.

## Headless wrapper example

Save the following as `Scripts/AmiSynth/Apply Sub Bass.lua` (outside `reaper/`, so installer updates never overwrite it). This is an **example to customize**, not a bundled action. State the intended track/FX and requested change in its header. The selected track's first FX must be AmiSynth Synth, and FX indices are zero-based.

```lua
-- @description AmiSynth: apply Sub Bass to selected track's first FX; changes sound, preserves tuning, provides Undo.
-- @about Requires selected track with AmiSynth Synth at FX index 0 and Scripts/AmiSynth/reaper/toolkit.lua. Reports success/readback or error through reaper_mcp_script_result/last_result.
local ok, result = pcall(function()
  local ami = dofile(reaper.GetResourcePath() .. '/Scripts/AmiSynth/reaper/toolkit.lua')
  local track = assert(reaper.GetSelectedTrack(0, 0), 'Select an AmiSynth Synth track')
  local binding = ami.bind(track, 0, 'synth')
  local actual = ami.preset(binding, 'Sub Bass')
  return 'ok: Sub Bass applied and readback verified; filter_cutoff_hz=' .. actual.filter_cutoff_hz
end)
reaper.SetExtState('reaper_mcp_script_result', 'last_result',
  ok and result or ('error: ' .. tostring(result)), false)
```

Discover the wrapper with `script_list`, then execute its returned path with `script_run`. `result_found=true` only says a result was delivered: inspect the text for `ok:` or `error:`. Do not run project-changing actions without the user's authorization. No arbitrary arguments are accepted by `script_run`; customize the wrapper beforehand, or pass a request to Read sound / Apply sound as described above.

## Toolkit API and units

- `ami.bind(track, fx, kind)`: kind is `synth`, `phys`, `drums` or `tuning`; validates the FX identity, parameter order/ranges and stores the FX GUID. A moved/deleted FX requires rebinding.
- `ami.preset(binding, name)`: choose an exact built-in preset name from `generated/automation.json`; preserves current tuning. To apply a saved user preset, find it in `ami.users(kind)` and pass its `params` to `ami.apply`.
- `ami.macro(binding, name, amount)`: Synth only; Brightness / Punch / Width / Pump, amount **0..1** (the GUI uses 0..100). Pump replaces LFO waveform/sync with quarter-note Duck; not an audio sidechain detector.
- `ami.apply(binding, params)`: `{ filter_cutoff_hz = 650 }` means **650 Hz**, not a normalized value. Validate ranges/enum integers against the catalog. Uses TrackFX_SetParam, verifies readback, attempts rollback on failure and provides Undo. File selectors must be edited in the native JSFX UI.
- `ami.read(binding)`: returns actual values keyed by parameter id, including current tuning.
- `ami.save(binding, name)` / `ami.users(kind)`: persistent REAPER user presets; tuning is excluded. Saving the same user name overwrites it; built-in names and menu control characters are rejected.

`generated/automation.json` documents units, ranges, enum values, groups, presets, macros, one-based slider numbers and zero-based API indices. `TrackFX_SetParamNormalized` is a different API; the toolkit takes real values. MIDI CC values remain 0..127, with CC64 >=64 down / <=63 up. Physical Sustain Pedal supports Off / Auto / On; Auto applies to strings, piano and modal materials except Drum Membrane.
