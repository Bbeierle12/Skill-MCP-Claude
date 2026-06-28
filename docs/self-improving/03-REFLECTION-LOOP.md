# Deliverable 2 — The Reflection Loop (clustering, weight, token budget)

The reflection loop turns a pile of raw `experience_logs` into a small set of **SynthesisJobs**: "this recurring failure is worth a skill update, and here are the representative logs that fit the token budget." It is a batch job, run on a timer or after N new logs.

```
fetch unreflected logs ──▶ normalize → signature ──▶ cluster
   ──▶ weight each cluster ──▶ threshold gate ──▶ select representatives (token budget)
   ──▶ emit SynthesisJob{cluster_key, mode, reps, target_skill?}  ──▶ mark reflected
```

---

## 1. Fetch

Read the work queue (`02 §3`): `reflected_at IS NULL AND event_type IN ('error','setup')`, ordered by `id`. Record the max `id` as the run's watermark.

---

## 2. Normalize → signature (collapses noise so "5 cargo build failed" become one)

A **signature** is a canonical string with volatile tokens stripped, so logically-identical errors that differ only in paths/line numbers/addresses hash to the same bucket. Apply in order:

```
1. lowercase
2. strip ANSI escape codes
3. replace volatile tokens with class placeholders:
     absolute/relative paths        →  «path»      regex: (/[\w.\-/]+)|([a-z]:\\[\w.\\-]+)
     line:col  (":42:7", ":42")     →  «pos»       regex: :\d+(:\d+)?
     hex / addresses (0x…, sha)     →  «hex»       regex: 0x[0-9a-f]+|[0-9a-f]{7,40}
     uuids                          →  «uuid»
     integers ≥ 3 digits            →  «n»         regex: \b\d{3,}\b
     quoted literals  '…' "…" `…`   →  «lit»       (keep crate/symbol names? see note)
     ports / pids                   →  «n»
4. collapse runs of whitespace to single space; trim
5. keep only the FIRST error line + the topmost `error[E....]` code if present
6. cap to 200 chars
```

Note on literals: keep the **first** backticked identifier (crate/symbol name) — it is usually the discriminating token (`can't find crate for `ratatui`` vs `…`serde``). Replace only the *2nd+* literals. This keeps "missing crate X" and "missing crate Y" as distinct signatures, which is correct (different fixes).

Example:
```
error[E0463]: can't find crate for `ratatui` at /home/b/rust/skills-mcp/src/main.rs:12:5
   → e0463 cant find crate for `ratatui` at «path»«pos»
   → signature: "e0463 cant find crate for ratatui"
```

`signature_hash = sha1(signature)[:12]` is the **`cluster_key`** used downstream for idempotency.

Backfill `signature` onto each row (`UPDATE … SET signature`).

---

## 3. Cluster (three tiers; start with 1+2, embeddings optional)

| Tier | Method | Cost | Catches |
|---|---|---|---|
| **T1 — exact** | group by `signature` | O(n), free | the canonical "same error 5×" case |
| **T2 — lexical** | merge T1 buckets whose signatures have token-set **Jaccard ≥ 0.7** | O(b²) on bucket count b, cheap | near-duplicates the normalizer didn't fully collapse |
| **T3 — semantic** *(optional)* | embed bucket exemplars, merge cosine ≥ 0.83 | needs a local embed model | paraphrased errors with no lexical overlap |

T1 does the heavy lifting; T2 mops up. **Recommend shipping T1+T2 only** — embeddings add a model dependency for marginal recall on error text (which is lexically regular). Keep T3 behind a feature flag; if added later, a local Gemma/`bge-small` over the *signature* (not the full trace) is enough.

Jaccard for T2:
```
J(a,b) = |tokens(a) ∩ tokens(b)| / |tokens(a) ∪ tokens(b)|     (tokens = signature split on space)
merge buckets a,b iff J ≥ 0.7
```

A cluster carries: `cluster_key`, member log ids, `n` = size, the set of distinct `task_context`, severity distribution, and resolution coverage.

---

## 4. Pair errors with their fixes

Within a cluster, attach resolutions: for each `error` row, look for a later `success`/resolved row with the **same signature** OR same `task_context` within a time window (e.g. ≤ 2h, same `agent`+`host`). The matched `resolution` text is what the synthesis engine compiles into `## Failure → Fix`. Unmatched errors raise the cluster's **resolution gap** (unsolved pain → higher priority, but the LLM is told the fix is unknown).

---

## 5. Cluster weight (decides *if* a cluster earns a skill update)

For a cluster `C`:

```
frequency (recency-decayed):
    F = Σ_i exp(-λ · age_days(i)),   λ = ln 2 / H,   H = 14 days (half-life)

breadth:
    d = | distinct task_context in C |
    B = 1 + log2(d)                     # one context = 1×, doubles every ×2 contexts

severity:
    S = 1 + 0.25 · mean(severity in C)  # severity 0..4 → factor 1.0..2.0

resolution gap:
    g = (# unresolved errors in C) / n
    G = 0.5 + g                          # fully-solved 0.5× … fully-unsolved 1.5×

skill-failure boost:
    if any member has skill_applied = an existing skill that DIDN'T prevent the error → ×1.5

WEIGHT  W(C) = F · B · S · G · (skill-failure boost?)
```

Each factor is independent and interpretable. `F` rewards *recent recurring* pain (an error seen 5× last week outranks 5× six months ago). `B` rewards errors that bite across many tasks. `G` rewards unsolved problems. The skill-failure boost surfaces skills that exist but aren't working (feeds `review_score` demotion).

---

## 6. Trigger heuristic (the "enough weight" gate)

Emit a SynthesisJob for cluster `C` iff **all** hold:

```
(1) n ≥ N_MIN                 # default 3 — never synthesize from one-offs
(2) W(C) ≥ Θ                  # default Θ tuned so ~3 recent unresolved errors across ≥2 contexts trips it
(3) NOT already_covered(C)    # see below
```

`already_covered(C)`: a skill exists whose `failure_signatures` contains `C.signature` **and** that skill's `review_score ≥ 80` **and** `last_reviewed_at` within 30 days. If covered but the error still recurred → it's a **skill failure**, so do NOT suppress; instead emit `mode:"update"` and demote the skill's `review_score`.

Mode selection:
```
existing skill with cluster_key == C.cluster_key  → mode = "update" (refresh that skill)
existing skill matched via failure_signatures only → mode = "update" (extend its Failure→Fix)
no match                                           → mode = "create"
```

Calibration: start `Θ` empirically — log `W(C)` for every cluster for the first week without acting (dry-run, `synthesis_jobs.status='pending'` only), then set `Θ` at roughly the 75th percentile of observed weights so the loop acts on the top quartile of recurring pain. `N_MIN` and `H` are config, not constants.

---

## 7. Token budget (which logs go into the LLM call, and how many)

A SynthesisJob must fit the synthesis model's input budget. Let:

```
B_ctx   = model context window (tokens)
R       = reserved output (e.g. 4k for a full SKILL.md, 1.5k for a diff)
P_sys   = system prompt size (fixed, measured)
S_exist = existing SKILL.md size if mode == update, else 0
B_logs  = B_ctx − R − P_sys − S_exist        # tokens left for evidence
```

Estimate tokens as `t(x) ≈ ceil(len_chars(x) / 4)` (cheap; swap for a real tokenizer if available). Then **select representatives greedily by information value** until `B_logs` is spent:

```
rank cluster members by score:
    + matched resolution present     (we want exemplars that show the fix)
    + distinct task_context not yet covered by chosen reps   (diversity)
    + higher severity
    + medoid first (the member with min total Jaccard distance to the rest — the "typical" error)
pick the medoid, then add highest-scoring members while Σ t(rep) ≤ B_logs,
hard cap K = 12 reps.
```

This guarantees the call (a) always contains the canonical error, (b) shows at least one worked fix when one exists, (c) spans multiple contexts, and (d) never blows the window. If a single cluster's evidence can't fit even the medoid + one fix, fall back to **summarize-then-synthesize**: compress each rep to its first error line.

Emitted job:
```rust
struct SynthesisJob {
    cluster_key: String,
    mode: Mode,                 // Create | Update
    target_skill: Option<String>,
    reps: Vec<LogRep>,          // the budget-fitted representatives
    signature: String,
    weight: f64,
    distinct_contexts: usize,
    resolution_gap: f64,
}
```

Finally: write `synthesis_jobs` row (`status='pending'`), `UPDATE … reflected_at` for all members, and record the `reflection_runs` watermark.

---

## 8. Defaults table (all config, not hardcoded)

| Param | Default | Meaning |
|---|---|---|
| `H` half-life | 14 d | recency decay |
| `N_MIN` | 3 | min cluster size to act |
| `Θ` threshold | 75th pct of week-1 weights | act on top-quartile pain |
| Jaccard merge | 0.70 | T2 lexical merge |
| cosine merge (T3) | 0.83 | optional semantic merge |
| `K` reps cap | 12 | max evidence logs per call |
| coverage score / age | 80 / 30 d | when an existing skill suppresses CREATE |
