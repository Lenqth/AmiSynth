-- Run from repository root: lua tests/reaper-modular.test.lua (Lua 5.3+).
-- A mock REAPER keeps AmiSynth Modular's state in a CLAP track chunk, as REAPER does.
local api
local track, guid = { name = 'Lead' }, '{8E1C3D0A-0000-4000-8000-0000000000AB}'
local fx_list, params, undo, set_chunks = {}, {}, 0, 0
local reject_next = false

local function chunk()
  local lines = { '<TRACK', 'NAME Lead', '<FXCHAIN', 'SHOW 0', 'LASTSEL 0', 'DOCKED 0' }
  for _, fx in ipairs(fx_list) do
    lines[#lines + 1] = 'BYPASS 0 0 0'
    lines[#lines + 1] = '<CLAP "CLAPi: AmiSynth Modular (Lenqth)" com.github.lenqth.amisynth.modular ""'
    lines[#lines + 1] = '  CFG 4 760 1 ""'
    lines[#lines + 1] = '  <IN_PINS'
    lines[#lines + 1] = '  >'
    lines[#lines + 1] = '  <STATE'
    local data = api.base64_encode(fx.state)
    for i = 1, #data, 100 do lines[#lines + 1] = '    ' .. data:sub(i, i + 99) end
    lines[#lines + 1] = '  >'
    lines[#lines + 1] = '>'
    lines[#lines + 1] = 'FLOATPOS 0 0 0 0'
    lines[#lines + 1] = 'FXID ' .. fx.guid
    lines[#lines + 1] = 'WAK 0 0'
  end
  lines[#lines + 1] = '>'
  lines[#lines + 1] = '>'
  return table.concat(lines, '\n')
end

reaper = {
  ValidatePtr2 = function(_, tr) return tr == track end,
  GetSelectedTrack = function() return track end,
  CountTracks = function() return 1 end,
  GetTrack = function() return track end,
  GetSetMediaTrackInfo_String = function() return true, track.name end,
  TrackFX_GetCount = function() return #fx_list end,
  TrackFX_GetFXName = function(_, fx) return fx_list[fx + 1] ~= nil, fx_list[fx + 1] and 'CLAPi: AmiSynth Modular (Lenqth)' or '' end,
  TrackFX_GetFXGUID = function(_, fx) return fx_list[fx + 1].guid end,
  TrackFX_AddByName = function(_, name)
    if not name:find('CLAPi:AmiSynth Modular', 1, true) then return -1 end
    fx_list[#fx_list + 1] = { guid = guid, state = '{"macros":[0,0,0,0,0,0,0,0],"nodes":[{"id":"note","type":"midi"},{"id":"out","type":"output"}],"cables":[]}' }
    return #fx_list - 1
  end,
  TrackFX_Delete = function(_, fx) table.remove(fx_list, fx + 1) end,
  TrackFX_GetParamName = function(_, _, i) return true, 'Macro ' .. (i + 1) end,
  TrackFX_GetParamNormalized = function(_, _, i) return params[i] or 0 end,
  TrackFX_SetParamNormalized = function(_, _, i, v) params[i] = v; return true end,
  GetTrackStateChunk = function() return true, chunk() end,
  SetTrackStateChunk = function(_, text)
    set_chunks = set_chunks + 1
    -- Re-read each FX's state like REAPER handing it to the plug-in; a rejected load keeps the old one.
    local found = {}
    for block, id in text:gmatch('<STATE\n(.-)\n%s*>.-FXID (%S+)') do found[id] = block end
    local kept = {}
    for _, fx in ipairs(fx_list) do
      if found[fx.guid] then
        kept[#kept + 1] = fx
        local state = api.base64_decode(found[fx.guid])
        if not reject_next then fx.state = state end
      end
    end
    fx_list = kept
    reject_next = false
    return true
  end,
  Undo_BeginBlock2 = function() undo = undo + 1 end,
  Undo_EndBlock2 = function() undo = undo - 1 end,
  GetExtState = function() return '' end,
  SetExtState = function() end,
}
api = dofile('jsfx/reaper/toolkit.lua')
local function rejects(fn, pattern)
  local ok, err = pcall(fn)
  assert(not ok, 'Expected rejection')
  if pattern then assert(tostring(err):find(pattern, 1, true), tostring(err)) end
end

for _, sample in ipairs({ '', 'f', 'fo', 'foo', 'foob', 'fooba', 'foobar', '{"a":[1,2]}\0\255' }) do
  assert(api.base64_decode(api.base64_encode(sample)) == sample)
end
assert(api.base64_encode('foobar') == 'Zm9vYmFy' and api.base64_encode('fo') == 'Zm8=')

-- Reading needs an instance; a preset inserts one and replaces its patch in one Undo step.
rejects(function() api.read_modular({}) end, 'No AmiSynth Modular')
local catalog = api.modular_catalog()
assert(#catalog.presets > 10 and catalog.types.midi and catalog.macros == 8)
local dry = api.apply_sound({ instrument = 'Modular', preset = 'Expressive Lead', dry_run = true })
assert(dry.dry_run and dry.would_insert and #fx_list == 0 and set_chunks == 0)
local applied = api.apply_sound({ instrument = 'Modular', preset = 'Expressive Lead', macros = { 0.25, [3] = 1 } })
assert(applied.inserted and applied.applied == 'Expressive Lead' and undo == 0)
assert(#applied.patch.nodes == #api.modular_preset('Expressive Lead').patch.nodes)
assert(applied.patch.macros[1] == 0.25 and applied.patch.macros[3] == 1)
local read = api.read_sound({})
assert(read.type == 'amisynth-modular-patch' and read.patch.nodes[1].type == 'midi')

-- A Web rack patch file round-trips; the state's own framing bytes are preserved.
fx_list[1].state = 'v1:' .. fx_list[1].state .. '\n'
local patch = { nodes = { { id = 'note', type = 'midi' }, { id = 'osc', type = 'vco', params = { wave = 2 } }, { id = 'out', type = 'output' } },
  cables = { { from = 'note', port = 'pitch', to = 'osc', input = 'pitch' }, { from = 'osc', port = 'out', to = 'out', input = 'audio' } } }
api.apply_modular({ patch = patch, macros = { ['Macro 2'] = 0.5 } })
assert(fx_list[1].state:sub(1, 3) == 'v1:' and fx_list[1].state:sub(-1) == '\n')
read = api.read_modular({})
assert(read.patch.nodes[2].params.wave == 2 and read.patch.macros[2] == 0.5)

-- Invalid requests change nothing; a patch the plug-in rejects restores the track.
local before = chunk()
rejects(function() api.apply_modular({ patch = { nodes = { { id = 'x', type = 'nope' } } } }) end, 'Unknown module type')
rejects(function() api.apply_modular({ preset = 'No Such Patch' }) end, 'Unknown Modular preset')
rejects(function() api.apply_modular({ macros = { 2 } }) end, '0..1')
rejects(function() api.apply_modular({ macros = { Nope = 1 } }) end, 'Unknown macro')
reject_next = true
rejects(function() api.apply_modular({ preset = 'Subtractive' }) end, 'did not accept')
assert(chunk() == before and undo == 0)

-- The generic Run actions list and use Modular.
local listed = api.run_request({ action = 'list' })
assert(listed.tracks[1].fx[1].kind == 'modular')
assert(#api.run_request({ action = 'modular_presets' }).presets == #catalog.presets)
assert(api.run_request({ action = 'modular_modules' }).types.vco.params.wave.choices[2] == 'Saw')
assert(api.run_request({ action = 'read_modular' }).patch.nodes[2].type == 'vco')
print('REAPER Modular actions: insert, presets, patches, macros, rejection and rollback passed')
