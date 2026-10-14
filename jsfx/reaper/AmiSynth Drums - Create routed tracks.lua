-- @description AmiSynth Drums: create 5 tracks (one 10-channel instrument + four stereo audio buses); modifies the active project.
-- @about Requires Effects/AmiSynth/AmiSynth Drums.jsfx, sibling toolkit.lua and ../generated/catalog.lua; no track selection needed. Adds MIDI instrument plus Kick/Snare/Hats/Perc buses, maps outputs 3-10 to bus channels 1/2, disables duplicate main output and MIDI sends. Success selects the new source; existing routing is preserved. Undo available; failure removes newly created tracks and shows a dialog. No MCP completion result is published: script_run result_found=false does not establish failure or success; verify the new tracks/routing. Save the 5 tracks as a template for reuse.
-- Creates a fresh instrument + four audio buses. Existing tracks are untouched.
-- Save these five tracks as a REAPER track template for subsequent sessions.
local dir = debug.getinfo(1, 'S').source:sub(2):match('^(.*[/\\])')
local api = dofile(dir .. 'toolkit.lua')
local created = {}
reaper.Undo_BeginBlock2(0)
local ok, err = pcall(function()
  local at = reaper.CountTracks(0)
  local names = { 'AmiSynth Drums - MIDI', 'Kick', 'Snare - Clap - Rim', 'Hats - Cymbals', 'Toms - Percussion' }
  for i, name in ipairs(names) do
    reaper.InsertTrackAtIndex(at + i - 1, true)
    local track = reaper.GetTrack(0, at + i - 1)
    created[#created + 1] = track
    reaper.GetSetMediaTrackInfo_String(track, 'P_NAME', name, true)
  end
  local source = created[1]
  reaper.SetMediaTrackInfo_Value(source, 'I_NCHAN', 10)
  local fx = reaper.TrackFX_AddByName(source, 'JS: AmiSynth/AmiSynth Drums.jsfx', false, -1)
  assert(fx >= 0, 'Install the JSFX in Effects/AmiSynth first')
  -- Explicit identity mapping: output pins 1..10 go to track channels 1..10.
  for pin = 0, 9 do assert(reaper.TrackFX_SetPinMappings(source, fx, 1, pin, 1 << pin, 0), 'Pin mapping failed') end
  local binding = api.bind(source, fx, 'drums')
  api.apply(binding, { kick_bus_in_main = 0, snare_bus_in_main = 0, hats_bus_in_main = 0, perc_bus_in_main = 0 }, false)
  reaper.SetMediaTrackInfo_Value(source, 'B_MAINSEND', 0)
  for i = 1, 4 do
    local send = reaper.CreateTrackSend(source, created[i + 1])
    assert(send >= 0, 'Could not create audio bus')
    reaper.SetTrackSendInfo_Value(source, 0, send, 'I_SRCCHAN', i * 2)
    reaper.SetTrackSendInfo_Value(source, 0, send, 'I_DSTCHAN', 0)
    reaper.SetTrackSendInfo_Value(source, 0, send, 'I_MIDIFLAGS', 31) -- no MIDI on audio buses
    reaper.SetTrackSendInfo_Value(source, 0, send, 'I_SENDMODE', 0) -- post fader
    reaper.SetTrackSendInfo_Value(source, 0, send, 'D_VOL', 1)
  end
  -- Only the freshly created instrument becomes selected.
  reaper.SetOnlyTrackSelected(source)
end)
if not ok then
  for i = #created, 1, -1 do reaper.DeleteTrack(created[i]) end
end
reaper.TrackList_AdjustWindows(false)
reaper.UpdateArrange()
reaper.Undo_EndBlock2(0, 'AmiSynth Drums: create four routed audio buses', -1)
if not ok then reaper.MB(tostring(err), 'AmiSynth', 0) end
