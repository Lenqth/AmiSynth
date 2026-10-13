# AmiSynth JSFX (REAPER)

ブラウザ版の DSP(`src/dsp/*.js`)を EEL2 に移植した、REAPER 用の JSFX 楽器です。
音は Web 版と**サンプル単位で同一**になっていて、自動テストでそれを確認しています(後述)。

| ファイル | 内容 |
| --- | --- |
| `AmiSynth Synth.jsfx` | 8 ボイスの減算式シンセ。2 オシレーター、シンク / FM、ユニゾン (最大 9)、LP / HP / BP / ノッチのフィルター、テンポ同期できる LFO、グライド、Mono / Legato、トランスポーズ、アルペジエーター、周期ノイズ、CC でのカットオフ。スライダー 84 本 |
| `AmiSynth Physical.jsfx` | 物理モデル音源。弦(Karplus-Strong)、モーダル合成(8 モード × 11 素材。ゴング系を含む)、擦弦、管楽器(クラリネット / フルート)、2D 膜 / 板、硬い弦(ピアノ)、金管。ギターアンプ付き。スライダー 58 本 |
| `AmiSynth Drums.jsfx` | 合成ドラム 13 パーツ(GM 配置)。パーツ別出力つき(10 ch)。スライダー 78 本 |
| `amisynth_lib.jsfx-inc` | 共通 DSP。上の 3 つすべてが `import` します |

## インストール

1. REAPER のメニューで **Options → Show REAPER resource path** を開きます。
2. `Effects/AmiSynth/` フォルダを作り、上の 4 ファイルをすべてコピーします。
3. トラックの FX に「JS: AmiSynth Synth」などを追加し、MIDI を入力します。
   - Web 版のピアノロールにある「MIDI 書き出し」で作った `.mid` をそのまま使えます(メロディ ch1、ドラム ch10)。
   - 1 トラック目のメロディは、Synth か Physical のトラックに置いてください。

- **REAPER 6.74 以降が必要です。** Synth(84 本)と Drums(78 本)は、64 本を超えるスライダーを使います。
- スライダー変数名は `src/dsp/params.js` の id と同じです(例: `filter_cutoff_hz`, `kick_decay_ms`)。REAPER のオートメーションや MCP 経由の操作でも、名前を見れば意味が分かるようにしています。
- **スライダーの値は実値です**(Hz・ms・dB など)。対数シェイプ(`:log`)を付けると、REAPER の API / オートメーションでは値が自然対数で扱われるため(`ln(1800) = 7.4955` を書く必要がある)、あえて付けていません。MCP からは「カットオフ 2000 Hz」をそのまま `2000` と書けます。REAPER 標準のスライダー UI では目盛りが線形になります。
- 後から追加したスライダーは末尾に並べています。古いバージョンで保存したプロジェクトも、スライダー番号がずれません。

### テンポ同期(アルペジエーター・LFO)

- Synth は REAPER のテンポと拍位置(`tempo` / `beat_position`)に合わせて動きます。再生中は毎ブロック拍位置を合わせ直すので、ステップや LFO の周期はプロジェクトの小節線に揃います。停止中は直前のテンポで拍を数え続けるため、鍵盤で弾いてもアルペジオが鳴ります。
- アルペジエーター(`arp_mode` ≠ Off)は押さえている鍵を受け取り、`arp_rate` ごとに 1 音(Chord モードでは和音全体)を鳴らします。ステップ k は拍 `k × 音価` から始まり(偶数番目以外は `arp_swing_percent` の分だけ遅れる)、`arp_step_1..16` が Off のステップは休符になります。パターン長は `arp_steps` で、拍 0 を 1 ステップ目として数えます。
- `transpose_semitones` は鍵盤からのノート番号に足されます(12 平均律以外では音階のステップ数)。ノートオンの時点で決まり、鳴っている音はその音程のまま正しくノートオフされます。アルペジエーターを通る音は、次のステップから新しい値で鳴ります。
- サイドチェインなしのポンピング: `lfo_waveform` = Duck、`lfo_sync` = 1/4、`lfo_amp`(トレモロの深さ)を上げます。

### 共通の調律ファイル(微分音の曲)

- `tuning_source` を **Scale file** にすると、EDO のスライダーの代わりに `REAPER/Data/AmiSynth/tuning.txt`(中身は Scala .scl 形式)を読みます。Synth と Physical の両方で使えます。
- 同じファイルを全トラックが参照するので、ファイルを書き換えれば全トラックの音階が変わります。読み直しは、再生開始時(REAPER が @init を実行するとき)か、そのインスタンスのスライダーを動かしたときです。
- 拡張子が `.txt` なのは、JSFX がテキストとして読めるのが `.txt` だけだからです。`.scl` ファイルは名前を変えて置いてください。Web 版のチューニング欄の「tuning.txt を書き出し」でも作れます。
- 書式: `!` で始まる行はコメント。説明の行、音の数、1 行 1 音(`.` を含めば cents、それ以外は `3/2` のような比か整数)。最後の音が周期です。
- 基準ノート / 基準周波数(`tuning_ref_note` / `tuning_ref_hz`)はスライダーの値を使います。ファイルが読めないときは EDO のスライダーに戻ります。
- 確認は ysfx 上だけです(REAPER の Data フォルダからの相対パスで開く、という REAPER の仕様に合わせています)。

### MIDI CC でカットオフ

- Synth は `cc_cutoff_number`(既定 74)の CC でカットオフを動かします。CC 64 で変化なし、0 / 127 で `cc_cutoff_depth_oct` オクターブ下 / 上です。REAPER の MIDI CC レーンや、オートメーションを書きにくい MCP ツールからの操作に使えます。0 にすると無効です。

### Drums のパーツ別出力

| ピン | 内容 |
| --- | --- |
| 1/2 | メインミックス |
| 3/4 | キック |
| 5/6 | スネア・クラップ・リムショット |
| 7/8 | ハイハット(クローズ / オープン)・クラッシュ・ライド |
| 9/10 | タム 3 つ・カウベル・シェイカー |

- 3〜10 は常に出力されます。トラックのチャンネル数を 10 にし、使いたいペアをセンドやピン設定でほかのトラックへ送ってください(例: キック 3/4 だけをパッドのサイドチェイン入力へ)。
- `kick_bus_in_main` などを Off にすると、そのグループはメインミックス(1/2)に入らず、専用の出力にだけ出ます。パーツ別に EQ やコンプをかけたいときに使います。
- Web 版はメインミックスだけを鳴らします(Off のグループはメインから外れます)。

### 制限

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
- `jsfx_render` は出力ピンの数だけチャンネルを書き出します(Drums は 10 ch をすべて比較)。スクリプトの `tempo <bpm> <再生中 0|1>` で、ホストのテンポと再生状態を、`dataroot <dir>` で REAPER の Data フォルダを与えられます。
- 比較するシナリオは次のとおりです。
  - Synth の全プリセット + 負荷の高い設定(ユニゾン・FM・シンク・S&H・19 平均律)
  - Synth のアルペジエーター全モード(再生中 / 停止中、スウィング、リズムゲート、Legato + ゲート 1、トランスポーズ、Chord + 19 平均律)
  - Synth の Mono / Legato、グライド(レガート時のみ)、9 声ユニゾン(カーブ・外側の音量)、テンポ同期 LFO(Duck・S&H・付点)
  - Synth の周期ノイズ / S&H ノイズとノイズフィルター、CC74 / CC71 でのカットオフ
  - 共通の調律ファイル(コメント・比・cents・整数を含む Scala、CRLF 改行)を Synth / Physical が読むこと、ファイルがないときの EDO への切り替え
  - Physical のゴング系素材、ギターアンプの全タイプ(ゲインとトーンの両端、44.1 kHz も)
  - Physical の全プリセット + 負荷の高い設定(全モデルでビブラート・発音数超過・44.1 kHz、メッシュの全形状)
  - Drums の全キット × 全パーツ(チョークを含む)、メインミックスから外したグループ
  - 演奏データにはピッチベンド、モジュレーションホイール、サステインペダル、レガートを含めています
- 合格基準は SNR が 100 dB を超えることです。現在の結果は約 150 dB(float32 の量子化誤差程度)です。
- `jsfx_render` がない環境(Cloudflare のビルドなど)では、このテストは自動でスキップされます。
