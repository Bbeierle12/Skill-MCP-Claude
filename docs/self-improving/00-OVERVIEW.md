# Self-Improving Agentic Memory — Architecture Overview

**Status:** Design (specs first; no engine code written yet)
**Author scope (this doc set):** the "Brain" — schema/format, reflection math, synthesis prompts, verification templates.
**Owner of infrastructure:** Gemini/Antigravity — Rust workspace, `rusqlite` storage, Ratatui TUI, Axum/Tailscale server (see `/PROGRESS.md`, all four phases currently `[ ]`).

---

## 0. Reality reconciliation (read this before building anything)

The original handoff brief made four premises. Three were already partly built or contradicted by what is on `origin/main` as of 2026-06-27. The design below is corrected to match disk, not the brief.

| Brief premise | On-disk reality | Consequence for design |
|---|---|---|
| "Assume a SQLite DB with `experience_logs` exists" | **Does not exist.** No DB layer on `origin/main`; it is Gemini's unbuilt Phase 2. | We **define** the schema here (`02-EXPERIENCE-LOGS-SCHEMA.md`) as the contract Gemini builds to. |
| "Design a `SKILL.md` template (LLM-only, not for humans)" | ~80 skills already ship `SKILL.md` in Anthropic's **human-readable** format, served by the Rust MCP. | We add an **AI-to-AI body convention** as backward-compatible sections, not a fork (`01-SKILL-FORMAT.md`). |
| "Define a `_meta.json` schema" | Already canonical: `schema/meta.schema.json` (v2.0), `additionalProperties:false`, enforced by Python + TS validators and `tests/test_meta_conformance.py`. | We **extend** that schema with optional index fields. New keys require a schema bump, never ad-hoc keys. |
| "Reflection loop updates skills" | An **audit system already exists** and writes `last_reviewed_at` / `review_score` / `relevance_tier` (the daily "skills catalogue review" commits). | The reflection loop **drives those existing fields**; it is not a second, parallel audit system. |

---

## 1. The loop (end to end)

```
agents (Tailscale nodes)
   │  POST /api/logs  {task_context, error_trace, resolution, ...}
   ▼
experience_logs  (SQLite, rusqlite — Gemini Phase 2/4)        ◀── contract: 02-...
   │  read raw logs
   ▼
REFLECTION  (cluster + token-budget + weight heuristic)       ◀── 03-...
   │  emits SynthesisJob{cluster, target_skill?, mode}
   ▼
SYNTHESIS  (LLM call → SKILL.md create|diff + _meta fields)   ◀── 04-...
   │  candidate written to temp, validated, branched
   ▼
VERIFY  (schema conformance + generated scripts/verify.sh)    ◀── 05-...
   │  on pass → commit to reflect/<sig>-<date> → (PR | auto-merge)
   ▼
skills/   (Rust MCP indexes + serves to agents over Tailscale)
```

The reflection→synthesis→verify stages are the "Brain." They run as a job, not a request path. The natural host is **in-process with Gemini's `skills-tui` binary** (it already links `rusqlite`), triggered on a timer or after N new logs.

## 2. Ownership boundary (who writes what)

| Component | Owner | Path |
|---|---|---|
| `experience_logs` table + `/api/logs` ingestion | Gemini | `rust/skills-mcp/src/db/`, `src/server/` |
| Reflection module (clustering, weight, budget) | Brain | `rust/skills-mcp/src/reflect/` (proposed) |
| Synthesis (LLM call, diff, safe write) | Brain | `rust/skills-mcp/src/reflect/synth.rs` + reuse `core/claude_cli.py` pattern |
| `_meta.json` schema extension | Brain proposes, applied once agreed | `schema/meta.schema.json` |
| Generated skills + `scripts/verify.*` | Synthesis engine output | `skills/<name>/` |

**Language:** Rust primary (matches the workspace default and runs in-process with the `rusqlite` connection — no cross-process DB access). The LLM synthesis call reuses the existing **`core/claude_cli.py`** subprocess pattern (shells to the `claude` CLI; no API key to manage). A Python sidecar is acceptable for synthesis only if it is cleaner to host the prompt there, but reflection/clustering stays in Rust next to the DB.

## 3. The field-addition procedure (authoritative)

`_meta.json` has **one** source of truth and three consumers. To add a field:

1. **Edit `schema/meta.schema.json`** — add the property. Keep it **out of `required`** so all 80 existing files still conform (`additionalProperties:false` only forbids *unknown* keys; optional new keys are backward-compatible).
2. **Update `schema/fixtures/meta.valid.json`** — add the field to the good fixture so the conformance suite exercises it.
3. **No change needed** to `core/meta_schema.py` (Python/jsonschema) or `skills-mcp-server/src/schemas/meta.ts` (TS/ajv) — both `compile()` the schema file dynamically.
4. **Flag the Rust drift (do not silently fix):** `rust/skills-mcp/src/models/meta.rs` (`SkillMeta`) and `rust/skills-mcp/src/validation/meta.rs` are **hand-rolled and already behind** the v2.0 schema — they stop at `source` and miss `type`/`depends_on`/`enhances`/audit fields. Serde tolerates this (no `deny_unknown_fields`), so the Rust side *reads but cannot serve* the new fields. Bringing Rust to parity is a separate, owner-assigned task.

## 4. Hard constraints (violating any breaks CI)

- **C1** — Any new `_meta.json` key MUST be added to `schema/meta.schema.json` first; nothing else may define the field set (`test_all_real_skills_conform`, `test_meta_conformance.py`).
- **C2** — Rich AI-to-AI content (error→solution maps, triggers, constraints) lives in the **SKILL.md body**, never as loose `_meta.json` keys (`additionalProperties:false`).
- **C3** — The synthesis engine NEVER writes to `main`. It writes to a `reflect/*` branch and gates merge on verification.
- **C4** — A generated skill is only published if its `_meta.json` passes `validate_meta` and its `scripts/verify.*` (if present) exits 0 in dry-run.

## Document index

- `01-SKILL-FORMAT.md` — Deliverable 1: AI-to-AI SKILL.md convention + `_meta.json` schema extension.
- `02-EXPERIENCE-LOGS-SCHEMA.md` — the SQLite contract Gemini builds (integration contract).
- `03-REFLECTION-LOOP.md` — Deliverable 2: clustering + token-budget math + trigger heuristic.
- `04-SYNTHESIS-ENGINE.md` — Deliverable 3: prompts + safe-write/commit mechanics.
- `05-VERIFICATION-TEMPLATES.md` — Deliverable 4: `scripts/verify.*` fail-fast mechanism.
