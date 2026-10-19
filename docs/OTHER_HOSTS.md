# REAPER 以外で使う

AmiSynth を REAPER 以外の DAW やブラウザ単体で使う方法をまとめます。

| 方法 | 向いている用途 | 音 | 制限 |
| --- | --- | --- | --- |
| **ysfx-s プラグイン(VST3 / CLAP / AU)で JSFX を読み込む**(推奨) | Ableton Live、Bitwig、Cubase、Studio One、FL Studio、Logic など、普段の DAW で打ち込み・録音・オートメーション | REAPER の JSFX と同じ(下記「互換性の確認」) | Companion / MCP 用の Lua スクリプトは使えない。ドラムのパーツ別出力は DAW 次第 |
| ブラウザ版 + Web MIDI | MIDI キーボードで弾く、DAW から仮想 MIDI ポート経由で鳴らす | Web 版の DSP(JSFX と同じ音) | 音は DAW に入らない(ブラウザから直接出る)。テンポ同期なし |
| ブラウザ版で WAV / MP3 に書き出す | 打ち込んだフレーズを素材として DAW に貼る | 同上 | オーディオとしての取り込みなので、後から音色を変えるには書き出し直し |

## ysfx-s で他の DAW から使う

[ysfx-s](https://github.com/JoepVanlier/ysfx) は、JSFX を読み込んで動かす VST3 / CLAP / AU プラグインです(オープンソース。REAPER の開発元とは別のプロジェクト)。AmiSynth の JSFX をそのまま読み込めるので、音源を別に移植する必要はありません。

### 準備

1. [ysfx-s のリリースページ](https://github.com/JoepVanlier/ysfx/releases) から OS に合ったものをダウンロードし、DAW のプラグインフォルダ(VST3 / CLAP / AU)に入れます。
   - 音源として使うのは **instrument** 版(`ysfx-s instrument`)です。`ysfx-s FX` はエフェクト用です。
   - Windows では MSVC 再頒布可能パッケージが必要です(ysfx-s の README 参照)。
   - macOS では署名されていないため、`xattr -dr com.apple.quarantine "<プラグインのパス>"` で許可します。
2. AmiSynth の JSFX を任意のフォルダに配置します。リポジトリから次のように実行すると、`<フォルダ>/Effects/AmiSynth/` に音源・共通ファイル・プリセット(`.rpl`)だけをコピーします。Lua スクリプトはコピーしません。

   ```sh
   npm run install:reaper -- --resource "<フォルダ>" --jsfx-only --dry-run
   npm run install:reaper -- --resource "<フォルダ>" --jsfx-only
   ```

   `<フォルダ>` は先に作っておきます(例: `~/Documents/AmiSynth JSFX`)。手でコピーする場合は、`jsfx/` の `AmiSynth *.jsfx`、`*.jsfx-inc`、`*.jsfx.rpl` を同じフォルダに置きます。
3. Scala の音階ファイル(`tuning.txt`)を使う場合は、`Effects` と並べて `<フォルダ>/Data/AmiSynth/tuning.txt` に置きます。ysfx-s は `Effects` と `Data` が並んだ構成を REAPER と同じように扱います。

### DAW での使い方

1. インストゥルメント・トラックに **ysfx-s instrument** を挿し、画面の **Load** から `Effects/AmiSynth/AmiSynth Synth.jsfx`(または Physical / Drums)を選びます。
2. トラックに MIDI を入れると鳴ります。Web 版の「MIDI 書き出し」で作った `.mid` もそのまま使えます(メロディ ch1、ドラム ch10)。
3. 内蔵プリセットは、JSFX と同じフォルダの `.rpl` を ysfx-s のプリセット一覧から選べます(Synth 78 種、Physical 103 種、Drums 8 キット)。
4. パラメーターは DAW のオートメーションに 256 個分公開され、順番は JSFX のスライダー番号どおりです。`jsfx/generated/automation.json` の `paramIndex`(0 始まり)が DAW 上の番号に対応します。
5. アルペジエーターやテンポ同期 LFO / ディレイは、DAW のテンポと再生位置に同期します。

### 制限と注意

- **Lua スクリプト(Companion、MCP 用の Read sound / Apply sound / Run)は REAPER 専用**です。他の DAW では、ysfx-s の画面のスライダーかプリセットで音色を選びます。Web 版で作った音色を移すときは、値を ysfx-s のスライダーに手で入れます。
- **ドラムのパーツ別出力**(10 ch)は、DAW が ysfx-s に多チャンネル出力を割り当てられる場合だけ使えます(未確認)。メインの 2 ch には全パーツが入るので、通常はそのまま使えます。
- **AmiSynth Tuning の Slot 共有**は、同じプロセス内のプラグイン同士で共有されるメモリ(gmem)を使います。DAW がプラグインを別プロセスで動かす設定では共有できないので、各音源の Tuning Source を「EDO sliders」か「Scale file」にしてください。
- AmiSynth Tuning の Scale Status は、ファイルが無いときに「File not found」ではなく「File format error」と表示されます。どちらでも Degree スライダーの音階に切り替わる点は同じです。
- ysfx-s は REAPER の開発元とは別のプロジェクトなので、将来の版で挙動が変わる可能性があります。下記の手順でいつでも確認し直せます。

### 互換性の確認

ysfx-s の中核(ライブラリ)で AmiSynth の JSFX を動かし、Web 版の DSP とサンプル単位で比べる自動テストがあります。REAPER 向けの比較(`npm run jsfx:tools` → `npm test`)と同じ 30 項目で、全プリセット、アルペジエーター、エフェクト、アフタータッチ、Scala ファイル、AmiSynth Tuning との連携、メーター表示(`@gfx`)を含みます。

```sh
npm run jsfx:tools:ysfx-s   # ysfx-s v0.0.47 を .cache/ysfx-s に取得してビルド
npm run test:ysfx-s         # tests/jsfx.test.js を ysfx-s で実行
```

Linux / macOS で cmake と C++ コンパイラが必要です。メーター表示の確認(`jsfx_meter_check_s`)は freetype と fontconfig がある環境だけビルドされます。別の版を試すときは `YSFX_COMMIT=<コミット> npm run jsfx:tools:ysfx-s` とし、先に `.cache/ysfx-s` を消してください。

このテストはプラグイン本体(DAW との受け渡し)ではなく、ysfx-s のプラグインが内部で使う JSFX の実行部分を確認するものです。

## ブラウザ版を MIDI 音源として使う

Web 版(`npm run dev` または公開版)は、Chrome / Edge などの Web MIDI 対応ブラウザで MIDI 入力を受けられます。

1. 画面上部の **MIDI** ボタンを押し、MIDI 機器へのアクセスを許可します。ch10 はドラム、それ以外は選択中のメロディ音源(Synth / Physical)に送られます。プログラムチェンジでは GM 番号に対応する音色に切り替わります。
2. MIDI キーボードを直接つなぐ場合はこれだけで弾けます。
3. DAW から鳴らす場合は仮想 MIDI ポートを作り、DAW の MIDI 出力先をそのポートにします。
   - Windows: [loopMIDI](https://www.tobias-erichsen.de/software/loopmidi.html) などでポートを作る。
   - macOS: 「Audio MIDI 設定」→ MIDI スタジオ → IAC ドライバを有効にする。
   - ポートを作ってから Web 版の **MIDI** ボタンを押すと、入力として認識されます。

音はブラウザから直接出るので、DAW のミキサーやエフェクトは通りません。DAW で録音したいときは、OS のループバック機能などでブラウザの音を DAW の入力に回すか、次の書き出しを使います。

## 書き出して素材として使う

Web 版のピアノロール / ソングで打ち込んだものは、WAV / MP3 に書き出して DAW に貼れます。書き出し形式は WAV (16 bit) と MP3 (192 kbps) です。DAW 側で打ち込んだ MIDI を「MIDI 読み込み」で Web 版に取り込んでから書き出すこともできます。
