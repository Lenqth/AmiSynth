# 制作セッションでの音作りと比較

WT位置の独立変調、Mod Amountの単位表示、プリセットの入口、同じMIDIによるオフライン試奏・測定記録をまとめます。Scene／モーフによる切り替えは今回の対象に含めません。

## Osc1／Osc2のWT Positionを別々に動かす

Mod MatrixのDestination末尾に **Osc1 WT Position**（値12）／**Osc2 WT Position**（値13）を追加しました。既存の行き先0〜11とパラメータ番号は変わりません。

各オシレーターをWavetableにしたうえで、例えば次のように設定します。

| Source | Destination | Amount | 効果 |
|---|---|---:|---|
| LFO 2 | Osc1 WT Position | 0.45 | Osc1の母音を往復する |
| Velocity | Osc2 WT Position | 0.7 | 発音の強さでOsc2の母音を変える |
| Pressure | Osc1 WT Position | 0.2 | 押鍵後のプレッシャーでOsc1をさらに動かす |

量は正規化位置の加算値です。既存のWT Position LFO／Filter Env／Amp Envと加算した後、各オシレーターの位置を0〜1へ制限します。クラシック波形ではこの行き先は音を変えません。LFO2、Mod Env、Velocity、Pressureなどを使え、Pressureやエンベロープはボイスごとに計算されます。WebとJSFXの処理は同じです。

## Mod Amountの単位と推奨範囲

内部の保存値・REAPERオートメーションの範囲は従来どおり−4800〜4800です。既存音色を読み込んだだけで、値を丸めたり小さい範囲へ制限したりしません。

Webのノブに加え、JSFX画面の下部、Companionの値／編集ダイアログでも、選択した行き先の単位・推奨範囲・微調整幅を確認できます。推奨範囲は保存値の検証範囲とは別です。Companionでは入力値を従来の保存範囲で検証します。Webの行き先変更時のノブ範囲調整は従来の挙動です。

| 行き先 | 単位 | 推奨範囲 | 微調整幅 |
|---|---|---|---|
| Pitch | cents | ±2400 | 0.1 |
| Osc2 Pitch | cents | ±4800 | 1 |
| Filter Cutoff | oct | ±8 | 0.01 |
| LFO Rate | oct | ±6 | 0.01 |
| FM Index | rad | ±10 | 0.01 |
| Amp | dB | ±48 | 0.1 |
| Osc1／Osc2 WT Position | position | ±1 | 0.001 |

MCPでは`generated/automation.json`のAmount定義にある`modulation.destinationParameter`と`modulation.destinations`を参照します。実機の現在値を読む場合は、`AmiSynth - Run.lua`の`get`結果にある`display.mod1_amount`等が現在の行き先に対応する単位・`suggested_min/max`・`fine_step`を返します。`values.mod1_amount`は常に保存された実値です。

## プリセットと短いデモ

オルガンとSteel Drumsは既存プリセットを使用し、重複する音色は追加していません。Formant Half-time Bassは、新しい独立WT変調を使う追加音色です。推奨域は実楽器の制限ではなく試奏の出発点です。

| 音色 | 種類 | 推奨MIDI音域 | ベロシティ | デモBPM |
|---|---|---|---|---:|
| Percussive Organ | Physical | 48〜84 | 70〜120 | 100 |
| Steel Drums | Physical | 48〜84 | 60〜115 | 128 |
| Formant Half-time Bass | Synth | 36〜55 | 70〜115 | 140 |

`generated/automation.json`のプリセット定義にも`playingGuide`を収録します。次のコマンドで、推奨音域の短いデモMIDIと音声を生成できます。

```powershell
npm run audition:preset -- phys --preset "Percussive Organ" --guide --out .cache/demo-organ
npm run audition:preset -- phys --preset "Steel Drums" --guide --out .cache/demo-steel
npm run audition:preset -- synth --preset "Formant Half-time Bass" --guide --out .cache/demo-formant
```

各出力先に`phrase.mid`、`audition.wav`、`report.json`、`request.json`、`sound.json`を保存します。比較ページは生成しません。WAVは48 kHz・16 bitステレオで、自動の音量補正は適用しません。

## 同じMIDIで測定し、記録を再利用する

`--guide`を付けない場合、メロディ音源は共通の4音（MIDI 60／64／67／72、velocity 100、120 BPM）を鳴らします。モデルが異なっても同じ条件で比較できます。推奨音域のデモと、共通フレーズによるレベル比較は用途が異なります。

プリセットの音量調整に使う既存の5秒テストフレーズとは別の演奏なので、ここで必ず−18 LUFSになるわけではありません。同じフレーズ同士の差と、各測定の補正案を確認してください。

```powershell
npm run audition:preset -- phys --preset "Percussive Organ" --out .cache/organ-reference
npm run audition:preset -- phys --preset "Steel Drums" --reference .cache/organ-reference/report.json --out .cache/steel-comparison
```

レポートには、再生条件、全パラメータ、既定値からの差分、サンプルピーク、ステレオRMS、積分LUFS、最大使用ボイス数、最大リリース中ボイス数、ボイススティール数、−18 LUFSを目安とする補正案を保存します。補正案は1回±12 dBかつ音量パラメータ範囲内で、適用はしません。非線形処理があるため、適用後には再測定してください。無音ではLUFSと補正案を`null`にします。使用ボイス数にはリリース中のボイスを含みます。ドラムは同じボイス割当方式ではないため発音数／スティール数を`null`にします。

`--reference`ではイベント（ベロシティやCCも含む）・テンポ・長さ・サンプルレートのSHA-256が一致した場合だけ比較し、ピーク／RMS／LUFS差を返します。異なるフレーズの測定値を同条件として扱いません。

`sound.json`はWebの音色JSON／Apply sound用の差分です。チューニングは含めず、現在のトラック音律を維持します。完全な測定条件は`report.json.params`に音律も含めて保存します。Gitのリビジョンと未コミット変更の有無も記録し、取得できない環境では`null`にします。

### 明示したイベント列で再測定する

`--request`で`request.json`を再利用できます。これは音符とCC等のチャンネルメッセージを秒単位で記述する形式です。`.mid`を入力として読む機能や曲中のテンポ変更は今回含めません。

```json
{
  "sampleRate": 48000,
  "seconds": 3,
  "bpm": 120,
  "eventUnit": "seconds",
  "events": [[0,144,60,100],[1,128,60,0]]
}
```

`--patch`は`{"params":{"mod1_amount":0.3}}`またはパラメータオブジェクトを持つJSONファイルです。パラメータは実単位で検証し、範囲外や未知のIDは拒否します。

```powershell
npm run audition:preset -- synth --preset "Formant Half-time Bass" --request .cache/first/request.json --patch patch.json --reference .cache/first/report.json --out .cache/second
```

44100／48000 Hz、最大30秒・10000イベントに対応します。書き出しMIDIは960 PPQへ量子化するため、任意のイベント列では秒単位のレポートと最大半tickの差があります。既定の120 BPMフレーズの音符位置は正確に書き出せます。

### 測定の範囲

このコマンドはNode.jsでAmiSynthのJS参照DSPを実行します。MCPを使う制作セッションでも、シェルを利用できる環境から呼び出せます。実際のREAPERトラック、インストール済みJSFX、フェーダー、外部FX、サイドチェイン音声を測定するものではありません。Apply soundの`audition`や瞬間的トラックメーターの契約は変更しません。True Peak、CPU性能、聴感上の自然さを評価した値でもありません。実機へ適用した後は、パラメータのreadbackと必要な試聴を続けてください。

音律はEDOスライダー（`tuning_source=0`）のみ対応します。ファイル／共有Scala音律は読み込めないため、誤って別の音律を測定しないよう明示的に拒否します。

## 微分音・演奏カーブ・ペダルの確認

ブラウザのSynth／Physical両方のTuning欄に「鍵盤対応・予測周波数」を追加しました。MIDI番号、基準音からの段階／cents、予測Hzを確認でき、12平均律・A4=440 Hzの番号列を現在の音律へ最も近い鍵に変換してコピーできます。音名は入力キー名で、周波数は音律計算からの予測値です。実音の周波数測定ではありません。変換先が0〜127に収まらない場合はエラーにします。ドラムやCC、MIDIファイルを自動変換しません。

24 EDO・基準69=440 Hzなら `target = 69 + 2 * (source - 69)` です。例えば12平均律の `60 62 64 65 67 69 71 72` は `51 55 59 61 65 69 73 75` になります。他の音律では最近接鍵への丸め誤差も表示します。

次のコマンドで9ケースの短い試奏セットを生成できます。比較HTMLは生成しません。

```powershell
npm run check:performance -- --out .cache/glass-performance
```

- Violinの弓圧変化と、同じMIDIの一定値版。
- Clarinetの息圧変化（途中の息継ぎ）と、同じMIDIの一定値版。
- Pure Fluteの24 EDO（12平均律の音高を維持する番号列）。
- HarpのSustain Pedal Auto／Off × Room 0／0.25。CC64 ON→note off→2秒でCC64 OFFを共通に使い、1.4〜1.9秒と2〜4秒の窓RMS／sample peakを記録。

各フォルダーに `sound.json`、`request.json`、`phrase.mid`、`report.json`、`audition.wav`、聴き比べ用の `listening.wav`／`listening.json` ができます。測定値は固定ゲインのDSP出力から計算します。聴き比べ用だけ-20 LUFSを目標に別途ゲインを調整し、sample peak -1 dBFS制限で目標に届かない場合は `peakLimited` を記録します。True Peak制限ではありません。WAVは16-bit PCMのため、測定値と符号化後には量子化差があります。

音律を含む全初期パラメータは `report.json` の `params` に保存します。再測定には `audition:preset -- phys --preset "Pure Flute" --patch .cache/glass-performance/flute-24edo/report.json --request .cache/glass-performance/flute-24edo/request.json --out .cache/flute-repeat` のように両方を指定してください。`sound.json` は従来どおり音律を除く音色差分です。

ドライ条件はRoomとSympathetic Mixを0にします。ボディ共鳴など音源内部の響きは残り、純粋な減衰定数や音のリアルさを測る値ではありません。湿潤条件との比較も、Roomパラメータ以外を揃えて行ってください。

任意の `--request` に、次の追加項目を指定できます。時間は秒、値はパラメータの実単位です。

```json
{
  "curves": [{"id":"breath_pressure","interpolation":"linear","points":[[0,0.2],[0.3,0.65],[1.3,0.55],[1.45,0],[1.6,0.6],[3,0]]}],
  "windows": [{"name":"held","start":1.4,"end":1.9}]
}
```

これは上記requestへの追加部分です。音符・sampleRate等も必要です。カーブは128サンプル周期で更新し、最初の点より前は初期パッチ値、最後の点以降は最後の値を保持します。`linear` または `step`、最大16パラメータ・各1000点。時刻の重複／逆順、範囲外、未対応パラメータは拒否します。対応IDは `bow_pressure`、`bow_speed`、`breath_pressure`、`breath_noise`、`wind_embouchure`、`brass_pressure`、`phys_vibrato_cents`、`filter_cutoff_hz`、`fm_index`、`osc1_wt_position`、`osc2_wt_position`（音源に存在するもののみ）。モデルごとに有効なパラメータを選んでください。既存ボイスへの反映方法は各DSPの仕様に従います。

カーブは `request.json` に保存し、`phrase.mid` には含まれません。REAPERでは対応パラメータのオートメーションとして別途入力してください。比較のfingerprintにはカーブと測定窓も含むため、条件の違うレポートの自動差分は拒否します。カーブあり／なしの聴き比べは別条件として評価します。

Physicalのブラウザ表示とJSFXメーター欄にはCC64状態と現在のモデル／Sustain Pedal設定への適用可否を表示します。ブラウザはアプリが保持するCC64状態、JSFXはそのインスタンスが受信した状態です。オフラインレポートの `performance.pedalTrace` は実際の参照DSPへ送ったCC64／Reset Controllers／All Notes Off時の状態です。REAPERの別トラックのペダル状態を読み取る機能ではありません。

## プリセット配布ファイルを照合する

テキストのハッシュは改行CRLFをLFに統一して計算します。Windowsと他の環境でのcheckout差を無視します。

```powershell
npm run gen:jsfx
npm run check:catalogs
npm run install:reaper -- --resource "C:/actual/REAPER/resource"
npm run check:catalogs -- --resource "C:/actual/REAPER/resource"
```

生成時に `jsfx/generated/manifest.json` へ配布ファイルのSHA-256、contentId、音源別のプリセット名を記録します。インストーラーは `presets.json` とmanifestも同じ生成物としてコピーします。照合コマンドは読み取り専用で、現在のcheckoutに対する古い／欠けた／変更された配布物と、automation.json／presets.jsonの名前・順序の不一致を検出します。失敗時は終了コード1、JSONの `failures` またはエラーメッセージを返します。更新時は再生成→再インストール→再照合してください。

GLASS TIDEで報告されたフリーリード一覧の表示差について、現在のソース／生成JSON／Lua／RPLでは不足を再現していません。過去の取得元・バージョンは特定できないため原因は未確定です。既存のAccordion／Bandoneon／Harmonica／Reed Organを重複追加する変更は行っていません。
