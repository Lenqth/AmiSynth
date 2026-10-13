-- Run from repository root: lua tests/reaper-toolkit.test.lua (Lua 5.3+).
-- No running REAPER project is touched: these are host-contract tests.
local catalog = dofile('jsfx/generated/catalog.lua')
local inst = catalog.instruments.synth
local track, guid, values, ext, undo, writes = {}, 'synth-guid', {}, {}, 0, 0
local fail_write, bad_readback = false, false
for _, d in ipairs(inst.parameters) do values[d.paramIndex] = d.default end
reaper = {
  ValidatePtr2 = function(_, tr) return tr == track end,
  TrackFX_GetFXName = function() return true, 'JS: AmiSynth Synth (polyphonic subtractive, microtonal)' end,
  TrackFX_GetFXGUID = function() return guid end,
  TrackFX_GetNumParams = function() return #inst.parameters end,
  TrackFX_GetParamName = function(_, _, index)
    local d = inst.parameters[index + 1]
    return true, d.name .. ((d.unit ~= '' and not d.options) and (' [' .. d.unit .. ']') or '')
  end,
  TrackFX_GetParam = function(_, _, index)
    local d = inst.parameters[index + 1]
    return values[index], d.min, d.max
  end,
  TrackFX_SetParam = function(_, _, index, value)
    writes = writes + 1
    if fail_write and writes == 2 then return false end
    values[index] = bad_readback and writes == 1 and 20 or value
    return true
  end,
  Undo_BeginBlock2 = function() undo = undo + 1 end,
  Undo_EndBlock2 = function() undo = undo - 1 end,
  GetExtState = function(_, key) return ext[key] or '' end,
  SetExtState = function(_, key, text) ext[key] = text end,
}
local api = dofile('jsfx/reaper/toolkit.lua')
local binding = api.bind(track, 0, 'synth')
local function rejects(fn) assert(not pcall(fn), 'Expected rejection') end
api.apply(binding, { filter_cutoff_hz = 650 })
assert(api.read(binding).filter_cutoff_hz == 650 and undo == 0)
for _, p in ipairs(inst.presets) do
  api.apply(binding, { tuning_ref_hz = 442, tuning_divisions = 19 })
  api.preset(binding, p.name)
  local got = api.read(binding)
  assert(got.tuning_ref_hz == 442 and got.tuning_divisions == 19)
end
api.macro(binding, 'Width', 1)
assert(api.read(binding).unison_voices == 5)
api.macro(binding, 'Pump', 0.7)
assert(api.read(binding).lfo_amp == 0.7 and api.read(binding).lfo_sync == 7)
rejects(function() api.macro(binding, 'Pump', -1) end)
rejects(function() api.apply(binding, { filter_cutoff_hz = 0.03 }) end)
rejects(function() api.apply(binding, { voice_mode = 0.5 }) end)
rejects(function() api.apply(binding, { typo = 1 }) end)
assert(undo == 0)
local before = api.read(binding)
writes = 0; fail_write = true
rejects(function() api.apply(binding, { filter_cutoff_hz = 1000, amp_attack_ms = 20 }) end)
fail_write = false
local after = api.read(binding)
for id, value in pairs(before) do assert(after[id] == value, 'Failed transaction did not restore ' .. id) end
assert(undo == 0)
writes = 0; bad_readback = true
rejects(function() api.apply(binding, { filter_cutoff_hz = 1000 }) end)
bad_readback = false
assert(api.read(binding).filter_cutoff_hz == before.filter_cutoff_hz and undo == 0)
api.save(binding, 'My Bass')
api.apply(binding, { filter_cutoff_hz = 650 })
api.save(binding, 'My Bass')
local users = api.users('synth')
assert(#users == 1 and users[1].params.filter_cutoff_hz == 650 and users[1].params.tuning_ref_hz == nil)
rejects(function() api.save(binding, 'Bad|menu') end)
guid = 'different-fx'
rejects(function() api.apply(binding, { filter_cutoff_hz = 700 }) end)
guid = binding.guid
local get_name = reaper.TrackFX_GetParamName
reaper.TrackFX_GetParamName = function() return true, 'Wrong layout' end
rejects(function() api.bind(track, 0, 'synth') end)
reaper.TrackFX_GetParamName = get_name
assert(loadfile('jsfx/reaper/AmiSynth Companion.lua'))
assert(loadfile('jsfx/reaper/AmiSynth Drums - Create routed tracks.lua'))
print('REAPER toolkit: preset/tuning preservation, macros, rejection, rollback, persistence and Lua syntax passed')

-- Routing action: the instrument has 10 channels, four stereo audio sends,
-- no duplicate master output, and a failed setup removes only new tracks.
local existing, tracks, selected, pins = {}, {}, nil, {}
local fail_fx = false
local drums = catalog.instruments.drums
tracks[1] = existing
inst = drums
values = {}; for _, d in ipairs(inst.parameters) do values[d.paramIndex] = d.default end
reaper.ValidatePtr2 = function(_, tr) for _, t in ipairs(tracks) do if tr == t then return true end end; return false end
reaper.TrackFX_GetFXName = function() return true, 'JS: AmiSynth Drums' end
reaper.CountTracks = function() return #tracks end
reaper.InsertTrackAtIndex = function(at) table.insert(tracks, at + 1, { sends = {} }) end
reaper.GetTrack = function(_, at) return tracks[at + 1] end
reaper.GetSetMediaTrackInfo_String = function(tr, key, value) tr[key] = value; return true end
reaper.SetMediaTrackInfo_Value = function(tr, key, value) tr[key] = value; return true end
reaper.TrackFX_AddByName = function() return fail_fx and -1 or 0 end
reaper.TrackFX_SetPinMappings = function(_, _, output, pin, low, high) pins[pin] = { output, low, high }; return true end
reaper.CreateTrackSend = function(source, dest) source.sends[#source.sends + 1] = { dest = dest }; return #source.sends - 1 end
reaper.SetTrackSendInfo_Value = function(source, _, send, key, value) source.sends[send + 1][key] = value; return true end
reaper.SetOnlyTrackSelected = function(tr) selected = tr end
reaper.DeleteTrack = function(tr) for i, t in ipairs(tracks) do if t == tr then table.remove(tracks, i); return end end end
reaper.TrackList_AdjustWindows = function() end
reaper.UpdateArrange = function() end
reaper.MB = function() end
dofile('jsfx/reaper/AmiSynth Drums - Create routed tracks.lua')
assert(#tracks == 6 and tracks[1] == existing and selected == tracks[2] and undo == 0)
local source = tracks[2]
assert(source.I_NCHAN == 10 and source.B_MAINSEND == 0 and #source.sends == 4)
for i, send in ipairs(source.sends) do
  assert(send.dest == tracks[i + 2] and send.I_SRCCHAN == i * 2 and send.I_DSTCHAN == 0)
  assert(send.I_MIDIFLAGS == 31 and send.I_SENDMODE == 0 and send.D_VOL == 1)
end
for pin = 0, 9 do assert(pins[pin][1] == 1 and pins[pin][2] == 1 << pin and pins[pin][3] == 0) end
for _, id in ipairs({ 'kick_bus_in_main', 'snare_bus_in_main', 'hats_bus_in_main', 'perc_bus_in_main' }) do
  for _, d in ipairs(inst.parameters) do if d.id == id then assert(values[d.paramIndex] == 0) end end
end
fail_fx = true
dofile('jsfx/reaper/AmiSynth Drums - Create routed tracks.lua')
assert(#tracks == 6 and tracks[1] == existing and tracks[2] == source and undo == 0)
print('REAPER drum routing: channels, pins, all four sends, main exclusion and failure rollback passed')

-- Read-only MCP entry point must publish useful text with no project mutation.
local count = #tracks
dofile('jsfx/reaper/AmiSynth - MCP guide.lua')
assert(#tracks == count and undo == 0)
assert(ext.last_result:find('Headless wrapper example', 1, true))
assert(ext.last_result:find('script_list', 1, true))
print('REAPER MCP guide: read-only action publishes the installed guide text')
