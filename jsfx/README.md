# AmiSynth JSFX (REAPER)

ブラウザ版の DSP(`src/dsp/*.js`)を EEL2 に移植した、REAPER 用の JSFX 楽器です。
音は Web 版と**サンプル単位で同一**になっていて、自動テストでそれを確認しています(後述)。

| ファイル | 内容 |
| --- | --- |
| `AmiSynth Synth.jsfx` | 8 ボイスの減算式シンセ。2 オシレーター、シンク / FM、ユニゾン (最大 9)、LP / HP / BP / ノッチのフィルター、テンポ同期できる LFO × 2、モジュレーション・エンベロープ、4 スロットのモジュレーション・マトリクス、グライド、Mono / Legato、トランスポーズ、アルペジエーター、周期ノイズ、CC でのカットオフ、アフタータッチ、ウェーブテーブル、コーラス / テンポ同期ディレイ / リバーブ、サイドチェイン入力、CC7 / 10 / 11 (音量・パン・エクスプレッション)・ソステヌート・ソフトペダル。スライダー 135 本 |
| `AmiSynth Physical.jsfx` | 物理モデル音源。弦(Karplus-Strong)、モーダル合成(8 モード × 11 素材。ゴング系を含む)、擦弦、管楽器(クラリネット / フルート)、2D 膜 / 板、硬い弦(ピアノ)、金管。ギターアンプ付き。アフタータッチで息・弓圧・明るさ・ビブラート。サイドチェイン入力、CC7 / 10 / 11・ソステヌート・ソフトペダル。スライダー 93 本 |
| `AmiSynth Drums.jsfx` | 合成ドラム 23 パーツ(GM 配置)。パーツ別出力つき(10 ch)。CC7 / 10 / 11。スライダー 129 本 |
| `AmiSynth Tuning.jsfx` | 共通の音階を持つユーティリティ(音は出さず、オーディオと MIDI はそのまま通す)。Synth / Physical が Slot を指定して従う。スライダー 38 本 |
| `amisynth_lib.jsfx-inc` | 共通 DSP。上のすべてが `import` します |
| `amisynth_modulation.jsfx-inc` | Synthの行き先別Mod Amount表示。`npm run gen:jsfx`で生成 |
| `AmiSynth Synth.jsfx.rpl` など 3 つ | 内蔵プリセットの REAPER 用ライブラリ(下記「プリセット」)。`npm run gen:jsfx` で生成 |

## インストール

JSFX・Lua・配布対象READMEなどを変更した場合も、`npm run gen:jsfx` で `generated/manifest.json` を再生成してから `npm run check:catalogs` を実行してください。並行するPRでmanifestが競合した場合は、まずmainを取り込み、元ファイルの競合を解消してから同じコマンドで再生成します。manifest内のハッシュを手で選択・編集しないでください。

音源と補助スクリプトを一緒に配置する場合は、[ReaScript / MCPガイド](reaper/README.md) の `npm run install:reaper` を使えます。REAPERのリソースパスを明示して実行し、まず `--dry-run` で確認してください。既存の同名AmiSynthファイルは更新されます。Actionsへの登録は配置後に行います。

1. REAPER のメニューで **Options → Show REAPER resource path** を開きます。
2. `Effects/AmiSynth/` フォルダを作り、4つの音源／Tuning、`amisynth_lib.jsfx-inc`、`amisynth_meter.jsfx-inc`、`amisynth_modulation.jsfx-inc`、3つの`.rpl`をコピーします。
3. トラックの FX に「JS: AmiSynth Synth」などを追加し、MIDI を入力します。
   - Web 版のピアノロールにある「MIDI 書き出し」で作った `.mid` をそのまま使えます(メロディ ch1、ドラム ch10。ソングモードでは曲全体)。
   - 1 トラック目のメロディは、Synth か Physical のトラックに置いてください。

- **REAPER 6.74 以降が必要です。** Synth(127 本)と Drums(78 本)は、64 本を超えるスライダーを使います。
- スライダー変数名は `src/dsp/params.js` の id と同じです(例: `filter_cutoff_hz`, `kick_decay_ms`)。REAPER のオートメーションや MCP 経由の操作でも、名前を見れば意味が分かるようにしています。
- **スライダーの値は実値です**(Hz・ms・dB など)。対数シェイプ(`:log`)を付けると、REAPER の API / オートメーションでは値が自然対数で扱われるため(`ln(1800) = 7.4955` を書く必要がある)、あえて付けていません。MCP からは「カットオフ 2000 Hz」をそのまま `2000` と書けます。REAPER 標準のスライダー UI では目盛りが線形になります。
- 後から追加したスライダーは末尾に並べています。古いバージョンで保存したプロジェクトも、スライダー番号がずれません。

### プリセット・簡易操作: AmiSynth Companion

入口は [AmiSynth Companion.lua](reaper/AmiSynth%20Companion.lua)、ドラムの配線作成は [AmiSynth Drums - Create routed tracks.lua](reaper/AmiSynth%20Drums%20-%20Create%20routed%20tracks.lua) です。MCP向けの配置・呼び出し例と各スクリプトの区別は [ガイド](reaper/README.md) を参照してください。

`reaper/` と `generated/` を同じ親フォルダに置き、Actions → New action → Load ReaScript で `reaper/AmiSynth Companion.lua` を登録します。AmiSynth の入ったトラックを選択して実行すると、次を操作できます。SWS / ReaImGui は不要です。

MCPの `script_list` に見つけてもらうには、`Scripts/AmiSynth/reaper/` と `Scripts/AmiSynth/generated/` に配置します。一覧には `@description`／`@about` の説明が表示されます。最初に読み取り専用の `AmiSynth - MCP guide.lua` を実行すると案内文が返ります。CompanionはGUI、toolkit.luaはライブラリなので、直接のプリセット変更には説明付きラッパーを使ってください。

MCPから音色を作るときは、**`AmiSynth - Read sound.lua`(読み取り)→ 差分を編集 → `AmiSynth - Apply sound.lua`(適用)** の往復だけで済みます。`script_run` には引数を渡せないので、実行前に ExtState `AmiSynthMCP/apply_sound`(読み取り用は `read_sound`)か `Scripts/AmiSynth/apply_sound.json` に JSON の依頼を置きます。依頼は「トラック(選択中 / 名前)」「楽器(Synth / Physical / Drums、無ければ挿入)」「元にするプリセット」「Web 版の **JSON コピー** と同じ差分(id → 実値)」です。範囲外は丸め、不明な id は理由付きで除外し、全体を 1 回の Undo で適用して、適用値・丸め・除外の一覧を返します。Read sound の結果はそのまま Web 版の **JSON 貼り付け** にも使えます。書式と例は [ガイド](reaper/README.md#design-a-sound-in-one-round-trip-read-sound--apply-sound) を参照してください。

ほかの操作(トラック一覧、全パラメーターの読み書き、AmiSynth Tuning のスライダー、プリセット・マクロ、ドラムの配線作成、それらの連続実行)は、汎用の **`AmiSynth - Run.lua`** にまとめて引数を渡せます。依頼は `{"action": "set", "track": "Lead", "params": {...}}` のような JSON で、ExtState `AmiSynthMCP/run`、プロジェクトの ExtState、**プロジェクトノート**(` ```amisynth run ` の行から ` ``` ` の行までのブロック。読んだあとも消しません)、`Scripts/AmiSynth/run.json` の順に探します(Read sound / Apply sound も同じ順で探します)。詳しくは [ガイド](reaper/README.md#generic-entry-point-amisynth---runlua) を参照してください。

- **Choose preset**: 用途別の内蔵カタログ(Bass / Lead / Pad など)とユーザープリセット。
- **Save preset**: 現在の音色を REAPER の永続 ExtState に保存。同じ名前なら上書きします。内蔵プリセットと同名は使えません。調律は含めず、音色変更時も現在の調律を維持します。
- **機能グループ**: Oscillators / Filter / Amp Envelope などを選択し、実単位で詳細編集。長い一覧はマウスホイールでスクロールします。ファイル選択は JSFX 本体のセレクターを使います。
- **Synth の4マクロ**: Brightness はカットオフとフィルターエンベロープ量、Punch は振幅／フィルターの Attack と Decay、Width はユニゾン数・デチューン・幅、Pump は四分音符 Duck と音量変調をまとめて変更します。入力は 0〜100。既存パラメーターへ絶対値を書き込み、詳細操作や Undo を引き続き使えます。Pump は現在の LFO 波形と同期設定を変更します(キック検出型サイドチェインではありません)。

開いた時点の FX に固定して操作します。FX を移動・削除したら開き直してください。パラメーターの名前・範囲がカタログと違う旧版には適用しません。各変更は実値で読み返して検証し、失敗時は元の値へ戻します。

追加の音色は Web 版と Companion の両方で選択できます。全体で Synth 47種、Physical 42種、Drums 8キットです。ウェーブテーブルの5種は「ウェーブテーブル」の節、エフェクトを使う5種は [エフェクト](#エフェクトコーラスディレイリバーブ) を、モジュレーション・マトリクス / アフタータッチの見本7種はそれぞれの節を参照してください。それ以前に追加した17種の用途は次のとおりです。

| 音源・用途 | プリセット | 演奏のヒント |
| --- | --- | --- |
| Synth / Bass | Rubber Mono Bass、Reese Bass | 低い単音。前者は短い打ち込みと重ねたノートのグライド、後者は持続するリフ向け |
| Synth / Lead | Hollow Pulse Lead、Soft Sine Lead | ノートを重ねてレガート。Mod Wheel でビブラートを追加 |
| Synth / Chord / Pad | Poly Chord Stab、Slow Chord Wash | 短い裏拍コード／緩やかな持続コード。Wash は長いリリースが重なるので8ボイスの表示を確認 |
| Synth / Keys | Glass Pluck、Dusty Keys | 明るいFMプラック／暗めの鍵盤。小さな和音や単音のフレーズに |
| Synth / Arp | Triplet Cascade、Rhythmic Steps | 和音を押さえると2オクターブの下降3連符／休符入りのスウィング5ステップ。ホストのテンポに同期 |
| Physical / String / Keys | Muted Nylon、Felt Piano | 短い指弾き風の伴奏／柔らかいハンマーのピアノ風テクスチャ |
| Physical / Mallet / Wind | Glass Atmosphere、Pure Flute | 長く響くガラス系の打音／息のノイズが少ないフルート風の旋律 |
| Drums / Kit | Dry House、Synthwave Arena、Soft Percussion | 短いハウス用／長めのスネアとタムのレトロポップ用／控えめなシンバルと前に出るシェイカー |

ウェーブテーブルを使う 5 種も追加しています。

| 音源・用途 | プリセット | 演奏のヒント |
| --- | --- | --- |
| Synth / Pad | Vowel Choir Pad、PWM Sweep Strings | 和音を伸ばす。前者は母音がゆっくり移り変わる声風、後者は 2 つのパルス幅を LFO で揺らすストリングス風 |
| Synth / Lead | Morphing Wave Lead | 発音ごとに矩形寄りから三角寄りへ変わる。ノートを重ねてレガート |
| Synth / Keys | Harmonic Scan Pluck | 減衰とともに倍音の帯が下がるプラック。単音や小さな和音 |
| Synth / Bass | Digital Growl Bass | 8 ビット波形を 1/8 同期の LFO で動かす単音ベース。ホストのテンポに同期 |

音量は既存と同じ試験フレーズで約−18 LUFSに調整しています。曲中の音量は音域・和音数・ベロシティ・演奏密度でも変わるので、メーターを見ながら合わせてください。

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
- アルペジオがどこで最初の音(Up なら最低音)に戻るかは `arp_retrigger` で選びます。リズムパターン(`arp_step_*`)の位置はどれでも拍に固定のままで、変わるのは「和音の何番目の音か」だけです。
  - **First Key** (既定、以前と同じ): 押鍵数が 0 から 1 になったとき(すべて離してから弾き直したとき)だけ戻ります。
  - **New Chord**: それに加え、前の押鍵から 50 ms より後に鍵が押されたときも戻ります。前の和音を押さえたまま次の和音に移っても、次のステップから新しい和音の最初の音で始まります(50 ms 以内にそろって届く音は同じ和音とみなします)。
  - **Every Bar**: それに加え、小節線をまたいだ最初のステップで戻ります。小節の長さは REAPER の拍子(`ts_num` / `ts_denom`)から求めます(Web 版は 4/4)。プロジェクトの途中で拍子が変わる場合、小節線は拍 0 から数えた位置になります。
  - **Free Run**: 押鍵では戻りません。位置は曲の頭からのステップ数で決まるので、どこから再生しても、弾き直しても、ずっと流しっぱなしだったときと同じ音になります。
- `legato_window_ms` (Voice グループ、既定 0): Mono / Legato と Glide Mode「Legato only」で、前のノートを離してからこの時間内に次のノートが来たら、重なっていたものとして扱います(Legato はエンベロープを頭からやり直さず、リリースから戻ります。Legato only のグライドも効きます)。打ち込みで音符の終わりと次の頭が同じ位置、または数 ms 空いている MIDI 向けです。
- `transpose_semitones` は鍵盤からのノート番号に足されます(12 平均律以外では音階のステップ数)。ノートオンの時点で決まり、鳴っている音はその音程のまま正しくノートオフされます。アルペジエーターを通る音は、次のステップから新しい値で鳴ります。
- サイドチェインなしのポンピング: `lfo_waveform` = Duck、`lfo_sync` = 1/4、`lfo_amp`(トレモロの深さ)を上げます。実際のキックに合わせるなら下の「サイドチェイン」を使います。

### エフェクト(コーラス・ディレイ・リバーブ)

Synth はボイスを足し合わせた後(マスター音量・トレモロの後、最後のソフトクリップの前)に **コーラス → ディレイ → リバーブ** を通します。スライダーは末尾(slider86〜101)に追加したので、既存プロジェクトのスライダー番号は変わりません。

- どれも既定は **Off** です。Off の間は処理そのものを飛ばすので、既存のプリセットやプロジェクトの音は変わらず、CPU も使いません。On にした瞬間に遅延メモリを消すので、以前の残響が戻ってくることはありません。
- **Mix** はドライ / ウェットのクロスフェードです(0 = 原音のみ、1 = エフェクト音のみ)。センド用に 100 % ウェットでも使えます。
- **Chorus**(`fx_chorus_*`): 左右で 1/4 周期ずらした LFO で 7 ms〜(7 + Depth)ms の遅延を揺らします。モノの音色も左右に広がります。
- **Delay**(`fx_delay_*`): `fx_delay_sync` で音価(1/1〜1/32、付点・3 連。LFO Sync と同じ書き方)を選ぶと REAPER の `tempo` に同期し、テンポが変わると滑らかに追従します。Off なら `fx_delay_time_ms`(1〜2000 ms)。最長 4 秒で、それを超える同期時間(60 BPM 未満の 1/1 など)は 4 秒で頭打ちです。Ping-Pong は入力をモノにまとめて左 → 右 → 左と跳ね返します。High Cut はフィードバック経路のローパスで、繰り返すほど暗くなります。
- **Reverb**(`fx_reverb_*`): 拡散用オールパス 2 段 + 4 本の遅延線の FDN(Physical の Room と同じ `fdn4_*` を `amisynth_lib.jsfx-inc` で共有)。Size で遅延線の長さ、Decay で残響時間(-60 dB まで)、Damping で高域の減衰を決めます。
- 遅延メモリは `@init` で一度だけ確保します(ディレイ 4 秒 × 2ch、コーラス 20 ms × 2ch、リバーブ 6 本(最長 約 80 ms)。48 kHz で合計約 40 万スロット)。1 サンプルあたりの処理は遅延線の読み書き十数回と sin / cos 各 1 回だけです。

| 音源・用途 | プリセット | 演奏のヒント |
| --- | --- | --- |
| Synth / Pad | Ambient Hall Pad、Chorus Strings | 長く暗いホールとコーラスのパッド／PWM 1 本をコーラスで厚くしたストリングス。和音を伸ばして |
| Synth / Lead | Dotted Delay Lead | 付点 8 分のピンポン・ディレイ(テンポ同期)。レガートの単音メロディ向け |
| Synth / Keys | Ping-Pong Pluck | 8 分で左右に跳ねる短いプラック。音数を少なめに |
| Synth / Chord | Dub Chord | 短いコードの後ろで暗い付点 4 分のディレイが長く続く。裏拍に置いて隙間を作る |

### 共通の音階(微分音の曲): AmiSynth Tuning

全トラックで同じ音階を使うときは、「JS: AmiSynth Tuning」をプロジェクト内のどこか(例: 1 トラック目)に 1 つ置きます。楽器側は `tuning_source` を **Shared (AmiSynth Tuning)** にします。

```
[任意のトラック]  AmiSynth Tuning   Slot = 1, Scale Size = 7, Degree 1 = 175.4, ..., Degree 7 = 1200
[任意のトラック]  AmiSynth Tuning   Slot = 2  (別の音階)
[各楽器]          Synth / Physical  tuning_source = Shared, tuning_slot = 1 か 2
```

- **スライダーで持つ(MCP 向け)**: `scale_size`(1 周期の音の数、最大 32)と `scale_degree_1..N`(cents)。最後の音が周期(オクターブなら 1200)です。値は実値なので、MCP からスライダー名を指定してそのまま書けます。Web 版のチューニング欄の「AmiSynth Tuning の値をコピー」で JSON を作れます。
- **ファイルから読む**: `scale_source` = File にすると、`REAPER/Data/AmiSynth/` にある Scala 形式の `.txt` を Scale File で選んで読みます(32 音を超える音階もこちらで)。スライダーの値は、そのフォルダ内でのファイルの位置(名前順、0 から)です。ファイルが読めないときはスライダーの音階を使います。
- **読み込み状態(表示専用)**: 末尾の `scale_status`(Sliders / File loaded / File not found / File format error)と `scale_loaded_notes`(いま公開している音階の 1 周期の音数)に、JSFX が毎回書き込みます。MCP からは `TrackFX_GetParam` や `AmiSynth - Run.lua` の `get` で読めます。この 2 つは書いても次の更新で上書きされ、toolkit / Companion / Run からは書き込みを拒否します。書式エラーは「説明行、音数、その数のピッチ」がそろっていない(または最後の音が 0 以下)場合です。
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

### ウェーブテーブル (Synth)

`osc1_waveform` / `osc2_waveform` の 5 番目の値 **Wavetable**(値 4)で使います。既存の値 0〜3 の意味は変えていないので、以前のプロジェクトやプリセットはそのまま鳴ります。スライダーは末尾(slider86〜92)に追加しました。

| スライダー | 内容 |
| --- | --- |
| `osc1_wt_bank` / `osc2_wt_bank` | バンク: Basic Shapes / PWM Sweep / Vocal Formants / Harmonic Sweep / Digital |
| `osc1_wt_position` / `osc2_wt_position` | バンク内の位置 0〜1(8 フレームを直線補間で行き来) |
| `wt_position_lfo` / `wt_position_filter_env` / `wt_position_amp_env` | LFO・フィルター EG・アンプ EG で位置を動かす量(−1〜1、両オシレーター共通。結果は 0〜1 に収まる) |

- テーブルはサンプルファイルではなく、JS 版と同じ式・同じ FFT のループで `@slider` 内で計算します。バンクを初めて選んだときに 1 回だけ作り(1 バンク約 0.05 秒、ysfx での測定)、以後は再利用します。サンプルレートには依存しません。再生中に初めてのバンクへ切り替えると、その瞬間に一度だけ処理が重くなります。
- 各フレームはオクターブごとに 10 段のテーブル(倍音 512, 256, … 1 本)を持ち、音程から Nyquist を超えない段を選ぶので折り返しません。段の切り替わりで波形が跳ばないよう、各段の受け持ち範囲の上側半オクターブ(境目の周波数 × 1/√2 から境目まで)では次の段(倍音が半分で、やはり折り返さない)へ周波数に比例してクロスフェードし、境目ちょうどで次の段の重みが 1 になります。次の段は重みが 0 より大きいときだけ読みます。
- **メモリ配置**: テーブルはローカルメモリの固定領域 4194304(2^22)〜5020701 に置きます(5 バンク × 8 フレーム × 10 段 × 2048 サンプル = 819200 と、FFT の作業領域・準備済みフラグ)。`mem_alloc` で確保する通常のバッファ(1024〜。エフェクトの遅延線を含み、192 kHz で約 1.55M)とは重なりません。`@init` の最後にヒープが 2^22 未満であることと、領域がメモリ上限(`__memtop()`、既定 8M)に収まることを確かめ、満たさない場合はウェーブテーブルを無音にします(配置は `AmiSynth Synth.jsfx` 内のコメントにも記載)。

### MIDI CC でカットオフ

音源別のCC、ノート、ピッチベンド、未対応メッセージ、チャンネルとパススルーの詳細は [MIDI対応表](../docs/MIDI.md) にまとめています。

- Synth は `cc_cutoff_number`(既定 74)の CC でカットオフを動かします。**CCの値が64**なら変化なし、値0 / 127で `cc_cutoff_depth_oct` オクターブ下 / 上です。CC番号64のサステインとは別です。REAPER の MIDI CC レーンや、オートメーションを書きにくい MCP ツールからの操作に使えます。`cc_cutoff_number` を0にすると無効です。

### Synth のモジュレーション・マトリクス

LFO 2 (`lfo2_*`)、モジュレーション・エンベロープ (`mod_env_*`)、マトリクス (`mod1_*`〜`mod4_*`) は slider86〜104 に追加しました(既存スライダーの番号は変えていません)。各スロットは次の 3 本です。

| スライダー | 内容 |
| --- | --- |
| `modN_source` (enum) | Off / LFO 1 / LFO 2 / Mod Env / Velocity / Key Track / Mod Wheel / Pressure / Random (per note) |
| `modN_destination` (enum) | Off / Pitch / Filter Cutoff / Filter Resonance / Pulse Width / Osc2 Pitch / FM Index / Amp / Pan / LFO 1 Rate / LFO 2 Rate / Noise Level |
| `modN_amount` (実値, -4800〜4800) | ソース値 1 のときに行き先が動く量。単位は行き先ごと: Pitch・Osc2 Pitch = cents、Cutoff・LFO Rate = oct、FM Index = rad、Amp = dB (+24 dB まで)、Resonance・Pulse Width・Noise Level = ノブの値 (0〜1) に加算、Pan = -1 (左)〜+1 (右) |

- ソースの範囲: LFO 1 / LFO 2 / Random は -1〜1、Mod Env / Velocity / Mod Wheel / Pressure は 0〜1、Key Track は中央 C (261.63 Hz、どの調律でも) から何オクターブ上 (+) / 下 (-) か。例: Key Track → Pitch に -600 で、鍵盤 1 オクターブにつき半オクターブだけ上がる
- ソース・行き先・量のどれかが Off / 0 のスロットは何もせず、計算もしません(既存のプロジェクトとプリセットの音は変わりません)
- 行き先はノートごと(ボイスごと)に計算します。LFO 1 Rate / LFO 2 Rate だけはグローバルなので、LFO 1・LFO 2・Mod Wheel・チャンネルプレッシャーだけが効きます(ノートごとのソースは無視)。テンポ同期中の LFO には Rate は効きません
- LFO 2 の S&H と Random (per note) は、ノイズやユニゾンの位相とは別の乱数列を使います(オンにしてもほかの音が変わらないように)
- Pressure はチャンネルプレッシャー (0xD0) とそのキーのポリフォニック・アフタータッチ (0xA0) の大きい方で、10 ms でならしています。アルペジエーター中は鳴っている音がアルペジオのノートなので、ポリフォニック・アフタータッチではなくチャンネルプレッシャーを使ってください

### Physical のアフタータッチ

Physical の **Pressure** グループ (slider61〜63) で、チャンネルプレッシャー / ポリフォニック・アフタータッチ (0〜1) の割り当て量を決めます。既定はすべて 0 (無効) です。

| スライダー | 効き先 |
| --- | --- |
| `phys_pressure_excitation` | Breath Pressure (管楽器)、Brass Blowing Pressure (金管)、Bow Pressure (擦弦) に「量 × プレッシャー」を加算 |
| `phys_pressure_vibrato_cents` | プレッシャー最大でこの cents だけビブラートを深くする(ノートごと、遅延線モデル: 弦・擦弦・管・ピアノ・金管)。速さは Vibrato Rate |
| `phys_pressure_brightness` | Bowed String Brightness (擦弦)、Brass Bell Brightness (金管) に「量 × プレッシャー」を加算 |

プレッシャーのメッセージを受けた時点で、鳴っているノートの値を更新します(モーダル・膜・撥弦はビブラート以外には反応しません)。CC121 はプレッシャーも 0 に戻します。

### Physical のギターアンプと Amp Auto Level

ゲインを上げるほどクリップで音が詰まり、同じ Amp Level でも大きく聞こえます(内蔵のエレキギター系プリセットでは、Off と Distortion の最大ゲインで 10 dB 以上の差)。`amp_auto_level` (Amp グループ、末尾のスライダー)を **On** にすると、基準の正弦波(ピーク 0.3)がクリップ段を通ったあとも同じ RMS になるような補正を Amp Type / Amp Gain から計算し、出力に掛けます。ゲインを上げても歪みが増えるだけで、ラウドネスはアンプなしとおおむね ±3 dB 以内に収まります(短い音が中心のパームミュートなどは、ゲインが高いほど少し大きくなります)。`amp_level_db` はその上での微調整になります。

既定は **Off** です(既存のプロジェクトとプリセットの音量を変えないため)。内蔵プリセットは Off のまま -18 LUFS に合わせてあるので、プリセットから始めて On にすると音量が下がることがあります。そのときは Amp Level か Volume で戻してください。

### Physical のサステインペダル (CC64)

Physical の **Output → Sustain Pedal** (`phys_sustain_mode`、末尾のslider60)で選択します。既存スライダーの番号は変えていません。Web版の鍵盤横にある **Sustain** ボタンも、外部MIDIペダルと同じCC64を送ります。

| 設定 | 動作 |
| --- | --- |
| Off | CC64を無視し、鍵盤を離すと通常のRelease Dampingを適用 |
| Auto (既定) | 撥弦、ピアノ、Drum Membrane以外のモーダル素材で有効。擦弦・管・金管・2D膜／板では無効 |
| All models (CC64) | 全モデルがCC64に従う。管楽器なども、ペダルを踏んでいる間は鍵盤を離した後も励振を持続する演奏用設定(ペダルを踏んだ状態にする設定ではない) |

CC64の値64以上で踏み込み、63以下で解除です。ペダル中のノートオフでは追加の減衰を保留し、解除時に **Release Damping** を適用します。発音中の自然な減衰は続き、消えた音を復活させる機能やハーフペダル、ピアノの全弦共鳴は含みません。

同音の再トリガーやボイススティールは古い保留状態を引き継ぎません。モードをOffにする／音源モデルやモーダル素材を切り替えると保留中のノートを解放します。CC120・123はペダル状態を解除して全ノートをリリースし、CC121はペダルとピッチベンドをリセットします。Web版でSynth／Physicalを切り替える際もペダルを解除します。

ソステヌート (CC66) も同じ設定に従い、踏んだ時に押鍵中のノートだけを保留します。CC67 (ソフトペダル)、CC7／10／11 (Volume／Pan／Expression) は Synth／Physical／Drums 共通で、出力の末尾 (`midi_volume_pan`、MIDIグループ) で掛かります。詳しくは [MIDI対応表](../docs/MIDI.md) を参照してください。

### Drums のパーツ別出力

| ピン | 内容 |
| --- | --- |
| 1/2 | メインミックス |
| 3/4 | キック |
| 5/6 | スネア・クラップ・リムショット |
| 7/8 | ハイハット(クローズ / オープン)・クラッシュ・ライド |
| 9/10 | タム 3 つ・カウベル・シェイカー |

- 3〜10 は常に出力されます。トラックのチャンネル数を 10 にし、使いたいペアをセンドやピン設定でほかのトラックへ送ってください(例: キック 3/4 だけをパッドのサイドチェイン入力へ。下の「サイドチェイン」)。
- `kick_bus_in_main` などを Off にすると、そのグループはメインミックス(1/2)に入らず、専用の出力にだけ出ます。パーツ別に EQ やコンプをかけたいときに使います。
- Web 版はメインミックスだけを鳴らします(Off のグループはメインから外れます)。

**完成した配線を作るアクション**: `reaper/AmiSynth Drums - Create routed tracks.lua` を Actions に登録して実行すると、10チャンネルの Drums 1台と Kick / Snare / Hats / Perc の4トラックを追加します。ピン3/4・5/6・7/8・9/10をそれぞれのトラックの1/2へ送り、各グループのメインへの重複出力と音源トラックの Master send を無効にします。MIDIはバストラックへ送りません。既存トラックの配線は変更しません。作成した5トラックを選択して **Save tracks as track template** で保存すれば、以後はテンプレートとして読み込めます。実行結果(作成したトラックの番号・名前・役割・GUID と、音源トラックの FX 番号)は `reaper_mcp_script_result/last_result` に `ok: {...}` で返します。失敗したときは作りかけのトラックを消して `error: ...` を返します(ダイアログは出さず、ReaScript コンソールにも表示します)。

### サイドチェイン (Synth / Physical)

Synth と Physical は入力ピン 3/4 を **サイドチェイン** として読みます(1/2 は使いません)。キックなどをトラックのチャンネル 3/4 へ送ると、
その音量に合わせて出力を下げられます(本物のキックに合わせたポンピング)。Web 版には音声入力がないので、この機能は JSFX だけです。

1. 音源トラックの **Route → Track channels** を 4 にします。
2. キックのトラック(または Drums のキック出力 3/4 を受けているバス)から、音源トラックへセンドを作り、送り先を **3/4** にします
   (Drums 本体から直接なら、センドの送り元を 3/4 = キック、送り先を 3/4 にします)。
3. 音源の `sc_duck_db`(Sidechain Duck)を上げます。12〜24 dB 程度がよくあるポンピングです。

| スライダー | 意味 |
| --- | --- |
| `sc_duck_db` | 入力が最大(1)のときに出力を何 dB 下げるか。入力が小さいほど浅く。0 = オフ(既定) |
| `sc_input_gain_db` | 入力のゲイン。エンベロープは 2 ch の大きい方を読み、1 (0 dBFS) で頭打ちなので、小さいトリガーは上げます |
| `sc_attack_ms` / `sc_release_ms` | エンベロープの立ち上がり / 戻りの時定数。Release がポンプの長さです |

- 下げるのはエフェクト(Synth のコーラス / ディレイ / リバーブ、Physical のアンプ / ロータリー / 部屋の響き)の後なので、残響ごと沈みます。
- Synth ではモジュレーション・マトリクスのソースに **Sidechain**(0〜1、全ボイス共通)があり、カットオフ・ピッチ・LFO の速さなど
  どの行き先にも使えます(例: キックのたびにフィルターを閉じる = Sidechain → Filter Cutoff に負の量)。
- `sc_duck_db` が 0 でマトリクスでも使っていなければ、入力は読みません(音も負荷も変わりません)。
- 入力ピン 3/4 の音はそのまま 3/4 に残ります。トラックの親への送りが 4 ch だとマスターの 3/4 に流れますが、ステレオのマスターでは聞こえません。

### プリセット (.rpl)

`AmiSynth Synth.jsfx.rpl` / `AmiSynth Physical.jsfx.rpl` / `AmiSynth Drums.jsfx.rpl` は Web 版と同じ内蔵プリセット
(Synth 77・Physical 92・ドラムキット 8)の REAPER 用プリセットライブラリです。JSFX と同じフォルダに置くと、
FX ウィンドウ右上のプリセット欄に「Bass: Sub Bass」のように「カテゴリ: 名前」で並びます。
置いていない場合や別の場所に置いた場合は、プリセット欄の **+ → Import preset library…** で読み込めます。

- チューニングのスライダー(`tuning_*`)とファイル選択はプリセットに含めていない(`-`)ので、プリセットを切り替えても
  トラックの音階はそのままです(Companion / toolkit の `ami.preset` と同じ扱い)。
- 中身は `src/presets/*.js` から `npm run gen:jsfx` で作ります。手で編集しないでください(`tests/rpl.test.js` が古いと失敗します)。
- 64 本を超えるスライダーを含むため REAPER 6.74 以降の形式です。

### 制限

- Physical の可視化は Web 版だけの機能です。
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
  - Synth のウェーブテーブル(全バンク、位置の LFO / EG 変調、ユニゾン・FM・ハードシンク、5 オクターブのグライドで全段を通過、44.1 kHz)、段の境目をまたぐ 2 オクターブのピッチベンドとグライド(クロスフェード)
  - Synth の Mono / Legato、グライド(レガート時のみ)、9 声ユニゾン(カーブ・外側の音量)、テンポ同期 LFO(Duck・S&H・付点)
  - Synth の周期ノイズ / S&H ノイズとノイズフィルター、CC74 / CC71 でのカットオフ
  - 共通の調律ファイル(コメント・比・cents・整数を含む Scala、CRLF 改行)を Synth / Physical が読むこと、ファイルがないときの EDO への切り替え
  - AmiSynth Tuning に従う Synth(途中で音階・基準周波数を変更)/ Physical(ファイルを名前で選択)、空き Slot での EDO への切り替え
  - Physical のゴング系素材、ギターアンプの全タイプ(ゲインとトーンの両端、44.1 kHz も)
  - Physical の全プリセット + 負荷の高い設定(全モデルでビブラート・発音数超過・44.1 kHz、メッシュの全形状)
  - Drums の全キット × 全パーツ(チョークを含む)、メインミックスから外したグループ
  - Synth の LFO 2 (S&H・テンポ同期 Duck)、モジュレーション・エンベロープ、マトリクスの全ソース・全行き先、チャンネルプレッシャーとポリフォニック・アフタータッチ(Mono Legato + ユニゾンを含む)
  - Physical のアフタータッチ(擦弦・クラリネット・フルート・金管の息 / 弓圧 / 明るさ、弦・ピアノのビブラート、CC121 でのリセット)
  - 演奏データにはピッチベンド、モジュレーションホイール、サステインペダル、レガートを含めています
- 合格基準は SNR が 100 dB を超えることです。現在の結果は約 150 dB(float32 の量子化誤差程度)です。
- `jsfx_render` がない環境(Cloudflare のビルドなど)では、このテストは自動でスキップされます。
