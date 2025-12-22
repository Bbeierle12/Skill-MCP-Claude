/**
 * HTML Escaping Utility
 * Prevents XSS attacks by escaping special HTML characters
 */

const ESCAPE_MAP = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
  '/': '&#x2F;',
  '`': '&#x60;',
  '=': '&#x3D;'
};

const ESCAPE_REGEX = /[&<>"'`=/]/g;

/**
 * Escape HTML special characters to prevent XSS
 * @param {string} str - The string to escape
 * @returns {string} The escaped string
 */
export function escapeHtml(str) {
  if (str === null || str === undefined) {
    return '';
  }

  if (typeof str !== 'string') {
    str = String(str);
  }

  return str.replace(ESCAPE_REGEX, (char) => ESCAPE_MAP[char]);
}

/**
 * Escape HTML and preserve newlines as <br> tags
 * Useful for displaying multi-line content
 * @param {string} str - The string to escape
 * @returns {string} The escaped string with <br> tags
 */
export function escapeHtmlWithBreaks(str) {
  return escapeHtml(str).replace(/\n/g, '<br>');
}

/**
 * Escape a string for use in a data attribute
 * @param {string} str - The string to escape
 * @returns {string} The escaped string safe for data attributes
 */
export function escapeAttribute(str) {
  return escapeHtml(str).replace(/'/g, '&#39;').replace(/"/g, '&quot;');
}
