// Runs the JSFX-vs-JS comparison (tests/jsfx.test.js) through ysfx-s, the JSFX host inside the
// VST3 / CLAP / AU plugin used outside REAPER. Build it first: npm run jsfx:tools:ysfx-s
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(import.meta.url), '..', '..');
const exe = (name) => join(root, '.cache', process.platform === 'win32' ? `${name}.exe` : name);
const render = exe('jsfx_render_s');
if (!existsSync(render)) {
  console.error(`${render} not found: run npm run jsfx:tools:ysfx-s first`);
  process.exit(1);
}
const env = { ...process.env, JSFX_RENDER: render, JSFX_METER_CHECK: exe('jsfx_meter_check_s'), AMISYNTH_JSFX_HOST: 'ysfx-s' };
const r = spawnSync(process.execPath, ['--test', join(root, 'tests', 'jsfx.test.js')], { stdio: 'inherit', env });
process.exit(r.status ?? 1);
