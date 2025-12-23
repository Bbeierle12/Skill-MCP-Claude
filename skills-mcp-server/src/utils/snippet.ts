/**
 * Snippet extraction utility for search results
 */

/**
 * Extract a snippet around the query match in content
 */
export function extractSnippet(content: string, query: string, maxLength: number = 150): string {
  // Find position of query
  let pos = content.indexOf(query);

  // If exact match not found, try finding first query word
  if (pos === -1) {
    const words = query.split(/\s+/);
    for (const word of words) {
      if (word.length > 2) {
        pos = content.indexOf(word);
        if (pos !== -1) break;
      }
    }
  }

  // If still not found, return start of content
  if (pos === -1) {
    const snippet = content.slice(0, maxLength).replace(/\n/g, ' ').trim();
    return snippet + (content.length > maxLength ? '...' : '');
  }

  // Calculate snippet bounds (center on match)
  const contextBefore = 50;
  const start = Math.max(0, pos - contextBefore);
  const end = Math.min(content.length, pos + maxLength - contextBefore);

  let snippet = content.slice(start, end);

  // Clean up whitespace
  snippet = snippet.replace(/\n+/g, ' ').replace(/\s+/g, ' ').trim();

  // Add ellipsis indicators
  if (start > 0) {
    snippet = '...' + snippet;
  }
  if (end < content.length) {
    snippet = snippet + '...';
  }

  return snippet;
}

/**
 * Truncate text to a maximum length, breaking at word boundaries
 */
export function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }

  // Find last space before maxLength
  const truncated = text.slice(0, maxLength);
  const lastSpace = truncated.lastIndexOf(' ');

  if (lastSpace > maxLength * 0.7) {
    return truncated.slice(0, lastSpace) + '...';
  }

  return truncated + '...';
}
