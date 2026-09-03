/**
 * Exa's search depths, ordered by latency.
 *
 * In its own module, importing NOTHING, because `config/env.ts` validates
 * against it and the provider that uses it reaches the logger, which reaches
 * `env` - so declaring it next to the provider would close an import cycle
 * around the one file that throws at import time.
 *
 * This is the knob that trades answer quality against how long the user listens
 * to silence, and it is the single biggest lever on how the app FEELS.
 *
 * Measured on novel queries, 3 Sep 2026 (a repeated query is ~250ms at every
 * depth, which is why the first attempt at this measurement was worthless):
 *
 *   instant  ~490ms  - and returned a FIVE WEEK OLD weather page. Disqualifying
 *                      for a tool whose whole purpose is things that change.
 *   fast     ~660ms  - matched `auto` on the freshness-critical queries.
 *   auto    ~1230ms  - best coverage, at roughly double the silence.
 *   deep*    4-40s   - never, for voice.
 *
 * `fast` is the default for that reason. See docs/DESIGN.md section 9.
 */
export const EXA_SEARCH_TYPES = [
  "instant",
  "fast",
  "auto",
  "deep-lite",
  "deep",
  "deep-reasoning",
] as const;

export type ExaSearchType = (typeof EXA_SEARCH_TYPES)[number];
