-- @description AmiSynth Run: headless MCP action with arguments; runs one toolkit action (or a list) from a JSON request and returns a JSON result. May modify the project depending on the action.
-- @about Before script_run, put a JSON request in ExtState AmiSynthMCP/run (consumed), or project ExtState AmiSynthMCP/run (consumed), or a block in the project notes that starts with the line ```amisynth run and ends with ``` (left in place), or the file Scripts/AmiSynth/run.json (left in place). Request: {"action":"<name>", ...fields} or {"actions":[{...},{...}]} (in order; stops at the first error). Actions: help, list (tracks with AmiSynth FX), read_sound, apply_sound (as the dedicated scripts), get / set (every parameter in real units, Tuning JSFX included; read-only and file sliders are rejected), presets, preset, macro, save_preset, create_drum_tracks. Result in reaper_mcp_script_result/last_result: "ok: {action, ...}" or "error: message"; request_source says where the request came from. No dialogs.
local dir = debug.getinfo(1, 'S').source:sub(2):match('^(.*[/\\])')
local ok, api = pcall(dofile, dir .. 'toolkit.lua')
if not ok then
  reaper.SetExtState('reaper_mcp_script_result', 'last_result', 'error: ' .. tostring(api), false)
  return
end
api.run_action('run', api.run_request, dir, true)
