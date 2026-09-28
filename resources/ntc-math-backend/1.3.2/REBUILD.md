# Rebuilding or replacing the NTC MPFR backend

This directory contains the versioned identity, license notice, and source
materials for the replaceable `gmp-wasm` runtime. The executable UMD bundle is
distributed separately at `dist/index.umd.js`, outside `app.asar`.

## Pinned build inputs

- `gmp-wasm` npm package: 1.3.2 (`source/gmp-wasm-1.3.2.tgz`)
- GMP: 6.3.0 (`source/gmp-6.3.0.tar.xz`)
- MPFR: 4.2.1 (`source/mpfr-4.2.1.tar.xz`)
- The source package contains the binding scripts and Dockerfiles used by its
  upstream build. Review those scripts and their documented toolchain before
  rebuilding. Upstream currently builds its native bindings with Emscripten/
  Docker; this repository does not claim a reproducible bit-for-bit build.

## Replacement procedure

1. Obtain and review the corresponding source archives and upstream build
   instructions. Preserve upstream notices and make any source/toolchain changes
   available as required by the applicable license.
2. Build an interface-compatible CommonJS/UMD entry at
   `dist/index.umd.js`. Required MPFR/GMP bindings and the runtime MPFR version
   are checked by `src/rng-luck2-precision.cjs`.
3. Update the runtime hash in `manifest.json` only after recording the artifact
   provenance. The hash labels the pinned artifact; it is not anti-cheat and is
   not a cryptographic proof of the source build.
4. Run `pnpm run validate:rng-math-backend` and `pnpm test`. A replacement with
   a compatible API and MPFR 4.2.1 can load as `compatible-uncertified`; an
   unsupported version or missing capability fails closed for this backend.
5. Keep the replacement outside `app.asar`, retain a user-accessible way to
   replace it, and distribute the applicable notices/source materials.

This document is technical distribution guidance, not legal advice. The
project must separately review the applicable LGPL obligations for each release.
