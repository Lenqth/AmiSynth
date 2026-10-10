// Web Worker: renders the pattern offline and encodes it, off the UI thread.
//   in:  { pattern, params, scaleCents, sampleRate, loops, format: 'wav' | 'mp3', normalize }
//   out: { type: 'progress', value } ... then { type: 'done', bytes, mime, peak, seconds } | { type: 'error', message }
import { renderPattern } from './render.js';
import { encodeMp3, encodeWav } from './audiofile.js';

self.onmessage = async (e) => {
  const o = e.data;
  try {
    const res = renderPattern(o, (f) => self.postMessage({ type: 'progress', value: f * 0.8 }));
    // normalise to -1 dBFS if asked; otherwise keep the level as played
    const gain = o.normalize && res.peak > 0 ? 0.891 / res.peak : 1;
    const bytes = o.format === 'mp3'
      ? await encodeMp3(res.left, res.right, res.sampleRate, 192, gain, (f) => self.postMessage({ type: 'progress', value: 0.8 + f * 0.2 }))
      : encodeWav(res.left, res.right, res.sampleRate, gain);
    self.postMessage({
      type: 'done', bytes, mime: o.format === 'mp3' ? 'audio/mpeg' : 'audio/wav',
      peak: res.peak * gain, seconds: res.left.length / res.sampleRate,
    }, [bytes.buffer]);
  } catch (err) {
    self.postMessage({ type: 'error', message: String(err?.message || err) });
  }
};
