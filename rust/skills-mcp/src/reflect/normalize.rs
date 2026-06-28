//! Error-trace normalization and cluster keying.
//!
//! A *signature* is a canonical form of an error with volatile tokens (paths, line/col
//! positions, hex/addresses, UUIDs, large integers) stripped, so logically-identical
//! errors that differ only in those tokens collapse to the same string. This is what
//! turns "5 separate `cargo build` failures" into one cluster.
//!
//! See `docs/self-improving/03-REFLECTION-LOOP.md §2` for the design.

use regex::{Captures, Regex};
use std::sync::OnceLock;

fn compiled(cell: &'static OnceLock<Regex>, pat: &str) -> &'static Regex {
    cell.get_or_init(|| Regex::new(pat).expect("static regex"))
}

macro_rules! re {
    ($name:ident, $pat:literal) => {
        fn $name() -> &'static Regex {
            static CELL: OnceLock<Regex> = OnceLock::new();
            compiled(&CELL, $pat)
        }
    };
}

re!(re_ansi, r"\x1b\[[0-9;]*[a-zA-Z]");
re!(re_code, r"error\[([a-z]?\d+)\]");
re!(re_uuid, r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}");
re!(re_path, r"([a-z]:)?[\\/][\w.\-\\/]+");
re!(re_pos, r":\d+(:\d+)?");
re!(re_hex, r"\b0x[0-9a-f]+\b|\b[0-9a-f]{7,40}\b");
re!(re_bigint, r"\b\d{3,}\b");
re!(re_backtick, r"`([^`]*)`");
re!(re_nonword, r"[^a-z0-9 ]+");

/// Tokens dropped only when they appear at the *end* of a signature (dangling
/// prepositions left behind after a path/position was stripped).
const TRAILING_STOP: &[&str] = &["at", "in", "on", "of", "near", "for", "to"];

/// Normalize a raw error trace (or setup-step context) into a stable signature.
///
/// The transform is deterministic and lossy by design. Two traces that differ only in
/// paths, line numbers, addresses, or trailing literals produce the same signature;
/// traces that differ in the *discriminating* identifier (e.g. the missing crate name)
/// do not.
pub fn normalize_signature(raw: &str) -> String {
    // 1. lowercase, drop apostrophes ("can't" -> "cant").
    let lowered = raw.to_lowercase().replace('\'', "");
    // 2. strip ANSI escapes.
    let deansi = re_ansi().replace_all(&lowered, "");
    // 3. keep the first non-empty line — the headline error.
    let first = deansi
        .lines()
        .map(str::trim)
        .find(|l| !l.is_empty())
        .unwrap_or("")
        .to_string();

    // 4. capture the error code (e.g. e0463) so it anchors the signature.
    let code = re_code().captures(&first).map(|c| c[1].to_string());

    // 5. backticks: keep the FIRST literal (usually the discriminating identifier),
    //    replace subsequent literals with the placeholder "lit".
    let mut seen_literal = false;
    let s = re_backtick().replace_all(&first, |c: &Captures| {
        if seen_literal {
            " lit ".to_string()
        } else {
            seen_literal = true;
            format!(" {} ", &c[1])
        }
    });

    // 6. strip volatile token classes (order matters: uuid before hex, path before pos).
    let s = re_uuid().replace_all(&s, " ");
    let s = re_path().replace_all(&s, " ");
    let s = re_pos().replace_all(&s, " ");
    let s = re_hex().replace_all(&s, " ");
    let s = re_bigint().replace_all(&s, " ");

    // 7. strip remaining punctuation.
    let s = re_nonword().replace_all(&s, " ");

    // 8. tokenize; drop a leading "error"/"warning" and trailing dangling stopwords.
    let mut toks: Vec<&str> = s.split_whitespace().collect();
    if matches!(toks.first(), Some(&"error") | Some(&"warning")) {
        toks.remove(0);
    }
    while matches!(toks.last(), Some(t) if TRAILING_STOP.contains(t)) {
        toks.pop();
    }
    let mut sig = toks.join(" ");

    // 9. ensure the error code anchors the front.
    if let Some(code) = code {
        if !sig.starts_with(&code) {
            sig = if sig.is_empty() {
                code
            } else {
                format!("{code} {sig}")
            };
        }
    }

    // 10. cap length.
    sig.truncate(200);
    sig.trim().to_string()
}

/// Stable 64-bit FNV-1a hash of a signature, hex-encoded. Used as the cluster
/// idempotency key (`_meta.cluster_key`). FNV-1a is deterministic across runs and
/// versions — sufficient for an idempotency key without pulling a crypto-hash crate.
pub fn cluster_key(signature: &str) -> String {
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    for b in signature.as_bytes() {
        h ^= u64::from(*b);
        h = h.wrapping_mul(0x0000_0100_0000_01b3);
    }
    format!("{h:016x}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn canonical_cargo_error() {
        let raw = "error[E0463]: can't find crate for `ratatui` \
                   at /home/b/rust/skills-mcp/src/main.rs:12:5";
        assert_eq!(normalize_signature(raw), "e0463 cant find crate for ratatui");
    }

    #[test]
    fn path_and_line_noise_collapses() {
        let a = "error[E0463]: can't find crate for `ratatui` at /home/a/x.rs:12:5";
        let b = "error[E0463]: can't find crate for `ratatui` at /tmp/zzz/other.rs:99";
        assert_eq!(normalize_signature(a), normalize_signature(b));
    }

    #[test]
    fn different_crate_stays_distinct() {
        let a = "error[E0463]: can't find crate for `ratatui` at /x.rs:1";
        let b = "error[E0463]: can't find crate for `serde` at /x.rs:1";
        assert_ne!(normalize_signature(a), normalize_signature(b));
    }

    #[test]
    fn ansi_and_case_are_normalized() {
        let raw = "\x1b[31mERROR\x1b[0m: Linker `cc` failed";
        let sig = normalize_signature(raw);
        assert!(sig.contains("linker"), "got: {sig}");
        assert!(sig.contains("cc"), "got: {sig}");
    }

    #[test]
    fn cluster_key_is_stable_and_distinct() {
        assert_eq!(cluster_key("abc"), cluster_key("abc"));
        assert_ne!(cluster_key("abc"), cluster_key("abd"));
        assert_eq!(cluster_key("abc").len(), 16);
    }
}
