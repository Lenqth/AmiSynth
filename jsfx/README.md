# AmiSynth JSFX (REAPER)

ブラウザ版の DSP(`src/dsp/*.js`)を EEL2 に移植した、REAPER 用の JSFX 楽器です。
音は Web 版と**サンプル単位で同一**になっていて、自動テストでそれを確認しています(後述)。

| ファイル | 内容 |
| --- | --- |
| `AmiSynth Synth.jsfx` | 8 ボイスの減算式シンセ。2 オシレーター、シンク / FM、ユニゾン、LP / HP / BP / ノッチのフィルター、LFO、グライド。スライダー 49 本 |
| `AmiSynth Physical.jsfx` | 物理モデル音源。弦(Karplus-Strong)、モーダル合成(8 モード × 8 素材)、擦弦、管楽器(クラリネット / フルート)、2D 膜 / 板、硬い弦(ピアノ)。スライダー 46 本 |
| `AmiSynth Drums.jsfx` | 合成ドラム 13 パーツ(GM 配置)。スライダー 74 本 |
| `amisynth_lib.jsfx-inc` | 共通 DSP。上の 3 つすべてが `import` します |

## インストール

1. REAPER のメニューで **Options → Show REAPER resource path** を開きます。
2. `Effects/AmiSynth/` フォルダを作り、上の 4 ファイルをすべてコピーします。
3. トラックの FX に「JS: AmiSynth Synth」などを追加し、MIDI を入力します。
   - Web 版のピアノロールにある「MIDI 書き出し」で作った `.mid` をそのまま使えます(メロディ ch1、ドラム ch10)。
   - 1 トラック目のメロディは、Synth か Physical のトラックに置いてください。

- **REAPER 6.74 以降が必要です。** Drums はスライダーが 74 本あり、64 本を超えるスライダーは 6.74 以降でないと扱えません。
- スライダー変数名は `src/dsp/params.js` の id と同じです(例: `filter_cutoff_hz`, `kick_decay_ms`)。REAPER のオートメーションや MCP 経由の操作でも、名前を見れば意味が分かるようにしています。

### 制限

- チューニングは EDO(1 周期を何等分するか + 周期の大きさ)のみ対応です。Scala やカスタム音階の表は、今のところ Web 版だけの機能です。
- Physical の可視化は Web 版だけの機能です。
- プリセットは `generated/presets.json` に、スライダー順に並べた値として出力しています。REAPER のプリセットファイル(`.rpl`)にはまだ変換していません。

## JS → EEL2 の対応

| JS (`src/dsp/*`) | JSFX / EEL2 |
| --- | --- |
| `foo_process(o, x)` と `o.state` | `o.foo_process(x)` / `function foo_process(x) instance(state)` |
| `synth_init` / `synth_update` | `@init` / `@slider`(`p.xxx` → スライダー変数 `xxx`) |
| 時刻付き MIDI(worklet) | `@block` の `midi_queue_read()` でキューに積み、`@sample` の `midi_pop()` で発音タイミングどおりに取り出す |
| `synth_render(s)` → `out_l / out_r` | `@sample` → `spl0 / spl1` |
| `s.voices[i]` | 名前空間 `v0..v7` + `vcall(i, op, …)` による振り分け(EEL2 では名前空間を配列にできないため) |
| 遅延線 / 音階表(Float64Array) | `mem_alloc()` で確保したメモリブロック |
| `noise_white()` | 同じ Park-Miller 線形合同法(倍精度演算のみで計算するので、JS と EEL2 で同じ乱数列になる) |

EEL2 の注意点:
- `==` は誤差を許す比較になるため、厳密な比較には `===` を使っています。
- `%` は整数演算です。
- `1e12` のような指数表記の数値リテラルは書けません。
- 変数名は大文字と小文字を区別しません(`MESH_W` と `mesh_w` は同じ変数になります)。

## スライダーの生成

`npm run gen:jsfx` を実行すると `src/dsp/params.js` から次を生成し、各 `.jsfx` の `// <generated sliders>` から `// </generated sliders>` までを書き換えます。

- `generated/*-sliders.txt`
- `generated/params.json`(全パラメータの説明付き一覧。LLM / MCP 向け)
- `generated/presets.json`

`.jsfx` 側の区間が生成結果と一致しているかどうかも、テストで確認しています。

## 検証(JS と JSFX のサンプル比較)

```sh
npm run jsfx:tools      # ysfx (https://github.com/jpcima/ysfx) を取得してビルドし、.cache/jsfx_render を作る
npm test                # tests/jsfx.test.js が JS と JSFX を同じ MIDI でレンダリングして比較する
npm run jsfx:compare    # 3 楽器の比較結果を表示する
```

- `tools/jsfx_render.cpp` は、ysfx を使ったオフラインのレンダラーです。スライダーの値と、時刻付きの MIDI を受け取ります。
- ysfx はスライダーを 64 本までしか扱えないため、65 本目以降は変数名で値を設定しています。
- 比較するシナリオは次のとおりです。
  - Synth の全プリセット + 負荷の高い設定(ユニゾン・FM・シンク・S&H・19 平均律)
  - Physical の全プリセット + 負荷の高い設定(全モデルでビブラート・発音数超過・44.1 kHz、メッシュの全形状)
  - Drums の全キット × 全パーツ(チョークを含む)
  - 演奏データにはピッチベンド、モジュレーションホイール、サステインペダル、レガートを含めています
- 合格基準は SNR が 100 dB を超えることです。現在の結果は約 150 dB(float32 の量子化誤差程度)です。
- `jsfx_render` がない環境(Cloudflare のビルドなど)では、このテストは自動でスキップされます。
