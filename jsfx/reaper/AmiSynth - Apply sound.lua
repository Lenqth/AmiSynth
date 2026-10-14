-- @description AmiSynth Apply sound: headless MCP action; applies a JSON param diff (real units) to an AmiSynth Synth/Physical/Drums on a track, inserting the JSFX if missing; one Undo step; returns a JSON summary.
-- @about Before script_run, put a JSON request in ExtState AmiSynthMCP/apply_sound (consumed when read; fallback file Scripts/AmiSynth/apply_sound.json, not deleted). Request: {"track":"selected"|"<track name>","instrument":"Synth"|"Physical"|"Drums","base":"current"(default)|"default"|"<built-in preset>","params":{"filter_cutoff_hz":650,...},"fx":optional zero-based index,"insert":true,"dry_run":false}. params is the web "JSON コピー" diff (id -> real Hz/ms/dB value, enum index or label); the whole web JSON object is accepted and its type selects the instrument. Unknown, tuning_* and non-numeric ids are rejected, out-of-range values are clamped; all are listed with reasons. Writes verify readback and roll back on failure (an inserted JSFX is removed). Result in reaper_mcp_script_result/last_result: "ok: {applied, clamped, rejected, changed, sound, meter, ...}" or "error: message". Modifies the project; no dialogs. Pair with AmiSynth - Read sound.lua.
local dir = debug.getinfo(1, 'S').source:sub(2):match('^(.*[/\\])')
local ok, api = pcall(dofile, dir .. 'toolkit.lua')
if not ok then
  reaper.SetExtState('reaper_mcp_script_result', 'last_result', 'error: ' .. tostring(api), false)
  return
end
api.run_action('apply_sound', api.apply_sound, dir, true)
