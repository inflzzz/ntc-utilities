# RNG Phase 5 — isolated shadow observer

## Authority and opt-in

The legacy `selectedRngRollBatch` remains the only game-facing authority. The
`NTC_RNG_ENGINE` router is unchanged (`legacy` by default; unavailable `luck2`
still fails closed). A separate `NTC_RNG_SHADOW=1` flag enables the diagnostic
observer; it is off by default and is not enabled by `NTC_RNG_ENGINE=luck2`.
Optional bounded local NDJSON logging requires both `NTC_RNG_SHADOW=1` and
`NTC_RNG_SHADOW_LOG=1`, and is disabled in packaged builds.

`performRngRoll` invokes the legacy batch exactly once and completes the
existing state/reward/persistence path. Only after that synchronous legacy call
returns does the bridge schedule a `setImmediate` observer request for Auto
Rolls. Manual Rolls intentionally skip the observer in this first integration.
The shadow worker gets only a request id and a fixed `canonical-neutral-auto`
context. It loads and verifies the immutable v1 artifact itself, initializes
the certified MPFR backend, then samples with independent worker-side crypto
entropy. It receives no player state, legacy result, event, or reward data;
its selected title is used only in local diagnostic output.

## Bounded execution and failure behavior

One worker is created lazily and reused. Only one sample can be in flight;
requests while scheduled/busy are dropped, never queued. A failed worker enters
a 60-second retry cooldown; initialization has a 15-second timeout and a
sample exceeding two seconds is discarded. Errors, invalid hashes, precision
failure, backend failure, and shutdown cannot change the legacy outcome.
The parent also kills a worker that does not answer within three seconds, then
applies the cooldown.
The worker is retired after 100 completed samples to cap the observed WASM/V8
high-water memory of one long-lived worker; a later request initializes a new
worker. Shutdown clears pending scheduling and terminates the worker without
waiting on it.

Logging is off unless explicitly enabled. When enabled, the service writes only
technical metadata to `<userData>/diagnostics/rng-shadow.ndjson`; it keeps the
current file to 512 KiB and one rotated file, dropping log writes rather than
building an asynchronous write queue. No telemetry is sent to Supabase or any
remote endpoint, and no renderer/IPC/UI receives shadow output.

## Explicit limits

This phase does not enable Luck 2.0 as an authority, migrate legacy Luck,
compare independent sampled results, run shadow for Manual, or enable new game
design systems. Auto shadow is neutral `R=1`, no Temporary Luck, normal Roll
Plan v1. It is a local execution/performance/invariant probe only.
