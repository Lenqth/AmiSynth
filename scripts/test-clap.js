// Runs the JSFX-vs-JS comparison (tests/jsfx.test.js) through the AmiSynth CLAP plugin, loaded by
// clap/tools/clap_render the way a DAW loads it. Build it first: npm run clap:build
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(import.meta.url), '..', '..');
const build = join(root, '.cache', 'clap-build');
const render = join(build, process.platform === 'win32' ? 'Release/clap_render.exe' : 'clap_render');
const plugin = join(build, process.platform === 'win32' ? 'Release/AmiSynth.clap' : 'AmiSynth.clap');
if (!existsSync(render) || !existsSync(plugin)) {
  console.error(`${render} or ${plugin} not found: run npm run clap:build first`);
  process.exit(1);
}
// the plugin writes its embedded JSFX under the user's data folder: keep the tests out of it
const home = mkdtempSync(join(tmpdir(), 'amisynth-clap-'));
const env = {
  ...process.env, JSFX_RENDER: render, JSFX_METER_CHECK: join(build, 'no-meter-check'), AMISYNTH_CLAP: plugin,
  AMISYNTH_JSFX_HOST: 'ysfx-s', XDG_DATA_HOME: home, LOCALAPPDATA: home, HOME: home,
};
const r = spawnSync(process.execPath, ['--test', join(root, 'tests', 'jsfx.test.js')], { stdio: 'inherit', env });
process.exit(r.status ?? 1);
