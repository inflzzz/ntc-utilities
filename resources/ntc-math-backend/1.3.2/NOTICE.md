# Third-party notices — NTC MPFR math backend

`gmp-wasm` 1.3.2 is distributed under LGPL-3.0-only. Its complete package
license is in `LICENSE-gmp-wasm.txt`; the corresponding npm source package is
provided in `source/gmp-wasm-1.3.2.tgz`.

The package's WebAssembly bindings incorporate GMP 6.3.0 and MPFR 4.2.1. Their
complete upstream source archives, including their license/copying files, are
provided in `source/gmp-6.3.0.tar.xz` and `source/mpfr-4.2.1.tar.xz`.

Upstream references:

- <https://github.com/Daninet/gmp-wasm>
- <https://ftp.gnu.org/gnu/gmp/gmp-6.3.0.tar.xz>
- <https://ftp.gnu.org/gnu/mpfr/mpfr-4.2.1.tar.xz>

The runtime is a separately replaceable file outside `app.asar`; see
`REBUILD.md`. This notice is a technical summary, not legal advice.
