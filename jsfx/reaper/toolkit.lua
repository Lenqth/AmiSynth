-- @description AmiSynth toolkit: Lua function library for presets/macros/real-unit parameter writes; dofile dependency, not an executable action.
-- @about Direct script_run only returns a Lua module and makes no project change or MCP result. Use local ami=dofile(path); ami.bind(track, zero_based_fx, synth|phys|drums|tuning) validates track, FX name, slider names/ranges. ami.preset(binding,name), ami.macro(binding,name,amount_0_to_1), ami.apply(binding,id_to_real_value), ami.read(binding), ami.save(binding,name), plus ami.apply_sound(request)/ami.read_sound(request) behind the AmiSynth - Apply sound / Read sound actions, ami.create_drum_tracks(request) and ami.run_request(request) (the action table behind AmiSynth - Run.lua) are available; writes verify readback, rollback on failure and support Undo. Preserve ../generated/catalog.lua; never treat Hz/ms/dB as normalized 0-1. Use a dedicated wrapper to choose the target and publish reaper_mcp_script_result/last_result.
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

-- Display hints only: keep the stored/validated -4800..4800 amount domain unchanged.
function M.parameter_display(d, values)
  if not d.modulation then return d end
  local dest = math.floor((values[d.modulation.destinationParameter] or 0) + 0.5)
  local hint = d.modulation.destinations[dest + 1] or d.modulation.destinations[1]
  local out = {}; for k, v in pairs(d) do out[k] = v end
  out.unit, out.suggested_min, out.suggested_max, out.fine_step = hint.unit, -hint.range, hint.range, hint.step
  out.name = d.name .. ' (' .. hint.name .. ')'
  return out
end

function M.apply(binding, params, title)
  M.check(binding)
  local inst, by_id, writes = M.instrument(binding.kind), {}, {}
  for _, d in ipairs(inst.parameters) do by_id[d.id] = d end
  for id, value in pairs(params) do
    local d = assert(by_id[id], 'Unknown parameter: ' .. id)
    assert(not d.file, 'File indices are local to the Data folder; use the native file selector')
    assert(not d.readonly, 'Read-only status parameter: ' .. id)
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

-- ---- MCP sound design: JSON diff in / JSON summary out -------------------
-- The diff format matches the web "JSON コピー": {type?, name?, params = {id = real value}}.
-- Tuning (tuning_*) and Data-folder file indices are never part of a sound diff.

M.TITLES = { synth = 'Synth', phys = 'Physical', drums = 'Drums', tuning = 'Tuning' }
M.SOUND_KINDS = { 'synth', 'phys', 'drums' }
M.REQUEST_SECTION = 'AmiSynthMCP'
local ARRAY = {}
function M.array(t) return setmetatable(t or {}, ARRAY) end

local function num(v)
  if v ~= v then error('NaN is not representable in JSON') end
  if v == math.huge or v == -math.huge then error('Infinity is not representable in JSON') end
  if math.type and math.type(v) == 'integer' then return tostring(v) end
  if v == math.floor(v) and math.abs(v) < 2 ^ 53 then return string.format('%d', v) end
  for _, f in ipairs({ '%.15g', '%.16g', '%.17g' }) do
    local text = string.format(f, v)
    if tonumber(text) == v then return text end
  end
end

local function str(s)
  return '"' .. s:gsub('[%c"\\]', function(c)
    local named = { ['"'] = '\\"', ['\\'] = '\\\\', ['\n'] = '\\n', ['\r'] = '\\r', ['\t'] = '\\t' }
    return named[c] or string.format('\\u%04x', c:byte())
  end) .. '"'
end

-- Deterministic encoder: object keys sorted, M.array() / non-empty sequences become arrays.
function M.json_encode(v)
  local t = type(v)
  if t == 'nil' then return 'null' end
  if t == 'boolean' then return tostring(v) end
  if t == 'number' then return num(v) end
  if t == 'string' then return str(v) end
  assert(t == 'table', 'Cannot encode ' .. t)
  local count = 0
  for _ in pairs(v) do count = count + 1 end
  if getmetatable(v) == ARRAY or (count > 0 and count == #v) then
    local out = {}
    for i = 1, #v do out[i] = M.json_encode(v[i]) end
    return '[' .. table.concat(out, ',') .. ']'
  end
  local keys, out = {}, {}
  for k in pairs(v) do keys[#keys + 1] = tostring(k) end
  table.sort(keys)
  for _, k in ipairs(keys) do out[#out + 1] = str(k) .. ':' .. M.json_encode(v[k]) end
  return '{' .. table.concat(out, ',') .. '}'
end

-- Small strict JSON decoder (RFC 8259 values; \u escapes for the BMP). null decodes to nil.
function M.json_decode(text)
  assert(type(text) == 'string', 'Expected JSON text')
  local pos = 1
  local function fail(msg) error('Invalid JSON at character ' .. pos .. ': ' .. msg, 0) end
  local function ws() pos = text:find('[^ \t\r\n]', pos) or #text + 1 end
  local value
  local function string_value()
    local out = {}
    pos = pos + 1
    while true do
      local c = text:sub(pos, pos)
      if c == '' then fail('unterminated string') end
      if c == '"' then pos = pos + 1; return table.concat(out) end
      if c == '\\' then
        local e = text:sub(pos + 1, pos + 1)
        local simple = { ['"'] = '"', ['\\'] = '\\', ['/'] = '/', b = '\b', f = '\f', n = '\n', r = '\r', t = '\t' }
        if simple[e] then out[#out + 1] = simple[e]; pos = pos + 2
        elseif e == 'u' then
          local hex = text:sub(pos + 2, pos + 5)
          if not hex:match('^%x%x%x%x$') then fail('bad \\u escape') end
          out[#out + 1] = utf8 and utf8.char(tonumber(hex, 16)) or '?'
          pos = pos + 6
        else fail('bad escape') end
      elseif c:byte() < 32 then fail('control character in string')
      else out[#out + 1] = c; pos = pos + 1 end
    end
  end
  function value()
    ws()
    local c = text:sub(pos, pos)
    if c == '{' then
      local obj = {}
      pos = pos + 1; ws()
      if text:sub(pos, pos) == '}' then pos = pos + 1; return obj end
      while true do
        ws()
        if text:sub(pos, pos) ~= '"' then fail('expected a key') end
        local key = string_value()
        ws()
        if text:sub(pos, pos) ~= ':' then fail('expected :') end
        pos = pos + 1
        obj[key] = value()
        ws()
        local sep = text:sub(pos, pos); pos = pos + 1
        if sep == '}' then return obj end
        if sep ~= ',' then pos = pos - 1; fail('expected , or }') end
      end
    elseif c == '[' then
      local arr = M.array()
      pos = pos + 1; ws()
      if text:sub(pos, pos) == ']' then pos = pos + 1; return arr end
      while true do
        arr[#arr + 1] = value()
        ws()
        local sep = text:sub(pos, pos); pos = pos + 1
        if sep == ']' then return arr end
        if sep ~= ',' then pos = pos - 1; fail('expected , or ]') end
      end
    elseif c == '"' then return string_value()
    elseif text:sub(pos, pos + 3) == 'true' then pos = pos + 4; return true
    elseif text:sub(pos, pos + 4) == 'false' then pos = pos + 5; return false
    elseif text:sub(pos, pos + 3) == 'null' then pos = pos + 4; return nil
    else
      local n = text:match('^-?%d+%.?%d*[eE]?[-+]?%d*', pos)
      if not n or n == '' or not tonumber(n) then fail('unexpected ' .. (c == '' and 'end of input' or c)) end
      pos = pos + #n
      return tonumber(n)
    end
  end
  local result = value()
  ws()
  if pos <= #text then fail('trailing characters') end
  return result
end

-- Accepts synth / Synth / Physical / phys / Drums / drums or a web type 'amisynth-<kind>-preset'.
function M.sound_kind(name)
  if name == nil then return nil end
  local key = tostring(name):lower():gsub('^amisynth%-', ''):gsub('%-preset$', '')
  local aliases = { synth = 'synth', phys = 'phys', physical = 'phys', drums = 'drums', drum = 'drums' }
  return aliases[key] or error('Unknown instrument: ' .. tostring(name) .. ' (use Synth, Physical or Drums)', 0)
end

local function editable(d) return not d.file and not d.readonly and not d.id:match('^tuning_') end

-- Validate a diff without touching REAPER. Clamps like the web paste; enum labels are accepted.
-- Returns clean {id = value}, clamped and rejected lists (each item has a reason).
function M.validate_diff(kind, params)
  local by_id, clean, clamped, rejected = {}, {}, M.array(), M.array()
  for _, d in ipairs(M.instrument(kind).parameters) do by_id[d.id] = d end
  local ids = {}
  for id in pairs(params or {}) do ids[#ids + 1] = tostring(id) end
  table.sort(ids)
  for _, id in ipairs(ids) do
    local d, v = by_id[id], params[id]
    local function reject(reason)
      rejected[#rejected + 1] = { id = id, value = type(v) ~= 'table' and v or nil, reason = reason }
    end
    if not d then reject('unknown parameter for ' .. kind)
    elseif id:match('^tuning_') then reject('tuning is preserved by sound diffs; edit it in the Companion or with ami.apply')
    elseif d.file then reject('file indices depend on the REAPER Data folder; use the native JSFX file selector')
    else
      if type(v) == 'string' and d.options then
        for i, label in ipairs(d.options) do if label:lower() == v:lower() then v = i - 1; break end end
      end
      if type(v) ~= 'number' or v ~= v or v == math.huge or v == -math.huge then
        reject(d.options and ('expected a number or one of: ' .. table.concat(d.options, ', ')) or 'expected a finite number')
      else
        local c = math.min(d.max, math.max(d.min, v))
        if d.step >= 1 then c = math.floor(c + 0.5) end
        if c ~= v then
          clamped[#clamped + 1] = { id = id, requested = v, applied = c,
            reason = (v < d.min or v > d.max) and ('range is ' .. d.min .. '..' .. d.max .. (d.unit ~= '' and (' ' .. d.unit) or ''))
              or 'integer parameter; rounded' }
        end
        clean[id] = c
      end
    end
  end
  return clean, clamped, rejected
end

-- Non-default, non-tuning values in the web diff format (threshold as in diffFromDefaults).
function M.diff(kind, values)
  local out = {}
  for _, d in ipairs(M.instrument(kind).parameters) do
    if editable(d) and values[d.id] and math.abs(values[d.id] - d.default) > 1e-9 then out[d.id] = values[d.id] end
  end
  return out
end

function M.track_name(track)
  local _, name = reaper.GetSetMediaTrackInfo_String(track, 'P_NAME', '', false)
  return name or ''
end

local function label(track)
  local name = M.track_name(track)
  return name ~= '' and name or 'Untitled track'
end

-- spec: nil / 'selected' = first selected track; otherwise an exact (then case-insensitive) track name.
function M.find_track(spec)
  if spec == nil or spec == 'selected' then
    return assert(reaper.GetSelectedTrack(0, 0), 'No track selected; select one or pass "track": "<name>"')
  end
  assert(type(spec) == 'string' and spec ~= '', 'track must be "selected" or a track name')
  local folded = {}
  for i = 0, reaper.CountTracks(0) - 1 do
    local track = reaper.GetTrack(0, i)
    local name = M.track_name(track)
    if name == spec then return track end
    if name:lower() == spec:lower() then folded[#folded + 1] = track end
  end
  assert(#folded == 1, #folded > 1 and ('Several tracks are named ' .. spec) or ('No track named ' .. spec))
  return folded[1]
end

-- AmiSynth sound instruments on a track, in FX order: { {fx, kind, name}, ... }
function M.instruments_on(track)
  local found = {}
  for fx = 0, reaper.TrackFX_GetCount(track) - 1 do
    local _, name = reaper.TrackFX_GetFXName(track, fx, '')
    for _, kind in ipairs(M.SOUND_KINDS) do
      if name:find('AmiSynth ' .. M.TITLES[kind], 1, true) then found[#found + 1] = { fx = fx, kind = kind, name = name } end
    end
  end
  return found
end

-- Pick the instrument (optionally inserting it). Returns fx, kind, inserted.
function M.locate(track, kind, fx, insert)
  local found = M.instruments_on(track)
  if fx ~= nil then
    assert(type(fx) == 'number' and fx == math.floor(fx), 'fx must be a zero-based integer')
    for _, f in ipairs(found) do
      if f.fx == fx then
        assert(not kind or f.kind == kind, 'FX ' .. fx .. ' is AmiSynth ' .. M.TITLES[f.kind] .. ', not ' .. M.TITLES[kind or f.kind])
        return f.fx, f.kind, false
      end
    end
    error('FX ' .. fx .. ' is not an AmiSynth Synth/Physical/Drums instance')
  end
  for _, f in ipairs(found) do if not kind or f.kind == kind then
    if not kind then
      for _, other in ipairs(found) do
        assert(other.kind == f.kind, 'Track has several AmiSynth instruments; pass "instrument" or "fx"')
      end
    end
    return f.fx, f.kind, false
  end end
  assert(kind, 'No AmiSynth Synth/Physical/Drums on the track; pass "instrument" to insert one')
  assert(insert, 'No AmiSynth ' .. M.TITLES[kind] .. ' on the track (insert disabled)')
  local index = reaper.TrackFX_AddByName(track, 'JS: AmiSynth/AmiSynth ' .. M.TITLES[kind] .. '.jsfx', false, -1)
  assert(index >= 0, 'Could not insert AmiSynth ' .. M.TITLES[kind] .. '; install the JSFX in Effects/AmiSynth first')
  return index, kind, true
end

-- Host track meter (REAPER's own, post-FX/fader). The JSFX's internal peak/RMS meter is
-- graphics-only state and cannot be read by ReaScript, so it is not reported.
function M.track_meter(track)
  if not reaper.Track_GetPeakInfo then return { available = false } end
  local function db(x) return x > 0 and math.floor(200 * math.log(x, 10) + 0.5) / 10 or nil end
  local playing = reaper.GetPlayState and (reaper.GetPlayState() & 1) == 1 or false
  return { available = true, playing = playing,
    peak_l_db = db(reaper.Track_GetPeakInfo(track, 0)), peak_r_db = db(reaper.Track_GetPeakInfo(track, 1)),
    note = 'REAPER track meter at the moment of the call (empty/-inf while stopped); the JSFX peak/RMS meter is not readable from ReaScript' }
end

-- Request = Lua table from M.request(). Returns a summary table; raises on fatal errors.
function M.apply_sound(req)
  assert(type(req) == 'table', 'Request must be a JSON object')
  local params = req.params
  if params == nil then params = {} end
  assert(type(params) == 'table' and getmetatable(params) ~= ARRAY, '"params" must be an object of id: real value')
  local track = M.find_track(req.track)
  local kind = M.sound_kind(req.instrument or req.type)
  local dry = req.dry_run == true
  -- Validate everything that does not need REAPER before changing the project.
  local base_name = req.base
  if base_name == nil then base_name = 'current' end
  assert(type(base_name) == 'string', 'base must be "current", "default" or a built-in preset name')
  local function base_values(k, current)
    local out = {}
    if base_name == 'current' then
      for id, v in pairs(current) do out[id] = v end
      return out
    end
    for _, d in ipairs(M.instrument(k).parameters) do out[d.id] = editable(d) and d.default or current[d.id] end
    if base_name == 'default' then return out end
    for _, p in ipairs(M.instrument(k).presets) do
      if p.name == base_name then
        for id, v in pairs(p.params) do out[id] = v end
        return out
      end
    end
    local names = {}
    for _, p in ipairs(M.instrument(k).presets) do names[#names + 1] = p.name end
    error('Unknown ' .. M.TITLES[k] .. ' preset: ' .. base_name .. ' (built-in: ' .. table.concat(names, ', ') .. ')', 0)
  end
  if kind then
    local clean, _, rejected = M.validate_diff(kind, params)
    assert(next(clean) or not next(params), 'No usable parameters: ' .. M.json_encode(rejected))
    base_values(kind, {})
  end

  local summary
  if not dry then reaper.Undo_BeginBlock2(0) end
  local inserted_fx
  local ok, err = pcall(function()
    local fx, k, inserted, binding, current
    local missing = kind and req.fx == nil
    for _, f in ipairs(M.instruments_on(track)) do if f.kind == kind then missing = false end end
    if dry and missing and req.insert ~= false then
      -- Preview against the catalog defaults of the instrument that would be inserted.
      k, inserted, current = kind, 'would insert', {}
      for _, d in ipairs(M.instrument(k).parameters) do current[d.id] = d.default end
    else
      fx, k, inserted = M.locate(track, kind, req.fx, req.insert ~= false and not dry)
      if inserted then inserted_fx = fx end
      binding = M.bind(track, fx, k)
      current = M.read(binding)
    end
    local clean, clamped, rejected = M.validate_diff(k, params)
    assert(next(clean) or not next(params), 'No usable parameters: ' .. M.json_encode(rejected))
    local target = base_values(k, current)
    for id, v in pairs(clean) do target[id] = v end
    local writes, changed = {}, M.array()
    for _, d in ipairs(M.instrument(k).parameters) do
      if editable(d) and math.abs(target[d.id] - current[d.id]) > 1e-9 then
        writes[d.id] = target[d.id]
        changed[#changed + 1] = d.id
      end
    end
    local after = current
    if not dry and next(writes) then after = M.apply(binding, writes, false) end
    summary = {
      ok = true, dry_run = dry, track = label(track), instrument = k,
      fx = fx, inserted = inserted, base = base_name,
      applied = clean, clamped = clamped, rejected = rejected, changed = changed,
      sound = { type = 'amisynth-' .. k .. '-preset', params = M.diff(k, dry and target or after) },
      meter = M.track_meter(track),
    }
    if req.audition then
      summary.audition = 'skipped: a one-shot ReaScript cannot play and measure audio before returning; start playback (or arm the track) and read the JSFX meter'
    end
  end)
  if not ok and inserted_fx then reaper.TrackFX_Delete(track, inserted_fx) end
  if not dry then
    reaper.Undo_EndBlock2(0, 'AmiSynth MCP: apply sound' .. (summary and (' (' .. summary.track .. ')') or ''), -1)
  end
  if not ok then error(err, 0) end
  return summary
end

function M.read_sound(req)
  req = req or {}
  assert(type(req) == 'table', 'Request must be a JSON object')
  local track = M.find_track(req.track)
  local fx, kind = M.locate(track, M.sound_kind(req.instrument or req.type), req.fx, false)
  local binding = M.bind(track, fx, kind)
  local values = M.read(binding)
  local tuning = {}
  for _, d in ipairs(M.instrument(kind).parameters) do
    if d.id:match('^tuning_') then tuning[d.id] = values[d.id] end
  end
  return { ok = true, type = 'amisynth-' .. kind .. '-preset', name = label(track),
    track = label(track), instrument = kind, fx = fx, params = M.diff(kind, values),
    tuning = tuning, meter = M.track_meter(track) }
end

-- A request written in the project notes: a block that starts with a line "```amisynth <key>"
-- (or "<<<amisynth <key>") and ends with a line "```" (or ">>>"). Notes are never changed.
function M.notes_request(notes, key)
  if type(notes) ~= 'string' then return nil end
  local lines, body = {}, nil
  for line in (notes .. '\n'):gmatch('([^\n]*)\n') do
    line = line:gsub('\r$', '')
    if body then
      if line:match('^%s*```%s*$') or line:match('^%s*>>>%s*$') then return table.concat(body, '\n') end
      body[#body + 1] = line
    elseif line:match('^%s*```%s*amisynth%s+' .. key:gsub('%p', '%%%0') .. '%s*$')
      or line:match('^%s*<<<%s*amisynth%s+' .. key:gsub('%p', '%%%0') .. '%s*$') then
      body = {}
    end
  end
  return nil
end

-- Request lookup, first found wins:
--   1. ExtState AmiSynthMCP/<key> (consumed)
--   2. project ExtState AmiSynthMCP/<key> (saved with the project; consumed)
--   3. a ```amisynth <key> block in the project notes (left in place)
--   4. Scripts/AmiSynth/<key>.json (left in place)
function M.request(key, script_dir)
  local text, source = reaper.GetExtState(M.REQUEST_SECTION, key), 'ExtState ' .. M.REQUEST_SECTION .. '/' .. key
  if text ~= nil and text ~= '' then
    reaper.DeleteExtState(M.REQUEST_SECTION, key, false)
  else
    text = nil
    if reaper.GetProjExtState then
      local _, value = reaper.GetProjExtState(0, M.REQUEST_SECTION, key)
      if value ~= nil and value ~= '' then
        text, source = value, 'project ExtState ' .. M.REQUEST_SECTION .. '/' .. key
        reaper.SetProjExtState(0, M.REQUEST_SECTION, key, '')
      end
    end
    if text == nil and reaper.GetSetProjectNotes then
      text = M.notes_request(reaper.GetSetProjectNotes(0, false, ''), key)
      if text then source = 'project notes (amisynth ' .. key .. ')' end
    end
    if text == nil then
      local path = (script_dir or dir) .. '../' .. key .. '.json'
      local file = io.open(path, 'r')
      if file then text = file:read('*a'); file:close(); source = path end
    end
  end
  if text == nil or not text:match('%S') then return nil, 'none' end
  local ok, value = pcall(M.json_decode, text)
  if not ok then error('Could not read request from ' .. source .. ': ' .. value, 0) end
  return value, source
end

-- Publish to the REAPER MCP result channel: "ok: <json>" or "error: <message>".
function M.publish(ok, value)
  -- Drop the "path/toolkit.lua:123: " prefix of assert messages; the caller needs the reason.
  local text = ok and ('ok: ' .. M.json_encode(value)) or ('error: ' .. tostring(value):gsub('^[^\n]-%.lua:%d+: ', ''))
  reaper.SetExtState('reaper_mcp_script_result', 'last_result', text, false)
  return text
end

-- ---- Drums: one 10-channel instrument track + four stereo audio buses ----------------------

M.DRUM_TRACKS = {
  { name = 'AmiSynth Drums - MIDI', role = 'instrument' },
  { name = 'Kick', role = 'kick', channels = '3/4' },
  { name = 'Snare - Clap - Rim', role = 'snare', channels = '5/6' },
  { name = 'Hats - Cymbals', role = 'hats', channels = '7/8' },
  { name = 'Toms - Percussion', role = 'perc', channels = '9/10' },
}

-- Creates the five tracks after the last one (existing tracks are untouched), one Undo step.
-- Returns where they are: track numbers are 1-based as in the REAPER track list, index 0-based.
function M.create_drum_tracks(req)
  req = req or {}
  assert(type(req) == 'table', 'Request must be a JSON object')
  local created = {}
  local summary
  reaper.Undo_BeginBlock2(0)
  local ok, err = pcall(function()
    local at = reaper.CountTracks(0)
    for i, t in ipairs(M.DRUM_TRACKS) do
      reaper.InsertTrackAtIndex(at + i - 1, true)
      local track = reaper.GetTrack(0, at + i - 1)
      created[#created + 1] = track
      reaper.GetSetMediaTrackInfo_String(track, 'P_NAME', t.name, true)
    end
    local source = created[1]
    reaper.SetMediaTrackInfo_Value(source, 'I_NCHAN', 10)
    local fx = reaper.TrackFX_AddByName(source, 'JS: AmiSynth/AmiSynth Drums.jsfx', false, -1)
    assert(fx >= 0, 'Install the JSFX in Effects/AmiSynth first')
    -- Explicit identity mapping: output pins 1..10 go to track channels 1..10.
    for pin = 0, 9 do assert(reaper.TrackFX_SetPinMappings(source, fx, 1, pin, 1 << pin, 0), 'Pin mapping failed') end
    local binding = M.bind(source, fx, 'drums')
    M.apply(binding, { kick_bus_in_main = 0, snare_bus_in_main = 0, hats_bus_in_main = 0, perc_bus_in_main = 0 }, false)
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
    if req.select ~= false then reaper.SetOnlyTrackSelected(source) end
    local tracks = M.array()
    for i, t in ipairs(M.DRUM_TRACKS) do
      tracks[i] = { number = at + i, index = at + i - 1, name = t.name, role = t.role,
        source_channels = t.channels, guid = reaper.GetTrackGUID and reaper.GetTrackGUID(created[i]) or nil }
    end
    summary = { ok = true, tracks = tracks, instrument = { track = at + 1, index = at, fx = fx, name = M.DRUM_TRACKS[1].name },
      selected = req.select ~= false,
      note = 'The instrument track sends its outputs 3-10 to the four bus tracks (post fader, no MIDI); its own main output is off. Put MIDI on the instrument track.' }
  end)
  if not ok then
    for i = #created, 1, -1 do reaper.DeleteTrack(created[i]) end
  end
  reaper.TrackList_AdjustWindows(false)
  reaper.UpdateArrange()
  reaper.Undo_EndBlock2(0, 'AmiSynth Drums: create four routed audio buses', -1)
  if not ok then error(err, 0) end
  return summary
end

-- ---- Generic MCP entry point (AmiSynth - Run.lua): {"action": "...", ...} ---------------

-- synth / phys / drums (as M.sound_kind) or tuning
local function any_kind(name)
  if name ~= nil and tostring(name):lower():gsub('^amisynth%-', '') == 'tuning' then return 'tuning' end
  return M.sound_kind(name)
end

-- Bind an AmiSynth FX on a request's track (never inserts one).
local function bind_request(req)
  local track = M.find_track(req.track)
  local kind = any_kind(req.instrument or req.type)
  if kind == 'tuning' then
    for fx = 0, reaper.TrackFX_GetCount(track) - 1 do
      local _, name = reaper.TrackFX_GetFXName(track, fx, '')
      if name:find('AmiSynth Tuning', 1, true) and (req.fx == nil or req.fx == fx) then return M.bind(track, fx, 'tuning'), track end
    end
    error('No AmiSynth Tuning on the track' .. (req.fx and (' at FX ' .. req.fx) or ''), 0)
  end
  local fx, k = M.locate(track, kind, req.fx, false)
  return M.bind(track, fx, k), track
end

local function with_labels(kind, values)
  local labels = {}
  for _, d in ipairs(M.instrument(kind).parameters) do
    if d.options and values[d.id] then labels[d.id] = d.options[math.floor(values[d.id] + 0.5) + 1] end
  end
  return labels
end

M.ACTIONS = {
  help = { about = 'List the actions and their request fields', run = function()
    local out = {}
    for name, a in pairs(M.ACTIONS) do out[name] = a.about end
    return { ok = true, actions = out }
  end },
  list = { about = 'Tracks with AmiSynth FX: [{number, name, fx:[{fx, kind, name}]}]; no fields', run = function()
    local tracks = M.array()
    for i = 0, reaper.CountTracks(0) - 1 do
      local track = reaper.GetTrack(0, i)
      local fx = M.array()
      for j = 0, reaper.TrackFX_GetCount(track) - 1 do
        local _, name = reaper.TrackFX_GetFXName(track, j, '')
        for kind, title in pairs(M.TITLES) do
          if name:find('AmiSynth ' .. title, 1, true) then fx[#fx + 1] = { fx = j, kind = kind, name = name } end
        end
      end
      if #fx > 0 then tracks[#tracks + 1] = { number = i + 1, index = i, name = M.track_name(track), fx = fx } end
    end
    return { ok = true, tracks = tracks }
  end },
  read_sound = { about = 'Same as AmiSynth - Read sound.lua: {track, instrument, fx}', run = function(req) return M.read_sound(req) end },
  apply_sound = { about = 'Same as AmiSynth - Apply sound.lua: {track, instrument, base, params, fx, insert, dry_run}', run = function(req) return M.apply_sound(req) end },
  get = { about = 'Every parameter value (tuning included; instrument may be Tuning): {track, instrument, fx}', run = function(req)
    local binding, track = bind_request(req)
    local values = M.read(binding)
    local display = {}
    for _, d in ipairs(M.instrument(binding.kind).parameters) do
      if d.modulation then
        local hint = M.parameter_display(d, values)
        display[d.id] = { name = hint.name, unit = hint.unit, suggested_min = hint.suggested_min,
          suggested_max = hint.suggested_max, fine_step = hint.fine_step }
      end
    end
    return { ok = true, track = M.track_name(track), instrument = binding.kind, fx = binding.fx, values = values,
      labels = with_labels(binding.kind, values), display = display }
  end },
  set = { about = 'Write parameters in real units (enum labels accepted; tuning and Tuning JSFX sliders allowed; read-only and file sliders rejected): {track, instrument, fx, params}', run = function(req)
    assert(type(req.params) == 'table' and next(req.params), '"params" must be a non-empty object of id: real value')
    local binding, track = bind_request(req)
    local by_id, params = {}, {}
    for _, d in ipairs(M.instrument(binding.kind).parameters) do by_id[d.id] = d end
    for id, v in pairs(req.params) do
      local d = by_id[id]
      if d and d.options and type(v) == 'string' then
        for i, label in ipairs(d.options) do if label:lower() == v:lower() then v = i - 1; break end end
        assert(type(v) == 'number', id .. ': expected one of ' .. table.concat(d.options, ', '))
      end
      params[id] = v
    end
    local values = M.apply(binding, params, 'AmiSynth MCP: set (' .. M.track_name(track) .. ')')
    local written = {}
    for id in pairs(params) do written[id] = values[id] end
    return { ok = true, track = M.track_name(track), instrument = binding.kind, fx = binding.fx, written = written }
  end },
  presets = { about = 'Built-in and user preset names: {instrument}', run = function(req)
    local kind = M.sound_kind(req.instrument or req.type or 'synth')
    local builtin, user = M.array(), M.array()
    for _, p in ipairs(M.instrument(kind).presets) do builtin[#builtin + 1] = { name = p.name, category = p.category } end
    for _, p in ipairs(M.users(kind)) do user[#user + 1] = p.name end
    return { ok = true, instrument = kind, builtin = builtin, user = user }
  end },
  preset = { about = 'Load a built-in or user preset (tuning kept): {track, instrument, fx, name}', run = function(req)
    assert(type(req.name) == 'string', '"name" must be a preset name')
    local binding, track = bind_request(req)
    local values
    for _, p in ipairs(M.instrument(binding.kind).presets) do
      if p.name == req.name then values = M.preset(binding, req.name) end
    end
    if not values then
      for _, p in ipairs(M.users(binding.kind)) do
        if p.name == req.name then values = M.apply(binding, p.params, 'AmiSynth preset: ' .. p.name) end
      end
    end
    assert(values, 'Unknown preset: ' .. req.name)
    return { ok = true, track = M.track_name(track), instrument = binding.kind, fx = binding.fx, preset = req.name,
      sound = { type = 'amisynth-' .. binding.kind .. '-preset', params = M.diff(binding.kind, values) } }
  end },
  macro = { about = 'Synth macro Brightness / Punch / Width / Pump, amount 0..1: {track, fx, name, amount}', run = function(req)
    local binding, track = bind_request({ track = req.track, fx = req.fx, instrument = req.instrument or 'synth' })
    local values = M.macro(binding, req.name, req.amount)
    return { ok = true, track = M.track_name(track), fx = binding.fx, macro = req.name, amount = req.amount,
      sound = { type = 'amisynth-' .. binding.kind .. '-preset', params = M.diff(binding.kind, values) } }
  end },
  save_preset = { about = 'Save the current sound as a user preset (REAPER ExtState, tuning excluded): {track, instrument, fx, name}', run = function(req)
    assert(type(req.name) == 'string', '"name" must be a preset name')
    local binding, track = bind_request(req)
    M.save(binding, req.name)
    return { ok = true, track = M.track_name(track), instrument = binding.kind, saved = req.name }
  end },
  create_drum_tracks = { about = 'Same as AmiSynth Drums - Create routed tracks.lua: {select}', run = function(req) return M.create_drum_tracks(req) end },
}

-- One action, or {"actions": [ ... ]} run in order (stops at the first error; earlier ones stay done).
function M.run_request(req)
  assert(type(req) == 'table', 'Request must be a JSON object')
  if req.actions ~= nil then
    assert(type(req.actions) == 'table' and #req.actions > 0, '"actions" must be a non-empty array of requests')
    local results = M.array()
    for i, a in ipairs(req.actions) do
      local ok, r = pcall(M.run_request, a)
      if not ok then
        error('action ' .. i .. ' (' .. tostring(type(a) == 'table' and a.action) .. ') failed: ' .. tostring(r):gsub('^[^\n]-%.lua:%d+: ', '')
          .. (i > 1 and ('; actions 1-' .. (i - 1) .. ' were done') or ''), 0)
      end
      results[i] = r
    end
    return { ok = true, results = results }
  end
  local names = {}
  for name in pairs(M.ACTIONS) do names[#names + 1] = name end
  table.sort(names)
  local action = M.ACTIONS[req.action]
  assert(action, 'Unknown action: ' .. tostring(req.action) .. ' (one of ' .. table.concat(names, ', ') .. ')')
  local result = action.run(req)
  result.action = req.action
  return result
end

-- Shared body of the MCP actions.
function M.run_action(key, fn, script_dir, required)
  local ok, result = pcall(function()
    local req, source = M.request(key, script_dir)
    assert(req ~= nil or not required, 'No request found. Set ExtState ' .. M.REQUEST_SECTION .. '/' .. key ..
      ' (or write Scripts/AmiSynth/' .. key .. '.json) to a JSON object before script_run; see AmiSynth - MCP guide.lua')
    local summary = fn(req)
    summary.request_source = source
    return summary
  end)
  return M.publish(ok, result)
end

return M
