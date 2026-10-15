import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RPL_FILES, rplPresetName, rplSkips, rplText } from '../scripts/gen-jsfx-sliders.js';
import { resolvePreset } from '../src/lib/presets.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Minimal reader of REAPER's .rpl: [{ name, tokens }] with the decoded slider line split like LineParser. */
function parseRpl(text) {
  const lines = text.trim().split('\n');
  assert.match(lines[0], /^<REAPER_PRESET_LIBRARY `JS: AmiSynth\/AmiSynth \w+\.jsfx`$/);
  assert.equal(lines.at(-1), '>');
  const presets = [];
  for (let i = 1; i < lines.length - 1; i++) {
    const m = /^ {2}<PRESET `(.*)`$/.exec(lines[i]);
    assert.ok(m, `line ${i}: ${lines[i]}`);
    let b64 = '';
    while (lines[++i] !== '  >') b64 += lines[i].trim();
    const blob = Buffer.from(b64, 'base64').toString('utf8');
    assert.ok(blob.endsWith('\0'), 'slider line is NUL-terminated (no @serialize data)');
    const tokens = blob.slice(0, -1).match(/`[^`]*`|\S+/g);
    presets.push({ name: m[1], tokens });
  }
  return presets;
}

test('.rpl preset libraries match the built-in presets and are up to date', () => {
  for (const [file, defs, presets] of RPL_FILES) {
    const text = readFileSync(join(root, 'jsfx', `${file}.rpl`), 'utf8');
    assert.equal(text, rplText(file, defs, presets), `${file}.rpl is stale: run npm run gen:jsfx`);
    const parsed = parseRpl(text);
    assert.equal(parsed.length, presets.length);
    parsed.forEach((p, k) => {
      assert.equal(p.name, rplPresetName(presets[k]));
      // 64 sliders, the name, then sliders 65-256 (REAPER 6.74+ layout)
      assert.equal(p.tokens.length, 64 + 1 + 192);
      assert.equal(p.tokens[64], '`' + p.name + '`');
      const sliders = [...p.tokens.slice(0, 64), ...p.tokens.slice(65)];
      const want = resolvePreset(defs, presets[k]);
      sliders.forEach((tok, i) => {
        if (i >= defs.length || rplSkips(defs[i])) return assert.equal(tok, '-', `${file} ${p.name} slider${i + 1}`);
        assert.ok(Math.abs(Number(tok) - want[defs[i].id]) < 1e-5, `${file} ${p.name} ${defs[i].id}: ${tok}`);
      });
    });
    assert.equal(new Set(parsed.map((p) => p.name)).size, parsed.length, 'preset names are unique');
  }
});

test('.rpl presets leave the tuning sliders alone', () => {
  const [, defs] = RPL_FILES[0];
  const skipped = defs.filter(rplSkips).map((d) => d.id);
  assert.ok(skipped.includes('tuning_divisions') && skipped.includes('tuning_source') && skipped.includes('tuning_slot'));
});
