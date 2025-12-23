/**
 * Error handling utilities
 */

/**
 * Standard error response for MCP tools
 */
export function toolError(message: string): { content: Array<{ type: 'text'; text: string }>; isError: true } {
  return {
    content: [{ type: 'text', text: `Error: ${message}` }],
    isError: true
  };
}

/**
 * Standard success response for MCP tools
 */
export function toolSuccess(text: string): { content: Array<{ type: 'text'; text: string }> } {
  return {
    content: [{ type: 'text', text }]
  };
}

/**
 * Success response with structured content (for JSON responses)
 */
export function toolSuccessJson<T>(text: string, data: T): { content: Array<{ type: 'text'; text: string }>; structuredContent: T } {
  return {
    content: [{ type: 'text', text }],
    structuredContent: data
  };
}

/**
 * Handle common filesystem errors with actionable messages
 */
export function handleFsError(error: unknown, context: string): string {
  const err = error as NodeJS.ErrnoException;

  switch (err.code) {
    case 'ENOENT':
      return `${context}: Not found. Please check the name is correct.`;
    case 'EACCES':
      return `${context}: Permission denied. Check file permissions.`;
    case 'EEXIST':
      return `${context}: Already exists. Use a different name or delete existing first.`;
    case 'ENOTDIR':
      return `${context}: Expected a directory but found a file.`;
    case 'EISDIR':
      return `${context}: Expected a file but found a directory.`;
    case 'ENOTEMPTY':
      return `${context}: Directory is not empty.`;
    default:
      return `${context}: ${err.message || 'Unknown error'}`;
  }
}

/**
 * Validate skill name format
 */
export function validateSkillName(name: string): string | null {
  if (!name || name.trim().length === 0) {
    return 'Skill name is required';
  }

  if (!/^[a-z0-9-]+$/.test(name)) {
    return 'Skill name must be lowercase alphanumeric with hyphens only';
  }

  if (name.startsWith('-') || name.endsWith('-')) {
    return 'Skill name cannot start or end with a hyphen';
  }

  if (name.includes('--')) {
    return 'Skill name cannot contain consecutive hyphens';
  }

  if (name.length > 50) {
    return 'Skill name must be 50 characters or less';
  }

  return null;
}
