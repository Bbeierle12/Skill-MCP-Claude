# core/audit/models.py
# Shared types, constants and tiny IO helpers for the audit system.

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable, Optional

# The three optional fields the audit system writes into _meta.json.
AUDIT_META_FIELDS = ("last_reviewed_at", "review_score", "relevance_tier")

# Allowed relevance tiers (model-capability tier from the design doc).
RELEVANCE_TIERS = ("A", "B", "C", "D")

# Regex used to confirm a description contains a "when to use" trigger cue.
# Matches "use", "when", or "for" as a whole word, case-insensitive.
TRIGGER_CUE_PATTERN = re.compile(r"\b(use|when|for)\b", re.IGNORECASE)


Severity = str  # "info" | "warn" | "error"


@dataclass
class AuditFinding:
    """A single observation produced by an audit pass."""

    skill: str
    code: str
    severity: Severity
    message: str
    detail: str = ""

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass
class SkillStats:
    """Per-skill structural facts gathered once and reused by every check."""

    name: str
    skill_md_lines: int = 0
    has_scripts: bool = False
    has_references: bool = False
    has_templates: bool = False
    has_assets_dir: bool = False
    n_sub_skills: int = 0
    frontmatter_description: Optional[str] = None
    meta: dict = field(default_factory=dict)


# ---------- IO helpers ----------

def today_iso() -> str:
    """Return today's date in ISO format (UTC, date precision)."""
    return datetime.now(timezone.utc).date().isoformat()


def now_iso() -> str:
    """Return current UTC timestamp in ISO-8601 (seconds precision)."""
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def load_meta(skill_dir: Path) -> dict:
    """Load _meta.json for a skill directory. Returns {} on error."""
    meta_path = skill_dir / "_meta.json"
    if not meta_path.exists():
        return {}
    try:
        return json.loads(meta_path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return {}


def save_meta(skill_dir: Path, meta: dict) -> None:
    """Persist _meta.json with stable 2-space indentation and trailing newline."""
    meta_path = skill_dir / "_meta.json"
    meta_path.write_text(
        json.dumps(meta, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )


def load_skill_md(skill_dir: Path) -> str:
    """Return the raw SKILL.md content, or '' if missing/unreadable."""
    skill_md = skill_dir / "SKILL.md"
    if not skill_md.exists():
        return ""
    try:
        return skill_md.read_text(encoding="utf-8")
    except OSError:
        return ""


def iter_skill_dirs(skills_dir: Path) -> Iterable[Path]:
    """Yield every skill subdirectory under ``skills_dir`` in stable order."""
    if not skills_dir.exists():
        return
    for p in sorted(skills_dir.iterdir()):
        if p.is_dir() and not p.name.startswith("."):
            yield p


# ---------- Frontmatter parsing ----------

_FRONTMATTER_RE = re.compile(r"^---\s*\n(.*?)\n---\s*\n", re.DOTALL)


def extract_frontmatter_description(content: str) -> Optional[str]:
    """Extract the ``description:`` field from YAML frontmatter, if present.

    Uses a deliberately simple line-based parser (rather than pyyaml) so this
    module has zero hard dependencies — important for CI environments and the
    PyInstaller build.
    """
    m = _FRONTMATTER_RE.match(content)
    if not m:
        return None
    block = m.group(1)
    in_desc = False
    parts: list[str] = []
    for raw in block.splitlines():
        if not in_desc:
            if raw.startswith("description:"):
                value = raw.split(":", 1)[1].strip()
                # Strip surrounding quotes if any.
                if value.startswith(('"', "'")) and value.endswith(value[0]) and len(value) >= 2:
                    value = value[1:-1]
                parts.append(value)
                in_desc = True
            continue
        # Continuation lines for YAML folded/literal blocks: indented text.
        if raw.startswith((" ", "\t")):
            parts.append(raw.strip())
        else:
            break
    if not parts:
        return None
    text = " ".join(p for p in parts if p)
    return text or None


# ---------- Path discovery in SKILL.md bodies ----------

# Match obvious in-repo paths that the skill claims to ship: a/b.md, scripts/foo.py,
# examples/bar.md, references/baz.md, templates/qux.html, etc. The pattern is
# intentionally conservative: it only matches tokens that look like relative
# repo paths with a recognised top-level segment.
_PATH_HINT_RE = re.compile(
    r"(?<![A-Za-z0-9_/-])"
    r"(?P<path>(?:scripts|references|examples|templates|assets|images|fonts|data)/"
    r"[A-Za-z0-9._/-]+\.[A-Za-z0-9]+)"
)


def extract_referenced_paths(content: str) -> list[str]:
    """Return relative paths referenced in SKILL.md that should exist on disk.

    Fenced code blocks (``` ... ```) are stripped first — they commonly contain
    illustrative directory listings that should not be treated as load-time
    file references.
    """
    # Strip fenced code blocks.
    stripped = re.sub(r"```.*?```", "", content, flags=re.DOTALL)
    seen: dict[str, None] = {}
    for m in _PATH_HINT_RE.finditer(stripped):
        path = m.group("path")
        # Normalise — drop trailing punctuation that the regex didn't strip.
        path = path.rstrip(".,);:'\"`")
        if path not in seen:
            seen[path] = None
    return list(seen)
