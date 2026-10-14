-- @description AmiSynth toolkit: Lua function library for presets/macros/real-unit parameter writes; dofile dependency, not an executable action.
-- @about Direct script_run only returns a Lua module and makes no project change or MCP result. Use local ami=dofile(path); ami.bind(track, zero_based_fx, synth|phys|drums|tuning) validates track, FX name, slider names/ranges. ami.preset(binding,name), ami.macro(binding,name,amount_0_to_1), ami.apply(binding,id_to_real_value), ami.read(binding), ami.save(binding,name), plus ami.apply_sound(request)/ami.read_sound(request) behind the AmiSynth - Apply sound / Read sound actions, are available; writes verify readback, rollback on failure and support Undo. Preserve ../generated/catalog.lua; never treat Hz/ms/dB as normalized 0-1. Use a dedicated wrapper to choose the target and publish reaper_mcp_script_result/last_result.
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

local function editable(d) return not d.file and not d.id:match('^tuning_') end

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

-- Request lookup: ExtState AmiSynthMCP/<key> (consumed), else Scripts/AmiSynth/<key>.json.
function M.request(key, script_dir)
  local text, source = reaper.GetExtState(M.REQUEST_SECTION, key), 'ExtState ' .. M.REQUEST_SECTION .. '/' .. key
  if text ~= nil and text ~= '' then
    reaper.DeleteExtState(M.REQUEST_SECTION, key, false)
  else
    text = nil
    local path = (script_dir or dir) .. '../' .. key .. '.json'
    local file = io.open(path, 'r')
    if file then text = file:read('*a'); file:close(); source = path end
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

-- Shared body of the two MCP actions.
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
