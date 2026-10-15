-- @description AmiSynth Read sound: read-only MCP action; returns the non-default parameters of a track's AmiSynth Synth/Physical/Drums as the web JSON diff (real units).
-- @about No project changes. Optional request in ExtState AmiSynthMCP/read_sound (consumed when read; or project ExtState AmiSynthMCP/read_sound, consumed; or a ```amisynth read_sound block in the project notes; fallback file Scripts/AmiSynth/read_sound.json): {"track":"selected"|"<track name>","instrument":"Synth"|"Physical"|"Drums","fx":zero-based index}; without one it reads the first selected track's only AmiSynth instrument. Result in reaper_mcp_script_result/last_result: "ok: {type:"amisynth-<kind>-preset", name, params:{id:value}, tuning, track, instrument, fx, meter}" or "error: message". The params object pastes into the web "JSON 貼り付け" and, sent back to AmiSynth - Apply sound.lua with "base":"default", reproduces the sound exactly. Tuning is reported separately and never changed by Apply sound.
local dir = debug.getinfo(1, 'S').source:sub(2):match('^(.*[/\\])')
local ok, api = pcall(dofile, dir .. 'toolkit.lua')
if not ok then
  reaper.SetExtState('reaper_mcp_script_result', 'last_result', 'error: ' .. tostring(api), false)
  return
end
api.run_action('read_sound', api.read_sound, dir, false)
