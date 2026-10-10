# AmiSynth

ブラウザで動く自作シンセ & ドラムマシンのデモ。DSP はすべて AudioWorklet 内の
「サンプル単位の素直なループ」で書かれていて、REAPER の JSFX (EEL2) へほぼ機械的に
移植できる形にしてあります。名前の由来は *LLM-friendly な synth*。

- **シンセ**: 2 オシレーター (Saw / Pulse / Triangle / Sine, PolyBLEP) + サブオシレーター + ノイズ、
  パルス幅と PWM、ハードシンク、osc2→osc1 の FM、ユニゾン (最大 4 重・ステレオ)、グライド、
  ドライブ、フィルター (LP / HP / BP / ノッチ, 12/24 dB, TPT SVF)、フィルター/アンプ ADSR、
  LFO (5 波形、ピッチ / フィルター / PWM / トレモロ)、8 ボイス、ピッチベンド / モジュレーションホイール、サステインペダル
- **物理モデル (Physical)**: 6 モデル
  - 弦 (Karplus-Strong: 遅延線 + ループ内ローパス、ピック位置、ハンマー励起)
  - モーダル合成 (2 極共振器 × 8 モード、マリンバ / ビブラフォン / グロッケン / グラス / 鐘 / 太鼓膜 / カリンバ等の素材表)
  - 擦弦 (デジタル導波管 + 弓の摩擦曲線によるスティック・スリップ、弓圧 / 弓速 / 弓の位置、簡易な胴体共鳴)
  - 管楽器 (クラリネット = リード + 円筒管 + 高域が逃げる反射、フルート = エアジェット (Fletcher / Verge 型) + 管。息の圧力 / 揺らぎ / ノイズ / アンブシュア)
  - 膜 / 板 (2D 波動方程式の差分格子、円形膜 / 正方形板、打点 / マレットの硬さ。同時発音 3)
  - 硬い弦 (ピアノ風: ループ内のオールパスで分散 → 実測に近い倍音のストレッチ、フェルトハンマーの非線形接触モデル (強く弾くほど明るい)、16 共鳴の響板、1 音 2 本の弦のうなり)
  - 共通: ビブラート (遅延線モデル)、部屋の響き (4 本の遅延線による FDN リバーブ)、リリース、ベロシティ、ステレオ幅
  - 任意で内部状態の可視化 (弦・管の中の波 / 弓のスティック・スリップ / 各モードの振幅 / 膜の変位 / 倍音のずれ) — OFF の間は追加負荷なし
- **ドラム** (サンプル不使用・全部合成, GM 配置): キック 36 / リム 37 / スネア 38 / クラップ 39 /
  クローズ HH 42 / ロータム 45 / オープン HH 46 / ミッドタム 47 / クラッシュ 49 / ハイタム 50 /
  ライド 51 / カウベル 56 / シェイカー 70。クローズ HH によるチョーク、パーツごとに音程・減衰・トーン・音量・パン (+α)
- **プリセット**: シンセ 16 種・ドラムキット 5 種を内蔵。ユーザープリセット保存 (ブラウザ内)、
  JSON コピー / 貼り付け (既定値との差分だけを書く形式なので、LLM に作ってもらってそのまま貼れる)
- **チューニング**: 12 平均律に依存しない。任意の EDO・周期 (例: Bohlen-Pierce)・
  Scala (.scl) / cents / 比のリストによるカスタム音階。ピッチベンドやデチューンは cents 指定
- **4 小節ピアノロール** + ドラムステップ (サンプル精度でスケジューリング)
- PC キーボード / 画面鍵盤 (ピアノ・1 列・等音の格子 / 六角形、全画面モード。縦持ちのスマホ / タブレットでは画面内で 90° 回転して横向きに使える) / Web MIDI 入力 (ch10 → ドラム)。
  等音配列では PC キーボードの段 (Z 段〜数字段) がそのまま格子 / 六角形の段になる
- **JSFX 版 (REAPER)**: `jsfx/` に Synth / Physical / Drums。Web 版とサンプル単位で同じ音 (ysfx で自動比較)。
  ピアノロールの「MIDI 書き出し」で作った .mid をそのまま REAPER で鳴らせる → [jsfx/README.md](jsfx/README.md)

## 開発

```sh
npm install
npm run dev        # http://localhost:5173
npm test           # DSP のユニットテスト (Node)
npm run build      # dist/ に静的ファイルを出力
npm run gen:jsfx   # params.js → JSFX のスライダー宣言 (jsfx/*.jsfx と jsfx/generated/)
npm run jsfx:tools # ysfx をビルドして JSFX 比較テストを有効にする (任意)
```

## 構成

```
src/dsp/params.js      パラメータ定義 (名前・範囲・既定値・単位・説明) — 唯一の定義元
src/dsp/lib.js         共通 DSP: オシレーター, SVF, 1 pole, ADSR, 減衰 EG, ノイズ, チューニング
src/dsp/synth.js       シンセ本体 (init / update / note_on / render)
src/dsp/drums.js       ドラム本体
src/dsp/phys.js        物理モデル音源 (弦 / モーダル / 擦弦 / 管 / 膜・板 / 硬い弦)
src/presets/*.js       内蔵プリセット (既定値からの差分だけを記述)
src/worklets/*.js      AudioWorklet ラッパー (MIDI バイト列 + パラメータだけを受け取る)
src/lib/               メインスレッド: エンジン、状態、シーケンサー、チューニング補助
src/ui/                Svelte コンポーネント
scripts/gen-jsfx-sliders.js  params.js → JSFX slider 宣言 / params.json / presets.json
jsfx/                  JSFX 移植メモと生成物
```

設計上のポイント:

- DSP コードは Web Audio に依存しない (`src/dsp/*` は Node でもそのまま動く。テスト参照)。
  Web Audio の組み込み DSP ノード (Oscillator / BiquadFilter / Gain 等) は使っていない。
  AnalyserNode をスコープ表示のためだけに接続している。
- Worklet へは **MIDI バイト列** (`[0x90, note, vel]` など) と **パラメータ値** だけを送る。
  JSFX が REAPER から受け取るものと同じ。タイムスタンプ付き MIDI はサンプル単位で適用
  (JSFX の `midirecv` オフセットに相当)。
- パラメータ ID は snake_case で単位入り (`filter_cutoff_hz`, `amp_release_ms`, …)。
  REAPER のオートメーションや MCP から名前だけで意味が分かるようにしている。
- ブラウザのコンソールから `window.amisynth` (engine / app / setParam) で操作可能。

## デプロイ (Cloudflare Workers, 静的アセット)

`wrangler.jsonc` は Worker スクリプトなしで `dist/` を配信する設定です。

### 第一候補: Workers Builds (GitHub 連携で自動デプロイ)

1. Cloudflare ダッシュボード → **Workers & Pages** → **Create** → **Import a repository**
2. この GitHub リポジトリを選択
3. ビルド設定
   - Build command: `npm run build`
   - Deploy command: `npx wrangler deploy`
   - (Non-production branch deploy command: `npx wrangler versions upload`)
4. 以後、push するたびに自動でビルド & デプロイされます

> 本番以外のブランチでは Workers Builds が `npx wrangler preview` を **ビルドコマンドなしで**
> 実行するため、`package.json` の `prepare` スクリプトで `npm clean-install` 時に
> `vite build` が走るようにしてあります (`wrangler preview` は起動直後に `dist/` の存在を確認するため)。

### 代替: API トークンで wrangler deploy

```sh
export CLOUDFLARE_API_TOKEN=...   # "Edit Cloudflare Workers" テンプレートのトークン
export CLOUDFLARE_ACCOUNT_ID=...
npm run deploy                     # = vite build && wrangler deploy
```

(`wrangler login` は不要。サンドボックス環境ではネットワーク許可に `api.cloudflare.com` が必要)
