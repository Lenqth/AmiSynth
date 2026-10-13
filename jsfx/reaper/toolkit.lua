-- Shared by the UI and callable from a ReaScript/MCP Lua runner.
-- All writes use real units and verify the host's layout/range and readback.
local dir = debug.getinfo(1, 'S').source:sub(2):match('^(.*[/\\])')
local M = { catalog = dofile(dir .. '../generated/catalog.lua') }

function M.instrument(kind)
  return assert(M.catalog.instruments[kind], 'Unknown AmiSynth kind: ' .. tostring(kind))
end

function M.bind(track, fx, kind)
  assert(reaper.ValidatePtr2(0, track, 'MediaTrack*'), 'Track no longer exists')
  local inst = M.instrument(kind)
  local ok, name = reaper.TrackFX_GetFXName(track, fx, '')
  local titles = { synth = 'Synth', phys = 'Physical', drums = 'Drums', tuning = 'Tuning' }
  assert(ok and name:find('AmiSynth ' .. titles[kind], 1, true), 'Select the matching AmiSynth JSFX')
  assert(reaper.TrackFX_GetNumParams(track, fx) >= #inst.parameters, 'JSFX is older than the catalog')
  for _, d in ipairs(inst.parameters) do
    local valid, label = reaper.TrackFX_GetParamName(track, fx, d.paramIndex, '')
    local expected = d.name .. ((d.unit ~= '' and not d.options) and (' [' .. d.unit .. ']') or '')
    assert(valid and label == expected, 'Parameter layout mismatch: ' .. d.id)
    if not d.file then
      local _, lo, hi = reaper.TrackFX_GetParam(track, fx, d.paramIndex)
      assert(math.abs(lo - d.min) < 1e-6 and math.abs(hi - d.max) < 1e-6, 'Parameter range mismatch: ' .. d.id)
    end
  end
  return { track = track, fx = fx, kind = kind, guid = reaper.TrackFX_GetFXGUID(track, fx) }
end

function M.check(binding)
  assert(reaper.ValidatePtr2(0, binding.track, 'MediaTrack*'), 'Track no longer exists')
  assert(reaper.TrackFX_GetFXGUID(binding.track, binding.fx) == binding.guid, 'FX was removed or moved; reopen the companion')
end

function M.read(binding)
  M.check(binding)
  local values = {}
  for _, d in ipairs(M.instrument(binding.kind).parameters) do
    values[d.id] = reaper.TrackFX_GetParam(binding.track, binding.fx, d.paramIndex)
  end
  return values
end

function M.apply(binding, params, title)
  M.check(binding)
  local inst, by_id, writes = M.instrument(binding.kind), {}, {}
  for _, d in ipairs(inst.parameters) do by_id[d.id] = d end
  for id, value in pairs(params) do
    local d = assert(by_id[id], 'Unknown parameter: ' .. id)
    assert(not d.file, 'File indices are local to the Data folder; use the native file selector')
    assert(type(value) == 'number' and value == value and value >= d.min and value <= d.max, 'Out of range: ' .. id)
    assert(d.step < 1 or value == math.floor(value), 'Expected integer: ' .. id)
    writes[#writes + 1] = { def = d, value = value, old = reaper.TrackFX_GetParam(binding.track, binding.fx, d.paramIndex) }
  end
  if title ~= false then reaper.Undo_BeginBlock2(0) end
  local ok, err = pcall(function()
    for _, w in ipairs(writes) do
      assert(reaper.TrackFX_SetParam(binding.track, binding.fx, w.def.paramIndex, w.value), 'Write failed: ' .. w.def.id)
    end
    for _, w in ipairs(writes) do
      local got = reaper.TrackFX_GetParam(binding.track, binding.fx, w.def.paramIndex)
      assert(math.abs(got - w.value) <= math.max(1e-6, math.abs(w.value) * 1e-6),
        'Readback mismatch: ' .. w.def.id .. ' expected ' .. w.value .. ', got ' .. got)
    end
  end)
  if not ok then
    for _, w in ipairs(writes) do reaper.TrackFX_SetParam(binding.track, binding.fx, w.def.paramIndex, w.old) end
  end
  if title ~= false then reaper.Undo_EndBlock2(0, title or 'AmiSynth parameter change', -1) end
  assert(ok, err)
  return M.read(binding)
end

function M.preset(binding, name)
  for _, p in ipairs(M.instrument(binding.kind).presets) do
    if p.name == name then return M.apply(binding, p.params, 'AmiSynth preset: ' .. name) end
  end
  error('Unknown preset: ' .. tostring(name))
end

function M.macro(binding, name, amount)
  assert(type(amount) == 'number' and amount >= 0 and amount <= 1, 'Macro amount must be 0..1')
  for _, macro in ipairs(M.instrument(binding.kind).macros) do
    if macro.name == name then
      local params = {}
      for _, t in ipairs(macro.targets) do
        local value = t.scale == 'log' and t.min * (t.max / t.min) ^ amount or t.min + (t.max - t.min) * amount
        for _, d in ipairs(M.instrument(binding.kind).parameters) do
          if d.id == t.id and d.step >= 1 then value = math.floor(value + 0.5) end
        end
        params[t.id] = value
      end
      return M.apply(binding, params, 'AmiSynth macro: ' .. name)
    end
  end
  error('Unknown macro: ' .. tostring(name))
end

-- User presets live in REAPER's persistent ExtState, not the repository.
function M.users(kind)
  local presets = {}
  local text = reaper.GetExtState('AmiSynthCompanion', kind)
  for line in text:gmatch('[^\n]+') do
    local name, values = line:match('^([^\t]+)\t(.*)$')
    if name then
      local params = {}
      for id, v in values:gmatch('([%w_]+)=([^,]+)') do params[id] = tonumber(v) end
      presets[#presets + 1] = { name = name, params = params, category = 'User' }
    end
  end
  return presets
end

function M.save(binding, name)
  assert(name:match('%S') and not name:find('[\n\r\t|<>!#]'), 'Name cannot contain tabs, newlines or menu characters')
  for _, p in ipairs(M.instrument(binding.kind).presets) do assert(p.name ~= name, 'Choose a name different from built-in presets') end
  local presets, params, found = M.users(binding.kind), M.read(binding), false
  for _, p in ipairs(presets) do
    if p.name == name then p.params = params; found = true end
  end
  if not found then presets[#presets + 1] = { name = name, params = params } end
  local lines = {}
  for _, p in ipairs(presets) do
    local values = {}
    for _, d in ipairs(M.instrument(binding.kind).parameters) do
      if not d.id:match('^tuning_') and not d.file and p.params[d.id] ~= nil then
        values[#values + 1] = d.id .. '=' .. string.format('%.17g', p.params[d.id])
      end
    end
    lines[#lines + 1] = p.name .. '\t' .. table.concat(values, ',')
  end
  reaper.SetExtState('AmiSynthCompanion', binding.kind, table.concat(lines, '\n'), true)
end

return M
