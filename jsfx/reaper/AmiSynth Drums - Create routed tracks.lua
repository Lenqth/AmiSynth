-- @description AmiSynth Drums: create 5 tracks (one 10-channel instrument + four stereo audio buses); modifies the active project; returns the new track numbers.
-- @about Requires Effects/AmiSynth/AmiSynth Drums.jsfx, sibling toolkit.lua and ../generated/catalog.lua; no track selection needed. Adds MIDI instrument plus Kick/Snare/Hats/Perc buses after the last track, maps outputs 3-10 to bus channels 1/2, disables duplicate main output and MIDI sends. Success selects the new source; existing routing is preserved. One Undo step; failure removes newly created tracks (no dialog; the error also goes to the ReaScript console). Optional request in ExtState AmiSynthMCP/create_drum_tracks (or Scripts/AmiSynth/create_drum_tracks.json): {"select":false} keeps the selection. Result in reaper_mcp_script_result/last_result: "ok: {tracks:[{number (1-based), index (0-based), name, role, source_channels, guid}], instrument:{track, index, fx, name}, selected}" or "error: message". Save the 5 tracks as a template for reuse.
-- Creates a fresh instrument + four audio buses. Existing tracks are untouched.
-- Save these five tracks as a REAPER track template for subsequent sessions.
local dir = debug.getinfo(1, 'S').source:sub(2):match('^(.*[/\\])')
local ok, api = pcall(dofile, dir .. 'toolkit.lua')
if not ok then
  reaper.SetExtState('reaper_mcp_script_result', 'last_result', 'error: ' .. tostring(api), false)
  return
end
local text = api.run_action('create_drum_tracks', api.create_drum_tracks, dir, false)
if text:match('^error') and reaper.ShowConsoleMsg then reaper.ShowConsoleMsg('AmiSynth Drums: ' .. text .. '\n') end
