# JSFX 移植メモ

JS 側の DSP は JSFX に機械的に移せるよう、次の規約で書かれています。

| JS (`src/dsp/*`)                                   | JSFX / EEL2                                                     |
| -------------------------------------------------- | --------------------------------------------------------------- |
| `lib.js`                                           | `amisynth_lib.jsfx-inc` (シンセ・ドラムから `import`)            |
| `foo_process(o, x)` と `o.state`                    | `function foo_process(x) instance(state) ( ... );`               |
| `foo_process(v.filt1, x)`                          | `v1.filt1.foo_process(x)` (名前空間)                              |
| `synth_init(s, sr)`                                | `@init` (`sr` → `srate`)                                         |
| `synth_update(s, p)`                               | `@slider` (`p.xxx` → slider 変数 `xxx`)                          |
| `synth_midi(s, status, d1, d2)`                    | `@block` 内 `while (midirecv(ofs, msg1, msg2, msg3)) (...)`      |
| `synth_render(s)` → `s.out_l / s.out_r`            | `@sample` → `spl0 / spl1`                                        |
| `noise_white()`                                    | `rand(2) - 1`                                                    |
| `Math.sin/exp/pow/tan/floor`                       | `sin/exp/pow/tan/floor`                                          |
| `s.voices[i]` (8 ボイス)                            | `v0..v7` の名前空間、または `voice_base + i * VOICE_SIZE` のメモリ |
| `tuning.table` (Float64Array)                      | メモリブロック (例 `scale_table = 1024;`)                         |

## slider 宣言

`npm run gen:jsfx` で `src/dsp/params.js` から生成されます。

- `generated/synth-sliders.txt` — シンセ用 (変数名 = パラメータ ID)
- `generated/drums-sliders.txt` — ドラム用
- `generated/params.json` — 全パラメータの説明付きマニフェスト (LLM / MCP 向け)
- `generated/presets.json` — 内蔵プリセットを slider 順の値の配列に展開したもの (.rpl 生成用)

`:log` (対数スライダー) は REAPER 6.74 以降の構文です。

## 注意点

- MIDI オフセット: JSFX では `@block` で受け取った `ofs` を使ってサンプル位置を合わせる
  (worklet 版は `processor-base.js` がフレーム番号で同等のことをしている)。
- カスタム音階: JSFX ではスライダーで EDO を指定し、カスタム表は `@serialize` か
  ファイル (`file_open`) から読み込む想定。
