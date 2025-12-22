/**
 * Validation Utilities
 * Input validation for skills and form data
 */

/**
 * Validation result type
 * @typedef {Object} ValidationResult
 * @property {boolean} valid - Whether the input is valid
 * @property {string|null} error - Error message if invalid, null if valid
 */

/**
 * Validate a skill name
 * @param {string} name - The skill name to validate
 * @returns {ValidationResult} The validation result
 */
export function validateSkillName(name) {
  if (!name || typeof name !== 'string') {
    return { valid: false, error: 'Name is required' };
  }

  const trimmed = name.trim();

  if (trimmed.length === 0) {
    return { valid: false, error: 'Name is required' };
  }

  if (trimmed.length < 2) {
    return { valid: false, error: 'Name must be at least 2 characters' };
  }

  if (trimmed.length > 50) {
    return { valid: false, error: 'Name must be 50 characters or less' };
  }

  // Allow letters, numbers, hyphens, and underscores
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(trimmed)) {
    return {
      valid: false,
      error: 'Name must start with a letter or number and contain only letters, numbers, hyphens, and underscores'
    };
  }

  // Reserved names
  const reserved = ['new', 'create', 'edit', 'delete', 'import', 'export', 'api', 'admin'];
  if (reserved.includes(trimmed.toLowerCase())) {
    return { valid: false, error: `"${trimmed}" is a reserved name` };
  }

  return { valid: true, error: null };
}

/**
 * Validate a skill description
 * @param {string} description - The description to validate
 * @returns {ValidationResult} The validation result
 */
export function validateDescription(description) {
  if (!description || typeof description !== 'string') {
    return { valid: true, error: null }; // Description is optional
  }

  if (description.length > 500) {
    return { valid: false, error: 'Description must be 500 characters or less' };
  }

  return { valid: true, error: null };
}

/**
 * Validate skill content (markdown)
 * @param {string} content - The content to validate
 * @returns {ValidationResult} The validation result
 */
export function validateContent(content) {
  if (!content || typeof content !== 'string') {
    return { valid: false, error: 'Content is required' };
  }

  const trimmed = content.trim();

  if (trimmed.length === 0) {
    return { valid: false, error: 'Content cannot be empty' };
  }

  if (trimmed.length > 100000) {
    return { valid: false, error: 'Content exceeds maximum length (100KB)' };
  }

  return { valid: true, error: null };
}

/**
 * Validate a file path for import
 * @param {string} path - The file path to validate
 * @returns {ValidationResult} The validation result
 */
export function validatePath(path) {
  if (!path || typeof path !== 'string') {
    return { valid: false, error: 'Path is required' };
  }

  const trimmed = path.trim();

  if (trimmed.length === 0) {
    return { valid: false, error: 'Path is required' };
  }

  // Check for path traversal attempts
  if (trimmed.includes('..')) {
    return { valid: false, error: 'Path cannot contain ".."' };
  }

  // Windows and Unix path validation
  const validPathPattern = /^[a-zA-Z]:[\\\/]|^[\/~]/;
  if (!validPathPattern.test(trimmed)) {
    return { valid: false, error: 'Path must be an absolute path' };
  }

  return { valid: true, error: null };
}

/**
 * Validate tags array
 * @param {string[]} tags - The tags array to validate
 * @returns {ValidationResult} The validation result
 */
export function validateTags(tags) {
  if (!tags) {
    return { valid: true, error: null }; // Tags are optional
  }

  if (!Array.isArray(tags)) {
    return { valid: false, error: 'Tags must be an array' };
  }

  if (tags.length > 10) {
    return { valid: false, error: 'Maximum 10 tags allowed' };
  }

  for (const tag of tags) {
    if (typeof tag !== 'string') {
      return { valid: false, error: 'Each tag must be a string' };
    }

    if (tag.length > 30) {
      return { valid: false, error: 'Each tag must be 30 characters or less' };
    }

    if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(tag)) {
      return { valid: false, error: 'Tags can only contain letters, numbers, hyphens, and underscores' };
    }
  }

  return { valid: true, error: null };
}

/**
 * Validate an entire skill object
 * @param {Object} skill - The skill object to validate
 * @returns {ValidationResult} The validation result with first error found
 */
export function validateSkill(skill) {
  if (!skill || typeof skill !== 'object') {
    return { valid: false, error: 'Invalid skill data' };
  }

  const nameResult = validateSkillName(skill.name);
  if (!nameResult.valid) return nameResult;

  const descResult = validateDescription(skill.description);
  if (!descResult.valid) return descResult;

  const contentResult = validateContent(skill.content);
  if (!contentResult.valid) return contentResult;

  const tagsResult = validateTags(skill.tags);
  if (!tagsResult.valid) return tagsResult;

  return { valid: true, error: null };
}

/**
 * Sanitize a skill name to create a valid slug
 * @param {string} name - The name to sanitize
 * @returns {string} A sanitized slug-friendly name
 */
export function sanitizeSkillName(name) {
  if (!name || typeof name !== 'string') {
    return '';
  }

  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')  // Replace non-alphanumeric with hyphens
    .replace(/^-+|-+$/g, '')       // Remove leading/trailing hyphens
    .substring(0, 50);              // Limit length
}
