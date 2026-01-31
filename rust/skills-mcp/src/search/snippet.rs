//! Snippet extraction for search results.

/// Extract a snippet around a search term match.
///
/// Returns a portion of the content centered around the first match,
/// with ellipsis indicators if truncated.
pub fn extract_snippet(content: &str, term: &str, context_chars: usize) -> Option<String> {
    let content_lower = content.to_lowercase();
    let term_lower = term.to_lowercase();

    // Find the first occurrence
    let pos = content_lower.find(&term_lower)?;

    // Calculate snippet boundaries
    let start = pos.saturating_sub(context_chars);
    let end = (pos + term.len() + context_chars).min(content.len());

    // Find word boundaries
    let start = find_word_start(content, start);
    let end = find_word_end(content, end);

    // Build snippet
    let mut snippet = String::new();

    if start > 0 {
        snippet.push_str("...");
    }

    snippet.push_str(content[start..end].trim());

    if end < content.len() {
        snippet.push_str("...");
    }

    // Clean up whitespace
    let snippet = snippet
        .lines()
        .map(|l| l.trim())
        .filter(|l| !l.is_empty())
        .collect::<Vec<_>>()
        .join(" ");

    Some(snippet)
}

/// Find the start of a word boundary.
fn find_word_start(content: &str, pos: usize) -> usize {
    if pos == 0 {
        return 0;
    }

    let bytes = content.as_bytes();
    let mut start = pos;

    // Move back to find whitespace or start
    while start > 0 && !bytes[start - 1].is_ascii_whitespace() {
        start -= 1;
    }

    start
}

/// Find the end of a word boundary.
fn find_word_end(content: &str, pos: usize) -> usize {
    if pos >= content.len() {
        return content.len();
    }

    let bytes = content.as_bytes();
    let mut end = pos;

    // Move forward to find whitespace or end
    while end < bytes.len() && !bytes[end].is_ascii_whitespace() {
        end += 1;
    }

    end
}

/// Extract multiple snippets for a query with multiple terms.
#[allow(dead_code)]
pub fn extract_snippets(content: &str, terms: &[&str], context_chars: usize) -> Vec<String> {
    terms
        .iter()
        .filter_map(|term| extract_snippet(content, term, context_chars))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_extract_snippet_basic() {
        let content = "This is a test of the snippet extraction function.";
        let snippet = extract_snippet(content, "snippet", 10).unwrap();

        assert!(snippet.contains("snippet"));
        assert!(snippet.len() < content.len() + 6); // +6 for "..." prefix/suffix
    }

    #[test]
    fn test_extract_snippet_at_start() {
        let content = "Test content here with more words";
        let snippet = extract_snippet(content, "Test", 10).unwrap();

        assert!(snippet.starts_with("Test"));
        assert!(snippet.ends_with("..."));
    }

    #[test]
    fn test_extract_snippet_at_end() {
        let content = "Some content here ending with target";
        let snippet = extract_snippet(content, "target", 10).unwrap();

        assert!(snippet.ends_with("target"));
        assert!(snippet.starts_with("..."));
    }

    #[test]
    fn test_extract_snippet_not_found() {
        let content = "This content doesn't have the search term";
        let snippet = extract_snippet(content, "missing", 10);

        assert!(snippet.is_none());
    }

    #[test]
    fn test_extract_snippet_case_insensitive() {
        let content = "This has a TERM in it";
        let snippet = extract_snippet(content, "term", 10).unwrap();

        assert!(snippet.to_lowercase().contains("term"));
    }
}
