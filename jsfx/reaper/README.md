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
| `AmiSynth Companion.lua` | Interactive GUI; select a track containing an installed AmiSynth JSFX | User edits presets, macros or parameters; Undo available | No completion result; background GUI stays open |
| `AmiSynth Drums - Create routed tracks.lua` | Create an instrument and four buses; install JSFX first | Adds 5 tracks and routes outputs; Undo available | No completion result; query tracks/routing afterwards |
| `toolkit.lua` | Function library, loaded by `dofile`; requires sibling `../generated/catalog.lua` | Only when a caller invokes editing functions | None by itself; wrapper must publish a result |
| `../generated/catalog.lua` | Generated data library; also visible in script discovery | None; returns a Lua table | None; not an action |

Register interactive actions with Actions → New action → Load ReaScript. For the current REAPER MCP, `script_list(filter="AmiSynth")` discovers `.lua` / `.eel` files **only inside REAPER's Scripts directory**, reading the `@description` / `@about` headers. The filter matches paths, so keep “AmiSynth” in the directory or filename. Pass the relative path returned by `script_list` unchanged to `script_run`; do not assume a repository path is runnable.

Start with `AmiSynth - MCP guide.lua`. It is read-only and returns instructions without requiring a GUI. Running Companion does not expose its buttons as MCP tools; running toolkit.lua does not apply a preset. `result_found=false` means no completion result was reported and does not prove failure.

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

Discover the wrapper with `script_list`, then execute its returned path with `script_run`. `result_found=true` only says a result was delivered: inspect the text for `ok:` or `error:`. Do not run project-changing actions without the user's authorization. No arbitrary arguments are accepted by `script_run`; customize the wrapper beforehand or use another integration capable of executing Lua.

## Toolkit API and units

- `ami.bind(track, fx, kind)`: kind is `synth`, `phys`, `drums` or `tuning`; validates the FX identity, parameter order/ranges and stores the FX GUID. A moved/deleted FX requires rebinding.
- `ami.preset(binding, name)`: choose an exact built-in preset name from `generated/automation.json`; preserves current tuning. To apply a saved user preset, find it in `ami.users(kind)` and pass its `params` to `ami.apply`.
- `ami.macro(binding, name, amount)`: Synth only; Brightness / Punch / Width / Pump, amount **0..1** (the GUI uses 0..100). Pump replaces LFO waveform/sync with quarter-note Duck; not an audio sidechain detector.
- `ami.apply(binding, params)`: `{ filter_cutoff_hz = 650 }` means **650 Hz**, not a normalized value. Validate ranges/enum integers against the catalog. Uses TrackFX_SetParam, verifies readback, attempts rollback on failure and provides Undo. File selectors must be edited in the native JSFX UI.
- `ami.read(binding)`: returns actual values keyed by parameter id, including current tuning.
- `ami.save(binding, name)` / `ami.users(kind)`: persistent REAPER user presets; tuning is excluded. Saving the same user name overwrites it; built-in names and menu control characters are rejected.

`generated/automation.json` documents units, ranges, enum values, groups, presets, macros, one-based slider numbers and zero-based API indices. `TrackFX_SetParamNormalized` is a different API; the toolkit takes real values. MIDI CC values remain 0..127, with CC64 >=64 down / <=63 up. Physical Sustain Pedal supports Off / Auto / On; Auto applies to strings, piano and modal materials except Drum Membrane.
