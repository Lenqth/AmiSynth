## ダウンロード

| ファイル | 中身 |
| --- | --- |
| `AmiSynth-jsfx-<版>.zip` | REAPER 用の JSFX (Synth / Physical / Drums / Tuning)・`.rpl` プリセット・ReaScript |
| `AmiSynth-clap-<版>-windows-x64.zip` | CLAP プラグイン (Windows x64) |
| `AmiSynth-clap-<版>-macos-universal.zip` | CLAP プラグイン (macOS, Apple Silicon / Intel) |
| `AmiSynth-clap-<版>-linux-x64.zip` | CLAP プラグイン (Linux x64) |

### REAPER (JSFX)

zip の中は REAPER のリソースフォルダと同じ構成 (`Effects/AmiSynth/`, `Scripts/AmiSynth/`) です。REAPER の Options → Show REAPER resource path で開いたフォルダにそのまま展開し、FX ブラウザで F5 (再読み込み) すると `AmiSynth Synth` などが出ます。スクリプトの登録は `Scripts/AmiSynth/reaper/README.md` を見てください。

### CLAP (REAPER 以外の DAW)

展開した `AmiSynth.clap` をユーザーの CLAP フォルダに置き、DAW でプラグインを再スキャンします。

- Windows: `%LOCALAPPDATA%\Programs\Common\CLAP`
- macOS: `~/Library/Audio/Plug-Ins/CLAP`
- Linux: `~/.clap`

macOS 版は署名・公証していないため、置いたあとに `xattr -dr com.apple.quarantine ~/Library/Audio/Plug-Ins/CLAP/AmiSynth.clap` を実行してください。詳しくは [docs/OTHER_HOSTS.md](https://github.com/Lenqth/AmiSynth/blob/main/docs/OTHER_HOSTS.md) にあります。
