// Render the timbre checks without REAPER or an audio device.
// node scripts/timbre-audition.js [--baseline /path/to/older/checkout] [--out /path/to/output]
// The baseline is a checkout / git archive, never the text of a review document.
import { mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { encodeWav } from '../src/lib/audiofile.js';
import { integratedLoudness } from '../src/lib/loudness.js';
import { presetToJson } from '../src/lib/presets.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SR = 48000;
const value = (flag) => { const i = process.argv.indexOf(flag); if (i < 0) return null;
  if (!process.argv[i + 1] || process.argv[i + 1].startsWith('--')) throw new Error(`${flag} needs a path`);
  return resolve(process.argv[i + 1]); };
const OUT = value('--out') ?? join(ROOT, '.cache', 'timbre-audition');
const baseline = value('--baseline');
const imp = (root, file) => import(pathToFileURL(join(root, file)).href);
async function load(root) {
  const [compare, phys, synth, helpers] = await Promise.all([
    imp(root, 'scripts/jsfx-compare.js'), imp(root, 'src/presets/phys.js'),
    imp(root, 'src/presets/synth.js'), imp(root, 'src/lib/presets.js'),
  ]);
  return { ...compare, ...helpers, phys: phys.PHYS_PRESETS, synth: synth.SYNTH_PRESETS };
}
const versions = [['after', await load(ROOT)]];
if (baseline) versions.unshift(['before', await load(baseline)]);
mkdirSync(OUT, { recursive: true });
const specs = [
  ['Sitar', 'phys', 'string'], ['Shamisen', 'phys', 'string'],
  ['Accordion', 'phys', 'reed'], ['Bandoneon', 'phys', 'reed'],
  ['Harmonica', 'phys', 'reed'], ['Reed Organ', 'phys', 'reed'],
  ['Helicopter', 'synth', 'continuous-fx'], ['Applause', 'synth', 'continuous-fx'],
  ['Gunshot', 'synth', 'shot'],
];
function phrase(group) {
  const events = [], sections = [];
  const ev = (t, status, a, b) => events.push([Math.round(t * SR), status, a, b]);
  const note = (t, length, n, vel = 100) => { ev(t, 0x90, n, vel); ev(t + length, 0x80, n, 0); };
  const section = (time, label) => sections.push({ time, label });
  let seconds;
  if (group === 'string') {
    seconds = 43;
    section(0, '音域: MIDI 40 / 52 / 64 / 76');
    [40, 52, 64, 76].forEach((n, i) => note(.25 + 3 * i, 1.8, n));
    section(12, '強弱: velocity 40 / 80 / 120');
    [40, 80, 120].forEach((v, i) => note(12 + 2 * i, 1, 60, v));
    section(18, '連打');
    for (let i = 0; i < 8; i++) note(18 + .45 * i, .18, 62, i % 2 ? 95 : 110);
    section(22, 'フレーズ');
    [50, 57, 60, 62, 65, 69, 74, 69, 65, 62, 60, 57].forEach((n, i) => note(22 + .4 * i, .34, n, 95));
    section(28, 'CC64: note-off 29秒 / pedal-off 31秒');
    ev(28, 0xb0, 64, 127); for (const n of [50, 57, 62]) note(28, 1, n); ev(31, 0xb0, 64, 0);
    section(34, '余韻: note-off 38秒'); note(34, 4, 64);
  } else if (group === 'reed') {
    seconds = 22;
    section(0, '音域: MIDI 28 / 36 / 48 / 60 / 72');
    [28, 36, 48, 60, 72].forEach((n, i) => note(2 * i, 1.6, n));
    section(10, '低音の強弱: velocity 40 / 80 / 120');
    [40, 80, 120].forEach((v, i) => note(10 + 1.6 * i, 1.1, 36, v));
    section(15, 'フレーズと低音の余韻');
    [50, 53, 57, 60].forEach((n, i) => note(15 + .6 * i, .8, n)); note(18, 1.5, 36);
  } else if (group === 'shot') {
    seconds = 12;
    section(0, 'キーを3秒保持: 1発だけ鳴るか'); note(0, 3, 48);
    section(3.5, '同じキーを連打'); for (let i = 0; i < 6; i++) note(3.5 + .25 * i, .1, 48);
    section(6.5, '別のキー / velocity 120と余韻'); note(6.5, 1, 76, 120);
  } else {
    seconds = 12;
    section(0, 'MIDI 48を4秒保持'); note(0, 4, 48);
    section(5, 'MIDI 76を4秒保持: 音高への依存を比較'); note(5, 4, 76);
    section(9, 'note-off後の余韻');
  }
  events.sort((a, b) => a[0] - b[0] || (a[1] === 0x80 ? -1 : 0) - (b[1] === 0x80 ? -1 : 0));
  return { events, seconds, sections };
}
function midi({ events, sections, seconds }) {
  const vlq = (n) => { const a = [n & 127]; while ((n >>= 7) > 0) a.unshift((n & 127) | 128); return a; };
  const chunk = (tag, data) => [...Buffer.from(tag), (data.length >>> 24) & 255,
    (data.length >>> 16) & 255, (data.length >>> 8) & 255, data.length & 255, ...data];
  const meta = (type, text) => { const b = [...Buffer.from(text)]; return [0xff, type, ...vlq(b.length), ...b]; };
  const track = (ev) => { ev.sort((a, b) => a[0] - b[0]); const data = []; let last = 0;
    for (const [tick, bytes] of ev) { data.push(...vlq(tick - last), ...bytes); last = tick; }
    data.push(...vlq(seconds * 960 - last), 0xff, 0x2f, 0); return chunk('MTrk', data); };
  const tempo = [[0, [0xff, 0x51, 3, 7, 161, 32]],
    ...sections.map(s => [Math.round(s.time * 960), meta(6, s.label)])];
  return Buffer.from([...chunk('MThd', [0, 1, 0, 2, 1, 224]), ...track(tempo),
    ...track(events.map(e => [Math.round(e[0] / SR * 960), e.slice(1)]))]);
}
let revision = 'unknown';
let workingTreeDirty = true;
try { revision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim(); } catch {}
try { workingTreeDirty = execFileSync('git', ['status', '--porcelain', '--untracked-files=no'], { cwd: ROOT, encoding: 'utf8' }).trim().length > 0; } catch {}
const manifest = { revision, workingTreeDirty, sampleRate: SR, baselineDirectory: baseline, items: [] };
const pending = [];
for (const [name, kind, group] of specs) {
  const id = name.toLowerCase().replaceAll(' ', '-'), performance = phrase(group);
  writeFileSync(join(OUT, `${id}.mid`), midi(performance));
  writeFileSync(join(OUT, `${id}-events.json`), JSON.stringify({ sampleRate: SR, ...performance }, null, 2));
  for (const [version, core] of versions) {
    const preset = core[kind].find(p => p.name === name);
    if (!preset) throw new Error(`${version}: missing ${name}`);
    const inst = core.INSTRUMENTS[kind], params = core.resolvePreset(inst.defs, preset);
    writeFileSync(join(OUT, `${id}-${version}.json`), presetToJson(kind, `${name} (${version})`, inst.defs, params));
    const audio = core.renderJs(inst, params, performance.events, SR, performance.seconds * SR);
    const l = new Float32Array(audio.length / 2), r = new Float32Array(l.length); let peak = 0;
    for (let i = 0; i < l.length; i++) {
      l[i] = audio[2 * i]; r[i] = audio[2 * i + 1];
      if (!Number.isFinite(l[i]) || !Number.isFinite(r[i])) throw new Error(`${name}: non-finite audio`);
      peak = Math.max(peak, Math.abs(l[i]), Math.abs(r[i]));
    }
    const lufs = integratedLoudness(l, r, SR);
    if (!Number.isFinite(lufs) || peak === 0) throw new Error(`${name}: silent render`);
    const file = `${id}-${version}-original.wav`;
    writeFileSync(join(OUT, file), encodeWav(l, r, SR));
    const row = { id, name, kind, group, version, seconds: performance.seconds, sections: performance.sections,
      originalFile: file, originalLufs: lufs, originalPeakDb: 20 * Math.log10(peak) };
    manifest.items.push(row); pending.push({ row, l, r, peak });
    console.log(`${version.padEnd(6)} ${name.padEnd(12)} ${lufs.toFixed(2)} LUFS`);
  }
}
manifest.matchedTargetLufs = Math.min(-20, ...pending.map(p => p.row.originalLufs - 1 - 20 * Math.log10(p.peak)));
for (const p of pending) {
  const gainDb = manifest.matchedTargetLufs - p.row.originalLufs, gain = 10 ** (gainDb / 20);
  p.row.appliedGainDb = gainDb; p.row.matchedFile = `${p.row.id}-${p.row.version}-matched.wav`;
  writeFileSync(join(OUT, p.row.matchedFile), encodeWav(p.l, p.r, SR, gain));
}
writeFileSync(join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2));
const f = (x) => x.toFixed(2);
let report = `# 音色改善の比較音源\n\n基準HEAD: ${revision}（レンダー時の作業ツリーを使用）。beforeは指定された旧チェックアウト、afterはこのスクリプトのあるチェックアウトです。音色の自然さについての聴感評価は未実施です。\n\nlisten.htmlをブラウザーで開いてください。A/Bは同じ再生位置へ切り替わります。通常は音量を揃えて音色を比較し、元音量でプリセットの実際のレベル差も確認してください。\n\n48 kHz / stereo / 16-bit PCM。同一イベント、同じ乱数初期値。全体への一定ゲインで ${f(manifest.matchedTargetLufs)} LUFSへ調整（16-bit化後のゲート差で小差はあり得ます）。強弱・減衰は圧縮していません。sample peak -1 dBFS以下、true peak未測定。短い効果音のLUFS一致は知覚上の音量一致を保証しません。\n\n| 音色 / 版 | 元LUFS | 元sample peak dBFS | 比較ゲインdB |\n|---|---:|---:|---:|\n`;
for (const r of manifest.items) report += `| ${r.name} / ${r.version} | ${f(r.originalLufs)} | ${f(r.originalPeakDb)} | ${f(r.appliedGainDb)} |\n`;
report += '\nMIDIにProgram Changeは含めていません。REAPERでは音色を明示的に選択してください。各JSONはWebのプリセット読み込み用です。弦の試奏は最初の比較セットと同じ43秒です。フリーリードは低音から高音、低音の強弱、フレーズを含む22秒。Helicopter/Applauseは2つのキーを保持する12秒。Gunshotは保持・連打・別のキーを含む12秒。\n\n音色・版・秒数と、気になる症状を記録して次の調整に使ってください。音源はJavaScript DSPでレンダーしています。FXは録音サンプルではなく合成による近似です。\n';
writeFileSync(join(OUT, 'README.md'), report);
writeFileSync(join(OUT, 'listen.html'), `<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>AmiSynth 音色改善の比較</title>
<style>body{font:16px system-ui,sans-serif;background:#111922;color:#e4edf5;max-width:900px;margin:32px auto;padding:0 20px}h1{font-size:26px}.panel{background:#1b2836;border:1px solid #3a4e62;border-radius:14px;padding:22px;margin:20px 0}button,select,textarea{font:inherit;background:#111c28;color:inherit;border:1px solid #5f7c92;border-radius:8px;padding:10px;margin:4px}button{cursor:pointer}button.active{border-color:#89dfb4;background:#244a3e}audio,textarea{width:100%;box-sizing:border-box}textarea{min-height:110px;margin:4px 0}a{color:#a1e3c4}.muted{color:#aec1d2;font-size:14px;line-height:1.8}#sections button{font-size:13px}</style>
<h1>AmiSynth 音色改善の比較</h1><p class="muted">比較基準の音色と、このチェックアウトの音色。音量を揃えた比較と、元の出力レベルを切り替えられます。</p><div class="panel"><label for="sound">音色</label><select id="sound">${specs.map(([n]) => `<option value="${n.toLowerCase().replaceAll(' ', '-')}">${n}</option>`).join('')}</select><label for="level">比較条件</label><select id="level"><option value="matched">音量を揃える</option><option value="original">元の音量</option></select><div><button id="before">A · 修正前</button><button id="after">B · 修正後</button></div><p id="detail" class="muted"></p><audio id="audio" controls preload="metadata"></audio><p id="error" role="alert"></p><div id="sections"></div><p><a id="wav" download>選択中のWAV</a> · <a id="midi" download>試奏MIDI</a> · <a id="preset" download>プリセットJSON</a></p></div>
<div class="panel"><label for="notes">試聴メモ（音色・A/B・秒数・症状）</label><textarea id="notes" placeholder="例: Accordion / B / 0–2秒 / 低音のノイズは改善したが、もう少し息の成分がほしい"></textarea><button id="save">メモを書き出す</button></div><p class="muted">合成によるFX音源です。聴感の判断はこれからです。<a href="README.md">条件・測定表</a></p>
<script>const data=${JSON.stringify(manifest)};const $=id=>document.getElementById(id),audio=$('audio');let version=data.items.some(r=>r.version==='before')?'before':'after',loadId=0,pending=null;audio.volume=.7;
function update(time=audio.currentTime||0,resume=!audio.paused){const id=$('sound').value,row=data.items.find(r=>r.id===id&&r.version===version),level=$('level').value,token=++loadId;pending=time;for(const v of ['before','after']){$(v).disabled=!data.items.some(r=>r.id===id&&r.version===v);$(v).classList.toggle('active',v===version)}const file=level==='matched'?row.matchedFile:row.originalFile;$('detail').textContent=row.name+' / '+(version==='before'?'修正前':'修正後')+' / '+row.seconds+'秒 / 元 '+row.originalLufs.toFixed(1)+' LUFS'+(level==='matched'?' → 比較用 '+data.matchedTargetLufs.toFixed(1)+' LUFS':'');$('wav').href=file;$('midi').href=id+'.mid';$('preset').href=id+'-'+version+'.json';$('sections').replaceChildren();for(const s of row.sections){const b=document.createElement('button');b.textContent=s.time+'秒 · '+s.label;b.onclick=()=>{if(audio.readyState){audio.currentTime=s.time;audio.play().catch(()=>{})}else update(s.time,true)};$('sections').append(b)}$('error').textContent='';audio.onloadedmetadata=()=>{if(token!==loadId)return;audio.currentTime=Math.min(time,Math.max(0,audio.duration-.05));pending=null;if(resume)audio.play().catch(()=>{$('error').textContent='再生ボタンを押してください。'})};audio.src=file;audio.load()}
for(const v of ['before','after'])$(v).onclick=()=>{version=v;update(pending??audio.currentTime,!audio.paused)};$('sound').onchange=()=>update(0,!audio.paused);$('level').onchange=()=>update(pending??audio.currentTime,!audio.paused);audio.onerror=()=>{$('error').textContent='音源を読み込めません。ZIPをすべて展開し、WAVとこのページを同じ場所に置いてください。'};
$('save').onclick=()=>{const url=URL.createObjectURL(new Blob([JSON.stringify({revision:data.revision,notes:$('notes').value},null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='timbre-listening-notes.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)};update(0,false);</script></html>`);
console.log(`Listening pack: ${OUT}; matched target ${manifest.matchedTargetLufs.toFixed(2)} LUFS`);
