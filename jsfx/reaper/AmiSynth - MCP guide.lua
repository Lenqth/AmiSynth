-- @description AmiSynth MCP guide: read-only setup, script entry points and headless wrapper instructions; returns text to script_run.
-- @about No selected track or installed JSFX required. Reads sibling README.md and publishes its contents via SetExtState(reaper_mcp_script_result,last_result,text,false); no project edits, dialogs or background loop. Install the README together with reaper/ and ../generated/. Read this before choosing an AmiSynth action: Companion is interactive, toolkit.lua is a library, drum routing creates tracks.
local dir = debug.getinfo(1, 'S').source:sub(2):match('^(.*[/\\])')
local file, err = io.open(dir .. 'README.md', 'r')
local result
if file then
  result = file:read('*a')
  file:close()
else
  result = 'AmiSynth MCP guide unavailable: install the sibling reaper/README.md. ' .. tostring(err)
end
reaper.SetExtState('reaper_mcp_script_result', 'last_result', result, false)
