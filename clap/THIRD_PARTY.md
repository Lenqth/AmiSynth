# AmiSynth CLAP: third-party components

`AmiSynth.clap` contains AmiSynth (MIT, see the repository's `LICENSE`) and the following
components. Their license texts are shipped next to the plugin as `licenses/*.txt`.

| Component | Use | License |
| --- | --- | --- |
| [ysfx](https://github.com/JoepVanlier/ysfx) (ysfx-s fork, v0.0.47) | runs the JSFX | Apache-2.0 (`licenses/ysfx.txt`) |
| [WDL / EEL2](https://www.cockos.com/wdl/) (bundled with ysfx) | the JSFX compiler | zlib-style WDL license (`licenses/WDL.txt`) |
| [dr_libs](https://github.com/mackron/dr_libs) (bundled with ysfx) | audio file reading in ysfx | public domain or MIT-0 (`licenses/dr_libs.txt`) |
| [CLAP](https://github.com/free-audio/clap) | plugin API headers | MIT (`licenses/clap.txt`) |

Only ysfx's library is used: not its JUCE-based plugin (AGPL), and no graphics code.
