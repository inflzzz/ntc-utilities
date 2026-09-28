# Dependências de terceiros

O NTC Utilities inclui lógica e recursos adaptados do Blur AutoClicker v3.9.6, de Blur009, distribuído sob a GNU General Public License v3.0. Fonte: https://github.com/Blur009/Blur-AutoClicker. A cópia integral da GPL-3.0 acompanha o projeto no arquivo `LICENSE`.

O instalador Windows do NTC Utilities inclui os binários abaixo para que o usuário não precise instalar ferramentas adicionais.

| Componente | Finalidade | Licença |
| --- | --- | --- |
| yt-dlp | Obter informações e baixar mídia autorizada | Unlicense |
| FFmpeg | Converter e combinar mídia | GNU GPL v3 ou posterior |
| FFprobe | Inspecionar mídia | GNU GPL v3 ou posterior |

Os binários correspondem à build estática GPL v3 do FFmpeg indicada em [`FFMPEG_BUILD_INFO.md`](FFMPEG_BUILD_INFO.md). O arquivo registra a versão, os hashes, o código-fonte do FFmpeg e a revisão dos scripts usados para compor a build.

## Lucide Icons

O player de música incorpora desenhos SVG dos ícones Shuffle, Skip Back, Play, Pause, Skip Forward, Repeat, Repeat 1 e Settings do Lucide Icons. Fonte: https://github.com/lucide-icons/lucide/tree/main/icons. Licença ISC, Copyright (c) 2026 Lucide Icons and Contributors:

Permission to use, copy, modify, and/or distribute this software for any purpose with or without fee is hereby granted, provided that the above copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.

## Meteocons

The world clock uses SVG weather icons from [Meteocons](https://github.com/basmilius/meteocons), copyright Bas Milius, distributed under the MIT License. The full license text is included with `@meteocons/svg-static` in `node_modules/@meteocons/svg-static/LICENSE`.

## Open-Meteo

Weather conditions and city geocoding in the world clock are provided by [Open-Meteo](https://open-meteo.com/) and attributed in the app. Open-Meteo data is provided under CC BY 4.0; its free API is intended for non-commercial use and is subject to its published terms and rate limits.

## pdf-lib

The Security area uses [pdf-lib](https://github.com/Hopding/pdf-lib) to remove document information and XMP metadata from PDF copies. pdf-lib is distributed under the MIT License; its license text is included with the package.

## PDF.js

The dedicated PDF reader uses [PDF.js](https://github.com/mozilla/pdf.js) to render documents locally in the app. PDF.js is distributed under the Apache License, Version 2.0; the full license text is included with the package.

## Supabase JavaScript

The NTC Online service uses [`@supabase/supabase-js`](https://github.com/supabase/supabase-js) for authenticated database and Realtime access. It is distributed under the MIT License; the license text is included with the package.

## gmp-wasm / GMP / MPFR

The isolated Luck 2.0 precision-math infrastructure uses `gmp-wasm` 1.3.2,
distributed under LGPL-3.0-only, with GMP 6.3.0 and MPFR 4.2.1 source materials.
The replaceable runtime is shipped outside `app.asar`; versioned notices,
source archives, and rebuild guidance are under
[`resources/ntc-math-backend/1.3.2`](resources/ntc-math-backend/1.3.2). This is
technical licensing information, not legal advice.
