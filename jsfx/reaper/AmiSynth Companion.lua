-- @description AmiSynth Companion: open interactive preset/macro/parameter GUI on a selected AmiSynth track; not a headless preset command.
-- @about Requires installed AmiSynth JSFX, toolkit.lua beside this script and ../generated/catalog.lua. Select a track with Synth/Physical/Drums/Tuning; multiple instruments prompt for a choice. Presets preserve tuning; parameter writes use real Hz/ms/dB, verify readback and provide Undo. GUI remains open via defer; script_run result_found=false is expected (no completion result). For MCP automation, call toolkit.lua from a dedicated wrapper; run the read-only AmiSynth - MCP guide action for instructions.
-- Load this action via REAPER Actions > New action > Load ReaScript.
local dir = debug.getinfo(1, 'S').source:sub(2):match('^(.*[/\\])')
local api = dofile(dir .. 'toolkit.lua')
local track = reaper.GetSelectedTrack(0, 0)
if not track then reaper.MB('Select a track containing an AmiSynth JSFX.', 'AmiSynth', 0); return end
local choices = {}
for fx = 0, reaper.TrackFX_GetCount(track) - 1 do
  local _, name = reaper.TrackFX_GetFXName(track, fx, '')
  for kind, title in pairs({ synth = 'Synth', phys = 'Physical', drums = 'Drums', tuning = 'Tuning' }) do
    if name:find('AmiSynth ' .. title, 1, true) then choices[#choices + 1] = { fx = fx, kind = kind, name = name } end
  end
end
if #choices == 0 then reaper.MB('No AmiSynth JSFX on the selected track.', 'AmiSynth', 0); return end
local choice = 1
if #choices > 1 then
  local labels = {}
  for i, c in ipairs(choices) do labels[#labels + 1] = i .. ': ' .. c.name end
  local ok, text = reaper.GetUserInputs(table.concat(labels, ' / '), 1, 'Instrument number', '1')
  if not ok then return end
  choice = tonumber(text)
  if not choice or not choices[choice] then return end
end
local ok, binding = pcall(api.bind, track, choices[choice].fx, choices[choice].kind)
if not ok then reaper.MB(binding, 'AmiSynth', 0); return end
local inst = api.instrument(binding.kind)
local groups, group = {}, 1
for _, d in ipairs(inst.parameters) do
  local exists = false
  for _, g in ipairs(groups) do if g == d.group then exists = true end end
  if not exists then groups[#groups + 1] = d.group end
end
local scroll, pressed, status = 0, false, 'Click a parameter to edit it in real units.'
gfx.init('AmiSynth Companion - ' .. choices[choice].name, 720, 560)
gfx.setfont(1, 'Arial', 16)

local function run(fn)
  local success, err = pcall(fn)
  status = success and 'Applied and verified. Undo is available.' or tostring(err)
end
local function menu(items)
  local labels = {}
  for _, p in ipairs(items) do labels[#labels + 1] = (p.category and (p.category .. ' / ') or '') .. p.name end
  return items[gfx.showmenu(table.concat(labels, '|'))]
end
local function button(x, y, w, text, clicked, fn)
  gfx.set(0.17, 0.22, 0.28); gfx.rect(x, y, w, 28)
  gfx.set(0.9, 0.94, 1); gfx.x = x + 8; gfx.y = y + 5; gfx.drawstr(text)
  if clicked and gfx.mouse_x >= x and gfx.mouse_x < x + w and gfx.mouse_y >= y and gfx.mouse_y < y + 28 then fn() end
end
local function loop()
  if gfx.getchar() < 0 then return end
  local valid = pcall(api.check, binding)
  if not valid then gfx.quit(); reaper.MB('FX was removed or moved. Reopen the companion.', 'AmiSynth', 0); return end
  local down = gfx.mouse_cap & 1 == 1
  local clicked = down and not pressed
  pressed = down
  gfx.set(0.06, 0.08, 0.11); gfx.rect(0, 0, gfx.w, gfx.h)
  button(12, 12, 150, 'Choose preset', clicked, function()
    local presets = {}
    for _, p in ipairs(inst.presets) do presets[#presets + 1] = p end
    for _, p in ipairs(api.users(binding.kind)) do presets[#presets + 1] = p end
    local p = menu(presets)
    if p then run(function() api.apply(binding, p.params, 'AmiSynth preset: ' .. p.name) end) end
  end)
  button(172, 12, 130, 'Save preset', clicked, function()
    local accepted, name = reaper.GetUserInputs('Save user preset (same name overwrites)', 1, 'Name', 'My patch')
    if accepted then
      local saved, err = pcall(api.save, binding, name)
      status = saved and ('Saved user preset: ' .. name) or tostring(err)
    end
  end)
  button(312, 12, 190, groups[group], clicked, function()
    local items = {}; for _, g in ipairs(groups) do items[#items + 1] = { name = g } end
    local p = menu(items)
    if p then for i, g in ipairs(groups) do if g == p.name then group = i; scroll = 0 end end end
  end)
  for i, macro in ipairs(inst.macros) do
    button(12 + (i - 1) * 170, 50, 160, macro.name, clicked, function()
      local accepted, value = reaper.GetUserInputs(macro.name .. ': ' .. macro.description, 1, 'Amount (0..100)', '50')
      if accepted then run(function() api.macro(binding, macro.name, (tonumber(value) or -1) / 100) end) end
    end)
  end
  local defs = {}; for _, d in ipairs(inst.parameters) do if d.group == groups[group] then defs[#defs + 1] = d end end
  local rows = math.max(1, math.floor((gfx.h - 155) / 30))
  scroll = math.max(0, math.min(math.max(0, #defs - rows), scroll - math.floor(gfx.mouse_wheel / 120)))
  gfx.mouse_wheel = 0
  local values = api.read(binding)
  for row = 1, rows do
    local d = defs[row + scroll]
    if d then
      d = api.parameter_display(d, values)
      local value = values[d.id]
      local label = d.options and d.options[math.floor(value) + 1] or string.format('%.6g %s', value, d.unit)
      button(12, 95 + (row - 1) * 30, gfx.w - 24, d.name .. '  =  ' .. tostring(label), clicked, function()
        if d.file then status = 'Use the native JSFX file selector for this local Data directory.'; return end
        if d.readonly then status = d.name .. ' is a status display written by the JSFX.'; return end
        if d.options then
          local items = {}; for i, name in ipairs(d.options) do items[#items + 1] = { name = name, value = i - 1 } end
          local p = menu(items); if p then run(function() api.apply(binding, { [d.id] = p.value }) end) end
        else
          local bounds = d.suggested_min and ('suggested ' .. d.suggested_min .. '..' .. d.suggested_max .. '; fine step ' .. d.fine_step)
            or (d.min .. '..' .. d.max)
          local accepted, text = reaper.GetUserInputs(d.name .. ' (' .. bounds .. ' ' .. d.unit .. ')', 1, d.id, tostring(value))
          if accepted then run(function() api.apply(binding, { [d.id] = assert(tonumber(text), 'Expected a number') }) end) end
        end
      end)
    end
  end
  gfx.set(0.85, 0.88, 0.93); gfx.x = 12; gfx.y = gfx.h - 48; gfx.drawstr(status)
  gfx.x = 12; gfx.y = gfx.h - 25; gfx.drawstr('Real units / tuning preserved in presets / scroll to see more parameters')
  gfx.update()
  reaper.defer(loop)
end
loop()
