# FFmpeg incluído no NTC Utilities 0.8.0

O instalador inclui os executáveis estáticos FFmpeg e FFprobe da build GPL v3 para Windows x64 abaixo. Os SHA-256 foram comparados com os arquivos oficiais dessa publicação:

- Versão: `N-125875-g5d4d3bdc61-20260731`
- Publicação da build: [yt-dlp/FFmpeg-Builds — autobuild-2026-07-31-16-16](https://github.com/yt-dlp/FFmpeg-Builds/releases/tag/autobuild-2026-07-31-16-16)
- Código-fonte do FFmpeg: [commit 5d4d3bdc61](https://github.com/FFmpeg/FFmpeg/commit/5d4d3bdc61)
- Código-fonte dos scripts e receitas da build: [revisão f523eabde4d012ad85cd75e9a3cd6bc619f868c6](https://github.com/yt-dlp/FFmpeg-Builds/tree/f523eabde4d012ad85cd75e9a3cd6bc619f868c6)
- FFmpeg (`ffmpeg.exe`): `851AA8EA5366B5AF33C0681CC292D662829C7088E9AC96F6E9B37030E6835BA4`
- FFprobe (`ffprobe.exe`): `01DD9A776DB5DF93D0E3A9B8714A7A7500402E8E628CDC68608ED781454F8B71`

A configuração compilada pode ser consultada executando `ffmpeg.exe -buildconf`. A revisão dos scripts acima documenta a configuração do Windows x64 GPL e as origens/revisões das bibliotecas externas utilizadas. Os avisos e textos de licença aplicáveis estão incluídos na publicação original e neste aplicativo.

Para uma compilação limpa do NTC Utilities, `scripts/fetch-binaries.ps1` baixa exatamente essa publicação e valida os hashes dos dois executáveis antes de usá-los.
