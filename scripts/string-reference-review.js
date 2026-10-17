// Reproduce the 2026-10-17 reference-guided preset experiment without REAPER.
// node scripts/string-reference-review.js [output-directory]
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { audition, auditionMidi } from './preset-audition.js';
import { presetLoudness } from './preset-loudness.js';
import { PHYS_PRESETS } from '../src/presets/phys.js';
import { encodeWav } from '../src/lib/audiofile.js';

const out = resolve(process.argv[2] ?? '.cache/string-reference-review');
mkdirSync(out, { recursive: true });
// Explicit pre-change patches, using the unchanged legacy DSP path (Contact Gain = 1).
const before = {
  Shamisen: { phys_volume_db: 4.5, string_contact_gain: 1, string_decay_ms: 1800, string_pick_position: .05 },
  Sitar: { phys_volume_db: -3.1, string_brightness: .85, string_sawari: .65 },
};
const request = { sampleRate: 48000, seconds: 28, bpm: 120, eventUnit: 'seconds', events: [] };
const note = (t, n, velocity, length) => request.events.push([t, 0x90, n, velocity], [t + length, 0x80, n, 0]);
for (const [i, n] of [48, 60, 72].entries()) for (const [j, v] of [70, 100, 120].entries()) note(i * 6 + j * 2, n, v, 1.5);
for (let i = 0; i < 8; i++) note(18 + .35 * i, 60, i % 2 ? 80 : 110, .25);
note(22, 60, 100, 4);
// Existing default bend range is +/- 200 cents. Sympathetic strings stay fixed.
for (const [t, value] of [[22,8192],[22.5,8192],[23,10240],[23.5,12288],[24,16383],[24.5,12288],[25,8192],[26.1,8192]]) {
  request.events.push([t,0xe0,value & 127,value >> 7]);
}
request.events.sort((a,b) => a[0]-b[0]);
writeFileSync(join(out,'phrase.mid'), auditionMidi(request));
writeFileSync(join(out,'request.json'), JSON.stringify(request,null,2));
const results = [];
for (const name of ['Shamisen','Sitar']) {
  const preset = PHYS_PRESETS.find(p => p.name === name);
  const pair = ['before','after'].map(version => {
    const params = { ...preset.params, ...(version === 'before' ? before[name] : {}) };
    const audio = audition('phys',params,request);
    return { version, params, audio, canonicalLufs: presetLoudness('phys',{ params }) };
  });
  // One common LUFS target per pair; lower it if either sample peak would exceed -1 dBFS.
  const target = Math.min(-20, ...pair.map(p => p.audio.report.metrics.integratedLufs - 1 - p.audio.report.metrics.samplePeakDbfs));
  for (const p of pair) {
    const gainDb = target - p.audio.report.metrics.integratedLufs;
    const file = `${name}-${p.version}.wav`;
    writeFileSync(join(out,file), encodeWav(p.audio.left,p.audio.right,48000,10 ** (gainDb/20)));
    const rms = a => Math.sqrt(a.reduce((s,x)=>s+x*x,0)/a.length);
    const mono = p.audio.left.map((x,i)=>(x+p.audio.right[i])*.5);
    const notes = [48,60,72].map((note,i) => {
      const t=i*6+2, win=(a,b)=>rms(mono.subarray(Math.round((t+a)*48000),Math.round((t+b)*48000)));
      return { note, velocity:100, attackTailDb:20*Math.log10(win(.005,.025)/win(.08,.16)), fallDb:20*Math.log10(win(.6,.65)/win(.1,.15)) };
    });
    const report = { name,version:p.version,file,params:p.params,canonicalLufs:p.canonicalLufs,matchedTargetLufs:target,gainDb,notes,...p.audio.report };
    writeFileSync(join(out,`${name}-${p.version}.json`),JSON.stringify(report,null,2));
    results.push(report);
  }
}
writeFileSync(join(out,'summary.json'),JSON.stringify(results.map(({name,version,canonicalLufs,matchedTargetLufs,gainDb,notes})=>({name,version,canonicalLufs,matchedTargetLufs,gainDb,notes})),null,2));
writeFileSync(join(out,'listen.html'),`<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>三味線・シタール 比較</title>
<style>body{font:17px/1.7 system-ui;max-width:850px;margin:3rem auto;padding:0 1rem;background:#171923;color:#eee}article{padding:1rem;background:#252938;margin:1rem 0;border-radius:12px}audio{width:100%}button{padding:.5rem;margin:.3rem}a{color:#a8ceff}</style>
<h1>三味線・シタール：変更前後の比較</h1><p>JS参照DSP。同じMIDIとvelocity、各楽器の前後で全体LUFSを一致。sample peakは−1 dBFS以下。圧縮は加えていません。実楽器らしさは未判定です。</p>
<p>0–6秒：MIDI 48／6–12秒：60／12–18秒：72。各音域でvelocity 70→100→120。18秒：連打、22秒：ベンドと余韻。</p>
${['Shamisen','Sitar'].map(name=>`<article><h2>${name}</h2>${results.filter(p=>p.name===name).map(p=>`<p>${p.version==='before'?'変更前':'変更後'}（共通目標 ${p.matchedTargetLufs.toFixed(1)} LUFS）</p><audio controls preload="metadata" src="${p.file}"></audio><a href="${p.file}" download>WAVを保存</a>`).join('')}</article>`).join('')}
<p><a href="phrase.mid" download>比較MIDI</a> · <a href="summary.json">測定値</a> · <a href="request.json">演奏条件</a></p>
<script>const players=[...document.querySelectorAll('audio')];for(const a of players)a.addEventListener('play',()=>{for(const b of players)if(b!==a)b.pause()});</script></html>`);
console.log(JSON.stringify({ out, results:results.map(({name,version,canonicalLufs,notes})=>({name,version,canonicalLufs,notes})) },null,2));
