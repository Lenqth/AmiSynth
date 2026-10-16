# アジアの楽器プリセット（第1弾）

Physicalに11音色を追加しています。既存の弦・擦弦・フリーリード・ダブルリードモデルによる音色スケッチです。実楽器の測定に基づく再現ではなく、奏法・胴・弦材・管の違いをすべて表現するものではありません。地域は紹介のための代表例で、楽器の分布を一国に限定する意味ではありません。

| プリセット | 楽器・地域 | 使うモデル／狙った特徴 | 試奏MIDI音域（推奨） | 奏法・限界 |
| --- | --- | --- | --- | --- |
| Guzheng | 古筝・中国 | 弦／明るい弾き始めと長い余韻 | 48–84 | 押弦の装飾はpitch bendで入力。自動グリッサンドなし |
| Pipa | 琵琶・中国 | 弦／硬い発音と短い減衰 | 48–81 | 輪指は音符を反復入力。接触・胴共鳴は汎用モデル |
| Gayageum | 伽倻琴・韓国 | 弦／丸い発音と高域の減衰 | 48–79 | 揺れ・押弦は手動。絹弦などの材質を個別再現しない |
| Erhu | 二胡・中国 | 擦弦／中高域の旋律向け | 55–84 | 弓圧カーブとpitch bendを使用。二弦・皮の胴を個別再現しない |
| Morin Khuur | モリンホール・モンゴル | 擦弦／低めの旋律、暗いブリッジ | 43–72 | ドローンは別の音符で入力。馬毛弦や専用胴モデルなし |
| Khaen | ケーン・ラオス | フリーリード／低い息ノイズ、musetteなし | 48–79 | 和音・ドローンを手動入力。竹管や吸気／呼気の違いなし |
| Dutar | ドゥタール・中央アジア | 弦／軽い発音と短めの木質的な余韻 | 45–76 | ストラムと持続音は手動。二弦の結合振動なし |
| Santur | サントゥール・西アジア | 弦＋ハンマー／明るい打弦と重なる余韻 | 48–84 | 連打は音符を反復入力。複弦コースなし |
| Suona | 嗩吶・中国 | ダブルリード／速い立ち上がりと明るい音 | 60–84 | 固有のベル・運指モデルなし |
| Taepyeongso | 太平簫・韓国 | ダブルリード／強い息圧と持続音 | 60–84 | 装飾はpitch bendで入力。専用のリード・金属ベルなし |
| Duduk | ドゥドゥク・アルメニア | ダブルリード／穏やかな発音と遅いビブラート | 50–74 | 既存の円錐管モデルによる近似。実器の円筒管・幅広いリードを再現しない |

音域と音色の形容は、このパッチを試すための設計上の目安です。実楽器の限界音域や聴感評価結果ではありません。プリセットは既存の音律を維持し、特定の地域の音階へ勝手に変更しません。音律はTuningで別途選んでください。Pitch bendはそのチャンネルの全ボイスに作用するため、独立した押弦装飾はトラック／チャンネルを分けて入力します。

## 試奏とMCPからの利用

```powershell
npm run audition:preset -- phys --preset "Guzheng" --guide --out .cache/asia/guzheng
npm run audition:preset -- phys --preset "Erhu" --guide --out .cache/asia/erhu
npm run audition:preset -- phys --preset "Khaen" --guide --out .cache/asia/khaen
```

11音色すべてに `playingGuide`（推奨音域・音符・velocity・テンポ）を付け、`generated/automation.json` と `catalog.lua` に反映しています。ガイドは短い試奏用で、伝統曲や典型的な旋法を示すものではありません。弓替え・息継ぎのカーブ例は[制作ワークフロー](PRODUCTION_WORKFLOW.md)を参照してください。

REAPERへは最新checkoutで `npm run gen:jsfx` → `npm run install:reaper -- --resource "実際のリソースパス"` → `npm run check:catalogs -- --resource "実際のリソースパス"` と実行します。新しいMCPツールは増えません。既存のRunの `presets` を再取得し、`preset` またはApply soundの `base` に正確な名前を渡してください。

配布される `.rpl`、JSON、Luaをまとめて更新しています。既存92音色の順序・値、GMの割り当て、スライダー番号とデフォルト値は維持します。Physicalは合計103音色になります。比較HTMLは追加しません。

## 音量の測定範囲

既存の `preset-loudness.js` の和音＋単音フレーズ（48 kHz、120 BPM、velocity 100）で、静的な音量をおおむね-18 LUFSへ調整しました。Pipaは短い減衰を維持し、音量パラメータ上限+6 dBで約-18.85 LUFSです。音量を揃える目的で減衰を長くする変更は行っていません。他10音色は約-18.05〜-17.96 LUFSでした。

これは聴感上の音量一致やリアルさを保証しません。推奨ガイドは音域・テンポが異なるため同じLUFSにはなりません。REAPERのフェーダー・外部FXも測定外です。

## 楽器の分類・背景の参照先

以下は楽器の分類と地域の確認に使用しました。DSPの数値や音色調整値は独自の近似設計です。

- 中国の琵琶・二胡：[Met・Pipa](https://www.metmuseum.org/art/collection/search/503651)、[Met・Erhu](https://www.metmuseum.org/art/collection/search/500616)。
- 古筝など東アジアの箏類：[香港康楽及文化事務署の公演解説](https://www.lcsd.gov.hk/CE/CulturalService/Programme/pdf/program_note1_259_2.pdf)。
- 伽倻琴：[韓国国立国楽院の楽器紹介](https://artsandculture.google.com/story/QQXBWFVCGDVvKQ?hl=en)。
- モリンホール：[UNESCO](https://ich.unesco.org/en/RL/traditional-music-of-the-morin-khuur-00068?lang=en)。
- ケーン：[UNESCO](https://ich.unesco.org/en/RL/khene-music-of-the-lao-people-01296)。
- ドゥタール：[UNESCO・トルクメニスタンの製作と演奏](https://ich.unesco.org/en/RL/dutar-making-craftsmanship-and-traditional-music-performing-art-combined-with-singing-01565?RL=01565)。
- サントゥール：[Metの収蔵例（トルコ）](https://www.metmuseum.org/art/collection/search/500992)。
- 嗩吶：[Met](https://www.metmuseum.org/art/collection/search/500597)。
- 太平簫：[韓国国立国楽院](https://archive.gugak.go.kr/portal/vr/selectVrDetail?seq=19)。
- ドゥドゥク：[UNESCO](https://ich.unesco.org/en/RL/duduk-and-its-music-00092?RL=00092)。

## フリーリードの低域のプツ音

Accordion／Harmonica／Khaenでは、リードが静止した状態でもバイアス付きスロットに気流がある一方、発音時の放射差分の履歴を0で初期化していました。この差が最初の1サンプルで大きなパルスになり、周波数で正規化するため低域で特に増幅されていました。Bandoneon／Reed Organは静止時気流が0の設定で、この初期パルスが生じない条件でした。

JS／JSFXとも放射差分の履歴を静止時の気流で初期化し、musetteの3リード分も考慮するよう修正しています。48 kHz・MIDI 28・velocity 100・Room 0の左出力の最初のサンプルは、Accordionが約0.995→-0.0000023、Harmonicaが1→-0.000127、Khaenが約1→-0.000060となりました。残る微小出力は発音と息ノイズです。症状に一致する初期パルスの数値検証であり、別の原因のクリックまで聴感で否定したものではありません。
