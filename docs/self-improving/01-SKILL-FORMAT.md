# Deliverable 1 — AI-to-AI Skill Format & Metadata Index

Two artifacts per skill, with a strict division of labor:

- **`SKILL.md`** — the *content* an agent reads. Stays valid human Markdown (so the skills-manager UI and the Rust indexer keep working), but adds a fixed set of **machine-anchored sections** an LLM can grep without parsing prose.
- **`_meta.json`** — the *index* an agent searches. Stays under the canonical `schema/meta.schema.json` contract; gains **two optional fields** for failure-driven lookup and idempotency.

Design rule: rich, variable content (error→fix maps, constraints) → **body**. Short, sortable, searchable keys → **index**. This is forced by `additionalProperties:false` on `_meta.json` (constraint C2 in the overview).

---

## 1. SKILL.md — AI-to-AI body convention

Frontmatter is unchanged from the existing format (`name`, `description`, optional `license`). Below it, an AI-optimized skill uses these sections **in this order**, with **exact** `##` headings (they are the parse anchors). All sections except `## Overview` are optional but, when present, must use these headings verbatim.

```markdown
---
name: cargo-build-recovery
description: Resolve common `cargo build`/`cargo check` failures in this workspace before retrying the task.
---

# Cargo Build Recovery

## Overview
One sentence. What this skill makes the agent able to do. Human-readable.

## Triggers
<!-- When the agent SHOULD load this skill. Bullet list, terse, matchable. -->
- error matches: `error[E0463]: can't find crate`
- error matches: `linker \`cc\` failed`
- command failed: `cargo build`, `cargo check`, `cargo test`
- context tag: rust, workspace-build

## Constraints
<!-- Strict directives. Imperative. One rule per line. The agent MUST obey. -->
- MUST run `scripts/verify.sh` before retrying the build.
- MUST NOT delete `Cargo.lock` to "fix" a resolver error.
- PREFER `cargo build -p <crate>` over a full workspace build when isolating.

## Failure → Fix
<!-- The key-value error→solution map. Signature | Cause | Fix. Most-specific first. -->
| Error signature | Likely cause | Fix |
|---|---|---|
| `can't find crate for \`X\`` | missing workspace dep | add `X` to the crate's `[dependencies]`, then `cargo build -p <crate>` |
| `linker \`cc\` failed` | build-essential absent | `sudo apt-get install -y build-essential`, re-run |
| `/tmp ... permission denied (os error 13)` | `/tmp` is noexec | set `TMPDIR=$HOME/.cache CARGO_TARGET_DIR=$HOME/.cache/target` |

## Verify
<!-- Points at the fail-fast check. See 05-VERIFICATION-TEMPLATES.md. -->
- script: `scripts/verify.sh`
- passes when: `cargo --version` resolves and `$TMPDIR` is executable.

## Notes
<!-- Optional human context, longer prose allowed here only. -->
```

### Why these sections

| Section | Purpose | Token discipline |
|---|---|---|
| `## Triggers` | Lets an agent decide *load or skip* from the error text alone | bullets, no prose |
| `## Constraints` | Hard rules — the "strict instruction constraints" the brief asked for | one imperative per line |
| `## Failure → Fix` | The error→solution key-value map; the primary synthesis output | table, most-specific row first |
| `## Verify` | Binds the skill to its precondition check | two lines |
| `## Overview` / `## Notes` | Keep the file human-legible | prose allowed only here |

### Parsing contract for agents

- Sections are delimited by the exact `## ` headings above. An agent loads `## Triggers` + `## Constraints` + `## Failure → Fix` as the "actionable core" and may defer `## Notes`.
- `## Failure → Fix` is a 3-column Markdown table: `Error signature | Likely cause | Fix`. Column 1 is a normalized signature (see `03-REFLECTION-LOOP.md §2`) and is the join key back to `_meta.failure_signatures`.
- Backtick-fence any literal that contains `|` to avoid breaking the table.

---

## 2. `_meta.json` — proposed schema extension (v2.1)

Add **two optional** fields. Both default to absent/empty, so all 80 existing files remain conformant.

### Exact diff to `schema/meta.schema.json`

```json
    "relevance_tier": {
      "type": ["string", "null"],
      "enum": ["A", "B", "C", "D", null],
      "description": "Model-capability relevance tier, or null if unassigned. Written by the audit system."
    },
    "failure_signatures": {
      "type": "array",
      "items": { "type": "string" },
      "description": "Normalized error signatures this skill resolves (schema v2.1). Join key to the `## Failure → Fix` table. Used for O(1) error→skill lookup. Written by the reflection engine."
    },
    "cluster_key": {
      "type": ["string", "null"],
      "description": "Stable hash of the log cluster that generated/last-updated this skill (schema v2.1). Idempotency key so reflection updates an existing skill instead of forking a duplicate. Null for hand-authored skills."
    }
```

(Insert before the closing `}` of `properties`. Leave `required` unchanged.)

### Corresponding fixture addition (`schema/fixtures/meta.valid.json`)

```json
  "failure_signatures": ["cargo build cant find crate", "linker cc failed"],
  "cluster_key": "sha1:9f2a...c7"
```

### Resulting `_meta.json` for a generated skill

```json
{
  "name": "cargo-build-recovery",
  "description": "Resolve common cargo build/check failures before retrying.",
  "tags": ["rust", "build", "recovery"],
  "sub_skills": [],
  "source": "reflection",
  "type": "discipline",
  "depends_on": [],
  "enhances": [],
  "last_reviewed_at": "2026-06-27",
  "review_score": null,
  "relevance_tier": null,
  "failure_signatures": ["cargo build cant find crate", "linker cc failed"],
  "cluster_key": "sha1:9f2a4b...c7"
}
```

Notes:
- `source: "reflection"` is a new provenance value. `source` is intentionally **not** enum-locked in the schema, so this needs no schema change.
- `failure_signatures` is the search index: "agent hits error E → normalize → look up the skill whose `failure_signatures` contains it." This is the "quickly index and search" capability the brief wanted, kept in the index file rather than parsed from every body.
- `cluster_key` is how the synthesis engine decides **update vs. create** (see `04-SYNTHESIS-ENGINE.md §4`).

---

## 3. What this deliverable deliberately does NOT do

- **No new top-level file** (e.g. `SKILL.ai.md`). A parallel format would double the indexer's surface and split the corpus. The convention above keeps one file, human- and machine-readable.
- **No frontmatter expansion.** New machine data goes in `_meta.json` (validated) or fixed body sections (greppable), never in YAML frontmatter — the indexer treats the body as opaque content, so body sections are safe, but unrecognized frontmatter keys are riskier and unvalidated.
- **No `additionalProperties` loosening.** Strictness is the feature; it is what keeps 80 skills honest.
