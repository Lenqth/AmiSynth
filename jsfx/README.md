# AmiSynth JSFX (REAPER)

ブラウザ版の DSP(`src/dsp/*.js`)を EEL2 に移植した、REAPER 用の JSFX 楽器です。
音は Web 版と**サンプル単位で同一**になっていて、自動テストでそれを確認しています(後述)。

| ファイル | 内容 |
| --- | --- |
| `AmiSynth Synth.jsfx` | 8 ボイスの減算式シンセ。2 オシレーター、シンク / FM、ユニゾン (最大 9)、LP / HP / BP / ノッチのフィルター、テンポ同期できる LFO、グライド、Mono / Legato、トランスポーズ、アルペジエーター、周期ノイズ、CC でのカットオフ。スライダー 85 本 |
| `AmiSynth Physical.jsfx` | 物理モデル音源。弦(Karplus-Strong)、モーダル合成(8 モード × 11 素材。ゴング系を含む)、擦弦、管楽器(クラリネット / フルート)、2D 膜 / 板、硬い弦(ピアノ)、金管。ギターアンプ付き。スライダー 59 本 |
| `AmiSynth Drums.jsfx` | 合成ドラム 13 パーツ(GM 配置)。パーツ別出力つき(10 ch)。スライダー 78 本 |
| `AmiSynth Tuning.jsfx` | 共通の音階を持つユーティリティ(音は出さず、オーディオと MIDI はそのまま通す)。Synth / Physical が Slot を指定して従う。スライダー 38 本 |
| `amisynth_lib.jsfx-inc` | 共通 DSP。上のすべてが `import` します |

## インストール

1. REAPER のメニューで **Options → Show REAPER resource path** を開きます。
2. `Effects/AmiSynth/` フォルダを作り、上の 5 ファイルと `amisynth_meter.jsfx-inc` をすべてコピーします。
3. トラックの FX に「JS: AmiSynth Synth」などを追加し、MIDI を入力します。
   - Web 版のピアノロールにある「MIDI 書き出し」で作った `.mid` をそのまま使えます(メロディ ch1、ドラム ch10)。
   - 1 トラック目のメロディは、Synth か Physical のトラックに置いてください。

- **REAPER 6.74 以降が必要です。** Synth(85 本)と Drums(78 本)は、64 本を超えるスライダーを使います。
- スライダー変数名は `src/dsp/params.js` の id と同じです(例: `filter_cutoff_hz`, `kick_decay_ms`)。REAPER のオートメーションや MCP 経由の操作でも、名前を見れば意味が分かるようにしています。
- **スライダーの値は実値です**(Hz・ms・dB など)。対数シェイプ(`:log`)を付けると、REAPER の API / オートメーションでは値が自然対数で扱われるため(`ln(1800) = 7.4955` を書く必要がある)、あえて付けていません。MCP からは「カットオフ 2000 Hz」をそのまま `2000` と書けます。REAPER 標準のスライダー UI では目盛りが線形になります。
- 後から追加したスライダーは末尾に並べています。古いバージョンで保存したプロジェクトも、スライダー番号がずれません。

### プリセット・簡易操作: AmiSynth Companion

`reaper/` と `generated/` を同じ親フォルダに置き、Actions → New action → Load ReaScript で `reaper/AmiSynth Companion.lua` を登録します。AmiSynth の入ったトラックを選択して実行すると、次を操作できます。SWS / ReaImGui は不要です。

- **Choose preset**: 用途別の内蔵カタログ(Bass / Lead / Pad など)とユーザープリセット。
- **Save preset**: 現在の音色を REAPER の永続 ExtState に保存。同じ名前なら上書きします。内蔵プリセットと同名は使えません。調律は含めず、音色変更時も現在の調律を維持します。
- **機能グループ**: Oscillators / Filter / Amp Envelope などを選択し、実単位で詳細編集。長い一覧はマウスホイールでスクロールします。ファイル選択は JSFX 本体のセレクターを使います。
- **Synth の4マクロ**: Brightness はカットオフとフィルターエンベロープ量、Punch は振幅／フィルターの Attack と Decay、Width はユニゾン数・デチューン・幅、Pump は四分音符 Duck と音量変調をまとめて変更します。入力は 0〜100。既存パラメーターへ絶対値を書き込み、詳細操作や Undo を引き続き使えます。Pump は現在の LFO 波形と同期設定を変更します(キック検出型サイドチェインではありません)。

開いた時点の FX に固定して操作します。FX を移動・削除したら開き直してください。パラメーターの名前・範囲がカタログと違う旧版には適用しません。各変更は実値で読み返して検証し、失敗時は元の値へ戻します。

### MCP 向けのカタログ・設定検証

`generated/automation.json` は、最小／最大値・単位・列挙値・機能グループに加え、`slider`(1始まり)、`paramIndex`(0始まり)、`valueDomain`、プリセットの id→実値、マクロの対象を含みます。`npm run gen:jsfx` で元定義から再生成します。従来の `params.json` / `presets.json` も維持しています。

```powershell
# カタログ表示
node scripts/reaper-params.js synth
# 用途別プリセット + マクロ + 実値の上書き
node scripts/reaper-params.js synth --preset "Sub Bass" --macro Pump 0.7 --set filter_cutoff_hz 650
# 実機から取得した {"filter_cutoff_hz":650} と照合(不一致なら終了コード1)
node scripts/reaper-params.js synth --set filter_cutoff_hz 650 --readback actual.json
```

出力の `writes[].value` は **TrackFX_SetParam** 用の実値、`normalized` は **TrackFX_SetParamNormalized** 用の 0〜1 です。650 Hz の実値は `650`、正規化値は `(650-20)/(20000-20)`。MCP のツール名だけで値の種類を判断せず、使用する API を確認して設定後に読み返してください。範囲外・未知の id・整数パラメーターの小数は送信前にエラーにします。ファイルのインデックスは各 Data フォルダに依存するため、この CLI では設定しません。[REAPER API リファレンス](https://www.reaper.fm/sdk/reascript/reascripthelp.html)

Lua を実行できる連携では `reaper/toolkit.lua` を `dofile` して直接利用できます。

```lua
local ami = dofile('/path/to/jsfx/reaper/toolkit.lua')
local binding = ami.bind(reaper.GetSelectedTrack(0, 0), 0, 'synth') -- FX番号は0始まり
ami.preset(binding, 'Sub Bass')
ami.macro(binding, 'Pump', 0.7)
ami.apply(binding, { filter_cutoff_hz = 650 }) -- 読み返し・検証・Undo付き
local actual = ami.read(binding)
```

### 出力レベル・発音状況

Synth / Physical / Drums の JSFX 画面にステレオピークと RMS を表示します。RMS は左右の平均二乗を400 msの指数平均で測定した dBFS 値で、LUFS / True Peak ではありません。Drums は各専用バスのピークも表示するため、メインミックスから外したグループを確認できます。

**Capture reference** で比較基準を記録し、同じフレーズで音色やユニゾンを変更すると RMS の差を表示します。**Match level** を押した時だけマスター音量を補正します(1回につき最大 ±12 dB、パラメーターの範囲内)。常時自動補正は行いません。無音では記録／補正せず、ソフトクリップ後の測定なので完全一致するとは限りません。繰り返し再生し、エンベロープとメーターが落ち着いてから比較してください。基準は再生開始時の初期化でリセットされるため、再生中に音色を切り替えて比較します。

Synth は使用ボイス数、リリース／サステイン中のボイス数、ボイススティール累計を表示します。累計は初期化時にリセットされ、同音の再トリガーと Mono / Legato はスティールに含めません。ユニゾンは音符のボイス数とは別です。上限8ボイスと既存の音声処理・スライダー番号は維持しています。

### テンポ同期(アルペジエーター・LFO)

- Synth は REAPER のテンポと拍位置(`tempo` / `beat_position`)に合わせて動きます。再生中は毎ブロック拍位置を合わせ直すので、ステップや LFO の周期はプロジェクトの小節線に揃います。停止中は直前のテンポで拍を数え続けるため、鍵盤で弾いてもアルペジオが鳴ります。
- アルペジエーター(`arp_mode` ≠ Off)は押さえている鍵を受け取り、`arp_rate` ごとに 1 音(Chord モードでは和音全体)を鳴らします。ステップ k は拍 `k × 音価` から始まり(偶数番目以外は `arp_swing_percent` の分だけ遅れる)、`arp_step_1..16` が Off のステップは休符になります。パターン長は `arp_steps` で、拍 0 を 1 ステップ目として数えます。
- `transpose_semitones` は鍵盤からのノート番号に足されます(12 平均律以外では音階のステップ数)。ノートオンの時点で決まり、鳴っている音はその音程のまま正しくノートオフされます。アルペジエーターを通る音は、次のステップから新しい値で鳴ります。
- サイドチェインなしのポンピング: `lfo_waveform` = Duck、`lfo_sync` = 1/4、`lfo_amp`(トレモロの深さ)を上げます。

### 共通の音階(微分音の曲): AmiSynth Tuning

全トラックで同じ音階を使うときは、「JS: AmiSynth Tuning」をプロジェクト内のどこか(例: 1 トラック目)に 1 つ置きます。楽器側は `tuning_source` を **Shared (AmiSynth Tuning)** にします。

```
[任意のトラック]  AmiSynth Tuning   Slot = 1, Scale Size = 7, Degree 1 = 175.4, ..., Degree 7 = 1200
[任意のトラック]  AmiSynth Tuning   Slot = 2  (別の音階)
[各楽器]          Synth / Physical  tuning_source = Shared, tuning_slot = 1 か 2
```

- **スライダーで持つ(MCP 向け)**: `scale_size`(1 周期の音の数、最大 32)と `scale_degree_1..N`(cents)。最後の音が周期(オクターブなら 1200)です。値は実値なので、MCP からスライダー名を指定してそのまま書けます。Web 版のチューニング欄の「AmiSynth Tuning の値をコピー」で JSON を作れます。
- **ファイルから読む**: `scale_source` = File にすると、`REAPER/Data/AmiSynth/` にある Scala 形式の `.txt` を Scale File で選んで読みます(32 音を超える音階もこちらで)。スライダーの値は、そのフォルダ内でのファイルの位置(名前順、0 から)です。ファイルが読めないときはスライダーの音階を使います。
- **基準**: 基準ノート / 基準周波数も AmiSynth Tuning のもの(`scale_ref_note` / `scale_ref_hz`)を使います。従っている間、楽器自身の `tuning_ref_*` と EDO のスライダーは使われません。
- **曲ごと・複数の音階**: 音階はプロジェクトに保存されるので、曲ごとに違う音階を持てます。Slot(1〜8)を変えた AmiSynth Tuning を複数置けば、1 曲で複数の音階を使い分けられます。
- **変更の反映**: AmiSynth Tuning のスライダーを変えると、従っている楽器に次のブロックで反映されます。Synth は鳴っている音の音程も変わります。Physical は次のノートから変わります。
- **仕組み**: JSFX の共有メモリ(`gmem`、名前空間 `AmiSynth`)の Slot ごとの領域に、音階・基準・更新番号を書きます。楽器はブロックごとに更新番号を見て読み直します。
- **制限**
  - `gmem` は REAPER 全体で共有されます。複数のプロジェクトをタブで同時に開き、同じ Slot を使うと干渉します。
  - 同じ Slot の AmiSynth Tuning が 2 つあると、後から書いた方が有効になります。
  - 誰も書いていない Slot に従うと、楽器自身の EDO スライダーで鳴ります。
- **以前の方式**: `tuning_source` = Scale file(`Data/AmiSynth/tuning.txt` 固定)も、これまでどおり使えます。
- 確認は ysfx 上だけです(AmiSynth Tuning を楽器の前に並べて動かすテストで、途中で音階を変える場合も含めて JS と一致することを確認しています)。

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

**完成した配線を作るアクション**: `reaper/AmiSynth Drums - Create routed tracks.lua` を Actions に登録して実行すると、10チャンネルの Drums 1台と Kick / Snare / Hats / Perc の4トラックを追加します。ピン3/4・5/6・7/8・9/10をそれぞれのトラックの1/2へ送り、各グループのメインへの重複出力と音源トラックの Master send を無効にします。MIDIはバストラックへ送りません。既存トラックの配線は変更しません。作成した5トラックを選択して **Save tracks as track template** で保存すれば、以後はテンプレートとして読み込めます。

### 制限

- Physical の可視化は Web 版だけの機能です。
- ネイティブの `.rpl` は未生成です。用途別プリセットとユーザー保存は AmiSynth Companion を使ってください。
- 補助 Lua のホスト契約(保存・読戻し・失敗時の復元・配線)は `lua tests/reaper-toolkit.test.lua` (Lua 5.3+)でモック検証します。実 REAPER の GUI 操作／配線は別途確認が必要です。
- `tools/jsfx_meter_check.cpp` を `YSFX_GFX=ON` の ysfx にリンクして `.cache/jsfx_meter_check` (Windows は `.exe`)へ置くと、`npm test` で `@gfx` の実行、出力とRMS／ピークの一致、9音目のスティール、基準記録、任意のレベル補正、無音時の補正抑止も検証します。別の場所なら `JSFX_METER_CHECK` で指定します。

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
- `jsfx_render` は出力ピンの数だけチャンネルを書き出します(Drums は 10 ch をすべて比較)。スクリプトの `tempo <bpm> <再生中 0|1>` で、ホストのテンポと再生状態を、`dataroot <dir>` で REAPER の Data フォルダを与えられます。`pre <file.jsfx>` / `preslider` / `preslider_at` で、楽器の前に別の JSFX(AmiSynth Tuning)を並べて動かせます(gmem を共有)。
- 比較するシナリオは次のとおりです。
  - Synth の全プリセット + 負荷の高い設定(ユニゾン・FM・シンク・S&H・19 平均律)
  - Synth のアルペジエーター全モード(再生中 / 停止中、スウィング、リズムゲート、Legato + ゲート 1、トランスポーズ、Chord + 19 平均律)
  - Synth の Mono / Legato、グライド(レガート時のみ)、9 声ユニゾン(カーブ・外側の音量)、テンポ同期 LFO(Duck・S&H・付点)
  - Synth の周期ノイズ / S&H ノイズとノイズフィルター、CC74 / CC71 でのカットオフ
  - 共通の調律ファイル(コメント・比・cents・整数を含む Scala、CRLF 改行)を Synth / Physical が読むこと、ファイルがないときの EDO への切り替え
  - AmiSynth Tuning に従う Synth(途中で音階・基準周波数を変更)/ Physical(ファイルを名前で選択)、空き Slot での EDO への切り替え
  - Physical のゴング系素材、ギターアンプの全タイプ(ゲインとトーンの両端、44.1 kHz も)
  - Physical の全プリセット + 負荷の高い設定(全モデルでビブラート・発音数超過・44.1 kHz、メッシュの全形状)
  - Drums の全キット × 全パーツ(チョークを含む)、メインミックスから外したグループ
  - 演奏データにはピッチベンド、モジュレーションホイール、サステインペダル、レガートを含めています
- 合格基準は SNR が 100 dB を超えることです。現在の結果は約 150 dB(float32 の量子化誤差程度)です。
- `jsfx_render` がない環境(Cloudflare のビルドなど)では、このテストは自動でスキップされます。
