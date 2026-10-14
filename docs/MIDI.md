# AmiSynth MIDI対応表

この表は `src/dsp/midi.js` と各JSFXのMIDI処理を基準にした現在の実装です。「未対応」は音源の音に反映しないという意味です。Web画面での振り分け・表示と、JSFXのMIDIパススルーは後述します。

## ノート・ベンドなど

| メッセージ | Synth | Physical | Drums |
| --- | --- | --- | --- |
| Note On (velocity 1〜127) | 発音。Poly／Mono／Legato、Arp設定に従う | 選択したモデルで発音 | GM Level 1 の 35〜81 (58、71〜74、78、79 を除く) を19パーツで発音 |
| Note Off | リリース。CC64中は保留 | モデル別のRelease Damping。CC64対応モデルでは保留 | 無視。ワンショットの自然減衰に従う |
| Note On (velocity 0) | Note Offと同じ | Note Offと同じ | 無視 |
| Velocity | `amp_velocity_amount`、フィルター量などへ反映 | `phys_velocity_amount`とモデル別の励振・音色へ反映 | パーツの発音強度へ反映 |
| Pitch Bend (14 bit) | 対応。`pitch_bend_range_cents` (既定200 cents) | 対応。`phys_pitch_bend_range_cents` (既定200 cents) | 未対応 |
| Program Change | 音源では未対応。Web画面では GM の番号で Synth／Physical と近いプリセットへ切り替える (ch10 以外) | 同左 | 未対応 |
| Channel Pressure (0xD0) | 対応。モジュレーション・マトリクスのソース「Pressure」 | 対応。`phys_pressure_*` の量で息・弓圧・明るさ・ビブラートへ (既定0 = 無効) | 未対応 |
| Polyphonic Aftertouch (0xA0) | 対応。そのキーのボイスだけの「Pressure」 | 対応。そのキーのノートだけに効く | 未対応 |
| MIDI Clock / Start / Continue / Stop / Song Position | 未対応 | 未対応 | 未対応 |
| SysEx / MIDI Tuning Standard / MPE | 未対応 | 未対応 | 未対応 |

Pitch Bendの中心は8192 (`[0xE0, 0, 64]`)です。ベンド幅は上記のパラメーターで指定し、RPN経由では変更できません。SynthのArp／LFO同期には、REAPERのホストテンポ・拍位置、またはWeb版のBPMを使います。Scala／EDO調律は調律パネル、ファイル、AmiSynth Tuningで設定します。

## Control Change (CC)

以下は既定の割り当てです。Synthの任意カットオフCCを変更した場合は、その番号も追加で反応します。

| CC | 一般的な用途 | Synth | Physical | Drums |
| --- | --- | --- | --- | --- |
| 0 / 32 | Bank Select | 未対応 | 未対応 | 未対応 |
| 1 | Modulation | LFOによるビブラート／フィルター変調の追加量 | ロータリースピーカーが Slow の時、64 以上で Fast に切り替え | 未対応 |
| 7 | Volume | 未対応 | 未対応 | 未対応 |
| 10 | Pan | 未対応 | 未対応 | 未対応 |
| 11 | Expression | 未対応 | 未対応 | 未対応 |
| 64 | Sustain / Damper | 対応 | Off／Auto／On設定に従う | 未対応 |
| 66 / 67 | Sostenuto / Soft Pedal | 未対応 | 未対応 | 未対応 |
| 71 | Resonance等 | 既定では未対応 | 未対応 | 未対応 |
| 74 | Brightness | フィルターカットオフの相対変調 | 未対応 | 未対応 |
| 120 | All Sound Off | 全ノートをリリース。即時無音化ではない | ペダル解除と全ノートのリリース。即時無音化ではない | 未対応 |
| 121 | Reset All Controllers | 音源処理では未対応 | ペダル解除、ピッチベンドの中心復帰、プレッシャー (チャンネル／全キー) を0へ。押鍵中のノートは維持 | 未対応 |
| 123 | All Notes Off | 全ノートをリリース | ペダル解除と全ノートのリリース | 未対応 |
| その他 (RPN / NRPNを含む) | 各種制御 | カットオフ用に指定したCC以外は未対応 | 未対応 | 未対応 |

### SynthのMod Wheel・カットオフ

- **CC1**: 0〜127を0〜1へ変換し、`modwheel_vibrato_cents` と `modwheel_filter_oct` を上限として現在のLFOによる変調を追加します。既定ではビブラート深さ30 cents、追加のフィルター深さ0 octです。パラメーターが0なら対応していてもその変調は聞こえません。
- **CC74**: 値64を中心としてカットオフを相対的に動かします。0／127は `cc_cutoff_depth_oct` (既定4 oct)だけ下／上です。CC値にHzを直接送る方式ではありません。
- **割り当て変更**: `cc_cutoff_number` で1〜127の任意のCCを選べます。0は無効です。CC1・64・120・123など既存の動作がある番号へ割り当てると、カットオフと元の動作の両方が反応します。通常は74など重複しない番号を使ってください。RPN／NRPNメッセージ列としての解釈やMIDI Learnはありません。

### アフタータッチ (Channel Pressure / Polyphonic Aftertouch)

どちらも0〜127を0〜1へ変換します。ノートごとの値は「チャンネルプレッシャーとそのキーのポリフォニック・アフタータッチの大きい方」です。新しく弾いたノートのポリフォニック・アフタータッチは0から始まります。

- **Synth**: 値だけでは音は変わりません。モジュレーション・マトリクスのスロットでソースを **Pressure** にし、行き先 (カットオフ、ピッチ、音量など) と量を選びます。急な段差でジッパーノイズが出ないよう10 msでならします。行き先が LFO 1 / LFO 2 Rate の場合はグローバルなので、チャンネルプレッシャーだけが効きます。Arp中は鳴っている音がアルペジオのノートなので、ポリフォニック・アフタータッチは届きません (チャンネルプレッシャーを使ってください)。
- **Physical**: Pressure グループの3つの量で割り当てます。`phys_pressure_excitation` は管楽器の Breath Pressure・金管の Blowing Pressure・擦弦の Bow Pressure へ加算、`phys_pressure_brightness` は擦弦の駒と金管のベルの明るさへ加算、`phys_pressure_vibrato_cents` はノートごとのビブラートを深くします (遅延線モデルのみ)。既定はすべて0で、プレッシャーを送っても音は変わりません。
- **Drums**: 反応しません。
- **Web版**: 画面の鍵盤横の **Press** ストリップがチャンネルプレッシャーを送ります (押している間だけ。離すと0)。タッチの押す強さはブラウザでは確実に取れないため、指の位置で量を決めます。外部MIDIのチャンネルプレッシャー／ポリフォニック・アフタータッチもそのまま音源へ渡り、チャンネルプレッシャーはストリップの表示にも反映します。

### サステインと全ノート解放

CC64は64以上で踏み込み、63以下で解除です。ハーフペダルには対応していません。Web版の **Sustain** ボタンもCC64を送り、Synth／Physicalを切り替えると解除します。

Physicalの `phys_sustain_mode` は、**Off** が無効、**Auto** (既定)が撥弦・ピアノ・Drum Membrane以外のモーダル素材、**On** が全モデルです。自然減衰は続き、ペダル解除時にRelease Dampingを適用します。[Physicalの操作説明](../jsfx/README.md#physical-のサステインペダル-cc64)

SynthのCC120／123は、音源内部ではペダル・Mod Wheel・ベンド・カットオフCC値・プレッシャーをリセットしません。Arpの保持鍵は消去します。CC64はノートオフの保留であり、Arpへ渡した和音の保持 (Latch)ではありません。

Web MIDI入力では、CC120／121／123を受けた時に画面側が追加でCC64=0を送ってSustainボタンを解除します。CC120／123では鍵盤の表示も消去します。このため、Synthのペダル解除に限ってWeb画面経由とJSFX／DSPへの直接送信には差があります。CC121でSynthのベンドやMod Wheelをリセットする処理はありません。

CC120／123はどちらもリリース処理です。SynthのRelease、PhysicalのRelease Dampingや部屋の残響が残る場合があります。緊急に即時無音化したい場合は、REAPER側のトラックミュートなどを使ってください。DrumsにはCCによる全音停止処理がありません。

## チャンネルとJSFXチェーン

- **Web MIDI入力**: ch10のNote OnはDrumsへ、その他のチャンネルは現在選択中のSynth／Physicalへ送ります (アフタータッチを含む)。ch10のCC・ベンド・アフタータッチはWeb画面の振り分けで無視します。
- **DSP／JSFXへの直接入力**: チャンネルを区別せず、同じ音源インスタンス内で処理します。REAPERのDrumsもch10専用ではなく全チャンネルのノートに反応します。チャンネル別の音色・ベンド・ペダル状態はありません。必要ならホスト側でフィルターし、音源を分けてください。
- **JSFXのパススルー**: Synth／Physical／Drumsは受けたMIDIを後段へ渡します。未対応CCも後段へ届くことがあります。「この音源では未対応」と「FXチェーン全体で無視される」は別です。AmiSynth TuningもオーディオとMIDIを通過させるユーティリティです。

## MIDIとパラメーター設定の区別

CCは0〜127の値です。プリセットJSON、Companion、MCPからのスライダー操作で使うHz・ms・dB等の実値とは別です。Volume／Pan／ExpressionのCCを使いたい場合、現状はホストで割り当てるか、対応する音源パラメーターを直接設定してください。JSFXではProgram Changeでプリセットは切り替わらず、REAPERのプリセットやCompanionを使います。Web画面は GM Level 1 の番号から楽器と最も近い内蔵プリセットを選びます (対応表は `src/presets/gm.js`。オルガン・アコーディオン・ハーモニカなど専用の音がないものは近い音で代用)。

設定可能なパラメーター全体は [生成カタログ](../jsfx/generated/automation.json)、実値／正規化値の使い分けは [MCP設定検証の説明](../jsfx/README.md#mcp-向けのカタログ設定検証)を参照してください。

確認対象: [MIDIディスパッチ](../src/dsp/midi.js)、[Web MIDI入力](../src/App.svelte)、[Synth DSP](../src/dsp/synth.js)、[Physical DSP](../src/dsp/phys.js)、[JSFX](../jsfx/)、[共通MIDIキュー](../jsfx/amisynth_lib.jsfx-inc)。
