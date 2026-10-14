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

-- MCP sound design: Apply sound / Read sound actions with a multi-track, multi-FX mock.
local function project(spec)
  local p = { tracks = {}, selected = nil }
  for _, t in ipairs(spec) do
    local track = { name = t.name, fx = {} }
    for _, kind in ipairs(t.fx or {}) do
      local fx = { kind = kind, guid = kind .. '-' .. t.name .. '-' .. #track.fx, values = {} }
      for _, d in ipairs(catalog.instruments[kind].parameters) do fx.values[d.paramIndex] = d.default end
      track.fx[#track.fx + 1] = fx
    end
    p.tracks[#p.tracks + 1] = track
  end
  return p
end
local proj, deleted, add_fails, set_fails
local titles = { synth = 'Synth', phys = 'Physical', drums = 'Drums' }
local function fx_of(tr, i) return tr.fx[i + 1] end
reaper.ValidatePtr2 = function(_, tr) for _, t in ipairs(proj.tracks) do if t == tr then return true end end; return false end
reaper.CountTracks = function() return #proj.tracks end
reaper.GetTrack = function(_, i) return proj.tracks[i + 1] end
reaper.GetSelectedTrack = function() return proj.selected end
reaper.GetSetMediaTrackInfo_String = function(tr, key) assert(key == 'P_NAME'); return true, tr.name end
reaper.TrackFX_GetCount = function(tr) return #tr.fx end
reaper.TrackFX_GetFXName = function(tr, i) local f = fx_of(tr, i); return f ~= nil, f and ('JS: AmiSynth ' .. titles[f.kind] .. ' (x)') or '' end
reaper.TrackFX_GetFXGUID = function(tr, i) local f = fx_of(tr, i); return f and f.guid end
reaper.TrackFX_GetNumParams = function(tr, i) return #catalog.instruments[fx_of(tr, i).kind].parameters end
reaper.TrackFX_GetParamName = function(tr, i, index)
  local d = catalog.instruments[fx_of(tr, i).kind].parameters[index + 1]
  return true, d.name .. ((d.unit ~= '' and not d.options) and (' [' .. d.unit .. ']') or '')
end
reaper.TrackFX_GetParam = function(tr, i, index)
  local f = fx_of(tr, i); local d = catalog.instruments[f.kind].parameters[index + 1]
  return f.values[index], d.min, d.max
end
reaper.TrackFX_SetParam = function(tr, i, index, value)
  if set_fails then return false end
  fx_of(tr, i).values[index] = value; return true
end
reaper.TrackFX_AddByName = function(tr, name, _, mode)
  assert(mode == -1)
  if add_fails then return -1 end
  local kind = name == 'JS: AmiSynth/AmiSynth Synth.jsfx' and 'synth' or name == 'JS: AmiSynth/AmiSynth Physical.jsfx' and 'phys'
    or name == 'JS: AmiSynth/AmiSynth Drums.jsfx' and 'drums' or error('Unexpected FX name ' .. name)
  local fx = { kind = kind, guid = 'new-' .. kind, values = {} }
  for _, d in ipairs(catalog.instruments[kind].parameters) do fx.values[d.paramIndex] = d.default end
  tr.fx[#tr.fx + 1] = fx
  return #tr.fx - 1
end
reaper.TrackFX_Delete = function(tr, i) deleted = deleted + 1; table.remove(tr.fx, i + 1); return true end
reaper.DeleteExtState = function(section, key) assert(section == 'AmiSynthMCP'); ext[key] = nil end
reaper.Track_GetPeakInfo = function(_, ch) return ch == 0 and 0.5 or 0 end
reaper.GetPlayState = function() return 1 end
local undo_titles = {}
reaper.Undo_BeginBlock2 = function() undo = undo + 1 end
reaper.Undo_EndBlock2 = function(_, title) undo = undo - 1; undo_titles[#undo_titles + 1] = title end

local function values_of(f)
  local out = {}
  for _, d in ipairs(catalog.instruments[f.kind].parameters) do out[d.id] = f.values[d.paramIndex] end
  return out
end
local function run(script, request)
  ext.last_result = nil
  if request then ext[script == 'Apply' and 'apply_sound' or 'read_sound'] = request end
  dofile('jsfx/reaper/AmiSynth - ' .. script .. ' sound.lua')
  assert(undo == 0, 'Undo block left open')
  local text = assert(ext.last_result, 'No MCP result published')
  local status, body = text:match('^(%a+): (.*)$')
  if status == 'ok' then return api.json_decode(body) end
  assert(status == 'error', text)
  return nil, body
end

-- JSON round trip, including unicode, escapes and arrays.
local decoded = api.json_decode('{"a":[1,2.5,-3e2,true,false,null],"s":"x\\"\\n\\u00e9","o":{}}')
assert(decoded.a[2] == 2.5 and decoded.a[3] == -300 and decoded.a[4] == true and decoded.s == 'x"\né')
assert(api.json_encode({ b = 0.1, a = api.array(), c = { 1, 2 } }) == '{"a":[],"b":0.1,"c":[1,2]}')
assert(api.json_decode(api.json_encode({ v = 1 / 3 })).v == 1 / 3)
for _, bad in ipairs({ '{', '{"a":1,}', '[1 2]', '"\\x"', '01x', '{"a":1} x' }) do
  assert(not pcall(api.json_decode, bad), 'Accepted invalid JSON ' .. bad)
end

-- Apply to a named track; base preset + diff; clamp, round, enum label, reject unknown / tuning / non-number.
proj = project({ { name = 'Lead', fx = { 'synth' } }, { name = 'Bass', fx = { 'synth' } } })
proj.selected = proj.tracks[1]
deleted, undo_titles = 0, {}
local bass = proj.tracks[2].fx[1]
bass.values[0] = 19 -- tuning_divisions must survive
local preset = catalog.instruments.synth.presets[2]
local r = assert(run('Apply', api.json_encode({ track = 'bass', instrument = 'Synth', base = preset.name,
  params = { filter_cutoff_hz = 99999, voice_mode = 'Mono', unison_voices = 2.6, typo_hz = 3,
    tuning_ref_hz = 432, amp_attack_ms = 'fast', filter_resonance = 0.3 } })))
local got = values_of(bass)
assert(r.ok and r.track == 'Bass' and r.instrument == 'synth' and r.fx == 0 and r.inserted == false and r.base == preset.name)
assert(got.filter_cutoff_hz == 20000 and got.voice_mode == 1 and got.unison_voices == 3 and got.filter_resonance == 0.3)
assert(got.tuning_divisions == 19 and got.tuning_ref_hz == 440)
for id, v in pairs(preset.params) do
  if not ({ filter_cutoff_hz = 1, voice_mode = 1, unison_voices = 1, filter_resonance = 1 })[id] then
    assert(got[id] == v, 'Base preset not applied: ' .. id)
  end
end
assert(#r.clamped == 2 and r.clamped[1].id == 'filter_cutoff_hz' and r.clamped[1].applied == 20000)
assert(r.clamped[2].id == 'unison_voices' and r.clamped[2].applied == 3 and r.clamped[2].reason:find('integer'))
assert(#r.rejected == 3)
local reasons = {}
for _, x in ipairs(r.rejected) do reasons[x.id] = x.reason end
assert(reasons.typo_hz:find('unknown') and reasons.tuning_ref_hz:find('tuning') and reasons.amp_attack_ms:find('number'))
assert(r.applied.voice_mode == 1 and r.applied.typo_hz == nil)
assert(r.sound.type == 'amisynth-synth-preset' and r.sound.params.filter_cutoff_hz == 20000)
assert(r.meter.available and r.meter.playing and r.meter.peak_l_db == -6 and r.meter.peak_r_db == nil)
assert(r.request_source == 'ExtState AmiSynthMCP/apply_sound' and ext.apply_sound == nil, 'Request must be consumed')
assert(#undo_titles == 1 and undo_titles[1]:find('Bass'), 'Expected exactly one Undo block')
for _, v in pairs(values_of(proj.tracks[1].fx[1])) do assert(v ~= 20000) end -- other track untouched

-- Read returns exactly the non-default params (web diff), and Apply with base=default reproduces them.
local read = assert(run('Read', '{"track":"Bass"}'))
assert(read.type == 'amisynth-synth-preset' and read.name == 'Bass' and read.tuning.tuning_divisions == 19)
assert(read.params.tuning_divisions == nil and read.params.filter_cutoff_hz == 20000)
for _, d in ipairs(catalog.instruments.synth.parameters) do
  local nondefault = not d.id:match('^tuning_') and math.abs(got[d.id] - d.default) > 1e-9
  assert((read.params[d.id] ~= nil) == nondefault, 'Diff mismatch: ' .. d.id)
end
local lead = proj.tracks[1].fx[1]
read.track = 'Lead'; read.base = 'default'
r = assert(run('Apply', api.json_encode(read)))
assert(r.instrument == 'synth' and #r.rejected == 0 and #r.clamped == 0)
local lead_values = values_of(lead)
for _, d in ipairs(catalog.instruments.synth.parameters) do
  if not d.id:match('^tuning_') then assert(lead_values[d.id] == got[d.id], 'Round trip mismatch: ' .. d.id) end
end
assert(lead_values.tuning_divisions == 12)
-- Default base = current: a one-parameter tweak leaves everything else alone.
r = assert(run('Apply', '{"params":{"amp_release_ms":321}}'))
assert(r.track == 'Lead' and #r.changed == 1 and r.changed[1] == 'amp_release_ms')
assert(values_of(lead).amp_release_ms == 321 and values_of(lead).filter_cutoff_hz == 20000)

-- Missing instrument is inserted (Physical), unknown preset/kind or all-invalid params change nothing.
proj.tracks[3] = { name = 'Pluck', fx = {} }
r = assert(run('Apply', '{"track":"Pluck","instrument":"Physical","base":"default","params":{}}'))
assert(r.inserted == true and r.instrument == 'phys' and #proj.tracks[3].fx == 1)
local _, err = run('Apply', '{"track":"Pluck","instrument":"Physical","base":"No Such Preset"}')
assert(err:find('Unknown Physical preset'))
_, err = run('Apply', '{"track":"Pluck","instrument":"Organ"}')
assert(err:find('Unknown instrument'))
_, err = run('Apply', '{"track":"Pluck","params":{"nope":1}}')
assert(err:find('No usable parameters'))
_, err = run('Apply', '{"track":"Nowhere","instrument":"Synth"}')
assert(err:find('^No track named'), err)
_, err = run('Apply', '{"track":"Pluck","params":[1,2]}')
assert(err:find('params'))
_, err = run('Apply', '{"track":')
assert(err:find('Invalid JSON'))
_, err = run('Apply')
assert(err:find('No request found'))

-- Failed write rolls back and removes a freshly inserted JSFX; failed insert reports an error.
proj.tracks[4] = { name = 'Kit', fx = {} }
deleted = 0; set_fails = true
_, err = run('Apply', '{"track":"Kit","instrument":"Drums","params":{"drum_master_volume_db":-3}}')
set_fails = false
assert(err:find('Write failed') and deleted == 1 and #proj.tracks[4].fx == 0)
add_fails = true
_, err = run('Apply', '{"track":"Kit","instrument":"Drums"}')
add_fails = false
assert(err:find('install the JSFX'))

-- Dry run validates and previews without inserting or writing.
local before_n = #undo_titles
r = assert(run('Apply', '{"track":"Kit","instrument":"Drums","dry_run":true,"audition":true,"params":{"drum_master_volume_db":-80}}'))
assert(r.dry_run and r.inserted == 'would insert' and #proj.tracks[4].fx == 0 and #undo_titles == before_n)
assert(r.clamped[1].applied == -60 and r.sound.params.drum_master_volume_db == -60 and r.audition:find('skipped'))
_, err = run('Apply', '{"track":"Kit","instrument":"Drums","dry_run":true,"insert":false}')
assert(err:find('insert disabled') and #proj.tracks[4].fx == 0)

-- Ambiguity and selection rules; file fallback when no ExtState request is present.
proj.tracks[5] = { name = 'Stack', fx = {} }
for _, kind in ipairs({ 'synth', 'phys' }) do
  local fx = { kind = kind, guid = 'stack-' .. kind, values = {} }
  for _, d in ipairs(catalog.instruments[kind].parameters) do fx.values[d.paramIndex] = d.default end
  proj.tracks[5].fx[#proj.tracks[5].fx + 1] = fx
end
_, err = run('Read', '{"track":"Stack"}')
assert(err:find('several AmiSynth'))
read = assert(run('Read', '{"track":"Stack","instrument":"Physical"}'))
assert(read.fx == 1 and read.instrument == 'phys' and next(read.params) == nil)
read = assert(run('Read', '{"track":"Stack","fx":0}'))
assert(read.instrument == 'synth')
proj.selected = proj.tracks[3]
read = assert(run('Read'))
assert(read.track == 'Pluck' and read.request_source == 'none')
proj.selected = nil
_, err = run('Read')
assert(err:find('No track selected'))
local open = io.open
io.open = function(path, mode)
  if path:match('jsfx/reaper/%.%./read_sound%.json$') then
    return { read = function() return '{"track":"Kit","instrument":"Drums"}' end, close = function() end }
  end
  return open(path, mode)
end
_, err = run('Read')
io.open = open
assert(err:find('No AmiSynth Drums'))
print('REAPER MCP sound actions: apply/read round trip, clamping, rejection, insertion, rollback, dry run and request channels passed')
