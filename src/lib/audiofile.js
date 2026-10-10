// WAV (16-bit PCM) and MP3 (lamejs, loaded only when needed) encoders for the audio export.

function toInt16(x, gain) {
  const v = Math.max(-1, Math.min(1, x * gain));
  return v < 0 ? Math.round(v * 32768) : Math.round(v * 32767);
}

/** @returns {Uint8Array} 16-bit stereo PCM WAV */
export function encodeWav(left, right, sampleRate, gain = 1) {
  const n = left.length;
  const buf = new ArrayBuffer(44 + n * 4);
  const v = new DataView(buf);
  const str = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF');
  v.setUint32(4, 36 + n * 4, true);
  str(8, 'WAVEfmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 2, true); // stereo
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 4, true);
  v.setUint16(32, 4, true);
  v.setUint16(34, 16, true);
  str(36, 'data');
  v.setUint32(40, n * 4, true);
  for (let i = 0, o = 44; i < n; i++, o += 4) {
    v.setInt16(o, toInt16(left[i], gain), true);
    v.setInt16(o + 2, toInt16(right[i], gain), true);
  }
  return new Uint8Array(buf);
}

/** @returns {Promise<Uint8Array>} stereo constant-bitrate MP3 */
export async function encodeMp3(left, right, sampleRate, kbps = 192, gain = 1, onProgress = () => {}) {
  const { Mp3Encoder } = await import('@breezystack/lamejs');
  const enc = new Mp3Encoder(2, sampleRate, kbps);
  const BLOCK = 1152;
  const l = new Int16Array(BLOCK);
  const r = new Int16Array(BLOCK);
  const parts = [];
  let size = 0;
  const push = (out) => {
    if (out.length === 0) return;
    parts.push(new Uint8Array(out));
    size += out.length;
  };
  for (let i = 0; i < left.length; i += BLOCK) {
    const m = Math.min(BLOCK, left.length - i);
    for (let j = 0; j < m; j++) {
      l[j] = toInt16(left[i + j], gain);
      r[j] = toInt16(right[i + j], gain);
    }
    push(enc.encodeBuffer(l.subarray(0, m), r.subarray(0, m)));
    if ((i / BLOCK) % 200 === 0) onProgress(i / left.length);
  }
  push(enc.flush());
  const all = new Uint8Array(size);
  let o = 0;
  for (const p of parts) {
    all.set(p, o);
    o += p.length;
  }
  return all;
}
