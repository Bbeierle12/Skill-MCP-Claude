# Deliverable 3 — The Skill Synthesis Engine

Takes one `SynthesisJob` (a token-budgeted cluster) and produces a **new or updated `SKILL.md` + `_meta.json`**, written safely to a `reflect/*` branch and gated on validation. The LLM is the compiler; the engine around it is the safety harness.

```
SynthesisJob ─▶ build prompt ─▶ LLM call ─▶ parse strict output
   ─▶ write to temp dir ─▶ validate (schema + format) ─▶ branch + commit
   ─▶ run verification (05) ─▶ status: verified ─▶ (PR | auto-merge gate)
```

The LLM call **reuses the existing `core/claude_cli.py` pattern** — shell out to the `claude` CLI, no API-key handling, uses the operator's existing auth. (A Rust caller can invoke the same CLI via `std::process::Command`.)

---

## 1. System prompt (the "skill compiler")

```
You are a Skill Compiler. You convert clusters of agent failure logs into a single
reusable skill that PREVENTS the failure next time. You are writing for other LLM
agents to read, not for humans. Be terse, imperative, and concrete.

OUTPUT CONTRACT — emit EXACTLY one fenced block per file, no prose outside them:

  ```file:SKILL.md
  <full SKILL.md following the AI-to-AI convention>
  ```
  ```file:_meta.json
  <valid _meta.json>
  ```
  ```file:scripts/verify.sh   (OPTIONAL — only if a precondition is checkable)
  <POSIX sh, exit 0 = ready, non-zero = not ready, remediation on stderr>
  ```

SKILL.md MUST use these exact section headings in order:
  # <Title>
  ## Overview        (one sentence)
  ## Triggers        (bullets: error signatures / commands / context tags that load this skill)
  ## Constraints     (one imperative rule per line; MUST / MUST NOT / PREFER)
  ## Failure → Fix   (Markdown table: Error signature | Likely cause | Fix; most-specific first)
  ## Verify          (script path + the precondition it checks)
  ## Notes           (optional human context)

RULES:
- The `## Failure → Fix` "Error signature" column MUST reuse the provided normalized
  signatures verbatim, so they join back to _meta.failure_signatures.
- Only state fixes SUPPORTED BY THE LOGS. If the logs show no working resolution, write
  the fix as "UNVERIFIED:" and keep it minimal. Never invent a fix.
- _meta.json MUST conform to schema/meta.schema.json: name == skill dir (lowercase-hyphen),
  source: "reflection", set failure_signatures and cluster_key from the job.
- Keep total SKILL.md under <BUDGET> tokens. No marketing, no restating the error history.
```

## 2. User message (assembled per job)

```
MODE: {create | update}
CLUSTER_KEY: {cluster_key}
PROPOSED_NAME: {derived skill name, e.g. "cargo-build-recovery"}
NORMALIZED_SIGNATURES:
  - {signature_1}
  - {signature_2}
DISTINCT_CONTEXTS: {d}     RESOLUTION_GAP: {g}

REPRESENTATIVE LOGS ({k} of {n}, token-budgeted):
  [1] context: {task_context}
      command: {command}
      error:   {error_trace (first lines)}
      fix:     {resolution or "UNKNOWN"}
  [2] ...

{if mode == update:}
EXISTING SKILL.md (revise in place; preserve still-valid rows, add new Failure→Fix rows,
                   do not delete human ## Notes):
  <existing SKILL.md content>
```

## 3. Modes

- **create** — no existing skill. LLM emits a full `SKILL.md` + fresh `_meta.json`. `PROPOSED_NAME` derived from the dominant signature (slugified, deduped against `skills/`).
- **update** — `target_skill` exists (matched by `cluster_key` or `failure_signatures`). LLM gets the current `SKILL.md` and **merges**: append new `## Failure → Fix` rows, union `## Triggers`, keep human `## Notes`. The engine then **demotes** the skill if the update was triggered by a skill-failure (set `review_score = max(0, old−20)`, `last_reviewed_at = today`) — a skill that let its own error recur has demonstrably underperformed.

## 4. Parse, validate, gate (the harness around the LLM)

```
1. PARSE   extract the file:* fenced blocks. Reject if SKILL.md or _meta.json missing,
           or if any prose leaks outside the fences.
2. NAME    enforce name == dir, matches ^[a-z0-9-]+$, ≤ 50 chars, not colliding unless mode==update.
3. SCHEMA  validate _meta.json with the canonical validator (core.meta_schema.validate_meta
           in Python, or jsonschema-rs in Rust against schema/meta.schema.json). Must return [].
4. FORMAT  SKILL.md has the required headings; Failure→Fix is a 3-col table; every signature
           in the table is present in _meta.failure_signatures (and vice-versa).
5. SAFETY  no secrets/tokens in output (regex scan: AKIA…, sk-…, ghp_…, PEM headers);
           scripts/verify.sh contains no destructive verbs (rm -rf /, mkfs, dd, curl|sh).
6. IDEMPOTENCY  if a skill with this cluster_key already exists and content-hash is unchanged,
                no-op (status='verified', skip commit).
```

Any failure → `synthesis_jobs.status='rejected'`, write the reason to `note`, **do not** retry blindly (retry once with the validator errors appended to the prompt, then stop).

## 5. Safe file-writing & commit mechanics

NEVER touch `main` (constraint C3). Sequence:

```
1. write candidate files to a temp dir ($CARGO_TARGET_DIR-adjacent scratch, NOT /tmp — /tmp is noexec here)
2. git worktree add  reflect/<signature_hash>-<YYYYMMDD>   (isolated; never dirties the user's tree)
3. copy validated files into skills/<name>/ inside the worktree
4. run verification (05): _meta validate + scripts/verify.sh dry-run; capture result
5. on pass:
     git add skills/<name>
     git commit -m "reflect: <create|update> <name> from cluster <hash>

     <n> logs across <d> contexts, weight <W>. <one-line summary>.
     Co-Authored-By: reflection-engine"
     record commit_sha + branch in synthesis_jobs, status='verified'
6. publish gate (see §6)
7. git worktree remove  (cleanup); on any failure, remove worktree, status='rejected'
```

Writes are atomic per file (`write tmp → fsync → rename`). The worktree guarantees a failed synthesis can never leave half-written skills in the working copy. The `git stash`/worktree discipline mirrors how this repo already isolates work.

## 6. Publish gate (human-in-the-loop by default)

| Policy | When to use | Behavior |
|---|---|---|
| **PR (default)** | normal operation | open a PR from `reflect/*`; a human (or a reviewing agent) approves. Generated skills enter the corpus only on merge. |
| **auto-merge** | high-trust, narrow | merge to `main` automatically **iff** `mode==update` AND verification passed AND the diff only touches `## Failure → Fix` rows AND `weight ≥ 2·Θ`. New-skill CREATE always goes through PR. |
| **shadow** | calibration / week-1 | write the branch, open no PR; operator inspects `synthesis_jobs`. |

Rate limit: **≤ R_MAX generated skills per run** (default 3) so a log spike can't flood the corpus. Rollback is `git revert <commit_sha>` + `status='rejected'`.

## 7. Effectiveness feedback (closing the loop)

After a generated/updated skill ships, future logs reference it via `skill_applied`. The reflection loop (`03 §5`) reads that: if errors the skill claims to fix keep arriving with `skill_applied == <skill>`, the skill is failing → `review_score` decays → it re-enters synthesis as `update`. If the error stops recurring, `review_score` is promoted on the next audit pass. This is the self-improving signal — measured, not assumed.

## 8. Why a harness, not just a prompt

The LLM is non-deterministic; the harness is not. Schema validation, the secret/destructive scan, idempotency by `cluster_key`, the worktree isolation, and the publish gate are what make it safe to let a model write to a corpus that other agents trust. The prompt produces a *candidate*; the harness decides whether it becomes a *fact*.
