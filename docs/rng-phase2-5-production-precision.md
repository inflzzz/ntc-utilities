# RNG Luck 2.0 — Fase 2.5: Production Precision Backend

Status: investigation/specification only. The legacy RNG remains active, `luck2` remains fail-closed, and no production sampler or reward path exists here.

## Decision sought

The Fase 2 math module is useful for inspection and comparison, but its binary64 transcendental calculations are not authoritative. This phase specifies how a future sampler could calculate `p^β` and make a decision without trusting a rounded decimal or arbitrarily resolving an uncertain boundary.

## Alternatives

| Option | Capabilities and fit | Main production risk |
| --- | --- | --- |
| A. Arbitrary-precision decimal/big-float | `decimal.js` is CommonJS-compatible, MIT-licensed, dependency-free itself, supports configurable significant-digit precision, `ln`, `exp`, and non-integer `pow`; its exponent range is sufficient for odds such as `1e-1000`. It is a strong diagnostic/initial-estimate tool. | Its public contract describes rounded results, not certified lower/upper enclosures for every transcendental operation. More digits are not a proof that a value lies on a particular side of a sampling boundary. It cannot be the authority by itself. |
| B. Fixed-point/log-space on `BigInt` | Integer operations and directed quotient/remainder rounding can be deterministic across supported JS runtimes. A scaled representation can keep a significand plus an unbounded integer binary exponent, so tiny positive values do not underflow to zero. | `ln`, `log10`, `exp`, and fractional power need carefully proven range reduction and remainder bounds. A home-grown math implementation is high-risk and must be reviewed and tested as numerical infrastructure, not ordinary game code. |
| C. Interval arithmetic / progressive bounds | Carry outward-rounded lower and upper endpoints through `ln`, multiplication by `β`, `exp`, sums, and normalization. It directly supplies the evidence the decision procedure needs. | An interval is only trustworthy if every primitive has a proved enclosure. A generic arbitrary-precision library or an `UP`/`DOWN` rounding setting does not by itself certify its transcendental implementation. No dependency is approved by this investigation as a certified Node.js interval backend. |
| D. Hybrid adaptive sampler | Use C's certified enclosures, but refine numerical precision and consume additional random bits only when the current random interval overlaps an uncertain cumulative boundary. Cache the ordinary case. | Requires a rigorously specified stream of unbiased random bits, monotone cumulative bounds, a hard resource ceiling, and fail-closed behavior. It is an algorithm on top of a sound interval backend, not a substitute for one. |

### Recommendation

Use **D over C** as the production-authoritative design. Keep the diagnostic binary64 backend. Option A may be evaluated as a non-authoritative estimate accelerator, but must never narrow certified bounds unless a separately verified error enclosure is applied. Implementing B/C's transcendental primitives requires a short design review and a proof/test strategy before code is written; this document is that justification, not authorization to write them or the sampler now.

No new dependency is recommended yet. `decimal.js` is a reasonable MIT-licensed comparison/diagnostic candidate, not a correctness certificate. A certified interval library with a suitable Node/Electron/CommonJS distribution should be re-evaluated before custom transcendental code is approved. Any added dependency requires license, maintenance, runtime, bundling, and differential-test review.

## Proposed numeric contract

### Inputs and representation

- Frozen snapshot base probabilities remain exact positive rationals `nᵢ/dᵢ` from the Pool System model. Do not convert those inputs through `Number`.
- Luck channel inputs remain decimal/scientific strings; their composition and the B∞ curve must also be evaluated with enclosed operations in the authoritative backend. The diagnostic `β: Number` is not an input to production sampling.
- Manual Power is the exact rational factor `199/200` applied to the enclosed Auto β. Manual and Auto use the same transform/sampler, distinguished only by the versioned mode parameter.
- Represent endpoints as directed dyadic values with a `BigInt` significand and an unbounded signed `BigInt` binary exponent (normalized scaled intervals). Do not store an extremely small probability as a fixed-scale integer in `[0,1]`; that would underflow values such as `1e-1000`.
- For each slot, enclose `wᵢ = exp(β · ln(nᵢ/dᵢ))`. Accumulate positive intervals with outward rounding, then enclose `Pᵢ = wᵢ / Σw`. Preserve the fixed slot order from the immutable snapshot. A neutral Auto fast path may return exact rational weights only after it is proved equivalent.

### Precision, bounds, and refinement

Candidate initial precision: **128 binary significant bits** for each interval operation. Candidate refinement schedule: double precision (`128, 256, 512, …`) up to a configurable **16,384-bit safety ceiling**. Those values are starting engineering limits, not a guarantee that all rolls resolve; benchmark and adversarial validation may change them before implementation.

There is no sampling epsilon and no allowed approximation that biases a boundary decision. At every stage, an output probability/cumulative threshold carries `lower ≤ exact value ≤ upper`. Arithmetic rounds lower endpoints toward `−∞` and upper endpoints toward `+∞`; omitted tails must be retained as explicit upper-bound mass, never silently dropped.

Use an incremental uniform bit stream `U`: after `k` bits, its exact dyadic interval is `[j/2ᵏ, (j+1)/2ᵏ)`. For item `i`, select it only when the whole random interval lies strictly in a certified safe region, i.e. its lower endpoint is at/above the upper bound for the preceding cumulative threshold and its upper endpoint is at/below the lower bound for the current cumulative threshold, with endpoint convention tested explicitly. If any threshold could still cross `U`, increase numeric precision and/or request more entropy bits. Never pick the nearest side.

The result is determined when exactly one slot's certified region contains the complete random interval. If ambiguity remains at the safety ceiling, **fail the roll closed**: grant no title, do not commit roll counters, rewards, or save changes, return a retriable internal error, and emit diagnostics without exposing a fallback result. Do not retry by routing to legacy or by making a random guess.

For an ideal infinite unbiased bitstream, a non-dyadic boundary is resolved almost surely; exact boundary equality has probability zero. A finite implementation has the explicit safety ceiling above and therefore can fail closed rather than claim universal termination.

### Determinism and backend versioning

For the same canonical snapshot hash, exact channels, mode, pool/version inputs, numeric-backend version, deterministic operation order, and identical injected entropy bytes, the decision must be identical across supported runtimes. Authoritative calculations may not call `Math.log`, `Math.log10`, `Math.exp`, `Math.pow`, or rely on binary64 last bits. Integer `BigInt` arithmetic plus fixed algorithm/order and directed rounding provides the basis for reproducibility.

Persist/version the sampler contract separately from the legacy save: `snapshotVersion`, `luckCurveVersion`, `manualPowerVersion`, `numericBackendVersion`, precision schedule, and sampler version. A backend upgrade may alter the mapping from an entropy stream to a slot even if both implementations enclose the same ideal distribution; that is a versioned algorithm change. No migration or save format change is part of this phase.

Node's `crypto.randomBytes` is the intended entropy source; Node documents it as generating cryptographically strong pseudorandom data. Production should append bytes only as needed, avoid modulo reduction, and keep the entropy-source/version boundary explicit. Tests inject a deterministic byte stream; they do not substitute statistical tests for exact decision tests.

## Adversarial requirements

The implementation gate must cover:

- exact inputs `1/1e20`, `1/1e100`, `1/1e500`, and `1/1e1000`, plus smaller probabilities, without zero/underflow;
- nearly equal rational inputs, exact equalities, `β` arbitrarily close to 1, very small positive `β`, Auto and Manual, and ties at a boundary;
- 10,000 slots with widely separated exponents and many terms below the current mantissa precision;
- repeated outward-rounded summation and normalization, proving total probability is enclosed around exactly 1;
- uniform entropy prefixes immediately below, above, and overlapping every cumulative boundary;
- precision-cap exhaustion, which must produce no result and no persisted roll side effects;
- same snapshot/parameters/entropy replay across supported Node/Electron versions and architectures.

Order must follow from a shared positive `β` and monotone power transform; the implementation still verifies interval non-overlap when inputs differ. If intervals overlap because precision is insufficient, refine. Equal source probabilities may remain equal and use immutable slot order only for deterministic boundary bookkeeping.

## Performance and caching estimate (not a benchmark)

The first construction for a cache key performs approximately O(N) logarithm/power/enclosure work plus O(N) interval accumulation: about 200, 1,000, or 10,000 slots respectively. Correctness-first interval transcendental operations are substantially more expensive than binary64, so **10,000 slots cannot be declared acceptable without a measured prototype**. Cache immutable base-log enclosures by snapshot/cohort hash; cache transformed weight intervals and prefix/tree sums by `(snapshot, pool, luck-curve version, numeric backend, β/channel signature, mode)`. Auto and Manual have distinct entries. With a cached prefix tree, ordinary selection can be O(log N); refinement updates only affected leaves/ancestors where dependency analysis proves that sound. A changed snapshot or β invalidates the corresponding cache. Memory is O(N) per active cache key; bound cache count and evict deterministically.

Expected resolution cost is adaptive: common outcomes should usually resolve with the initial 128-bit bounds and a short entropy prefix. A boundary-near outcome triggers more work. For an event whose true probability is around `1e-1000`, an ordinary uniform threshold ordered cumulatively may need roughly 3,322 random bits when it falls in that tail; this is a rare path, not per-roll work. Beyond that, entropy/precision demand grows with rarity and the configured cap can fail closed. No numeric timing claim is made because no production prototype exists yet.

## Current code boundary and changes in this phase

- `src/rng-luck2-math.cjs` remains diagnostic and now tags both beta and transformed-cohort results `numericAuthority: 'diagnostic-only'`, `samplerEligible: false`.
- `src/rng-production-precision-gate.cjs` has no public registration/factory path. Its assertion rejects every current result; requesting a production backend throws. A later reviewed backend must explicitly alter this gate before a sampler can accept values.
- No sampler calls this gate; no production weight can reach roll code. The legacy router remains the only usable path; `luck2` remains fail-closed.
- No dependency, production transcendental, benchmark prototype, catalog/save/RNG integration, or persistence was added.

## GO / NO-GO

**NO-GO for Fase 3.** The architecture is specified but there is no certified interval backend, production probability bounds, performance benchmark, or sampler implementation. Before Fase 3, approve one of: (1) a vetted, maintained, license-compatible certified interval package for Node/Electron; or (2) a separately reviewed BigInt scaled-interval implementation with documented enclosure proofs for each transcendental primitive. Then implement and validate this Fase 2.5 backend behind the existing fail-closed gate.

## References checked

- [decimal.js README and license](https://github.com/MikeMcl/decimal.js): arbitrary precision, significant-digit rounding, non-integer powers, CommonJS, MIT.
- [decimal.js implementation](https://github.com/MikeMcl/decimal.js/blob/master/decimal.mjs): configurable precision/rounding and exponent/precision bounds. The library documents rounded numerical results, not the production enclosure contract specified here.
- [Node.js `crypto.randomBytes`](https://nodejs.org/api/crypto.html#cryptorandombytessize-callback): cryptographically strong pseudorandom bytes for progressive entropy acquisition.
