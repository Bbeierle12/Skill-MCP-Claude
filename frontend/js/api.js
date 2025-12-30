/**
 * API Service Layer
 * Handles all communication with the Skills Manager backend
 */

/**
 * @typedef {Object} APIResponse
 * @property {boolean} success - Whether the request succeeded
 * @property {*} data - Response data
 * @property {string|null} error - Error message if failed
 */

/**
 * Custom error class for API errors
 */
export class APIError extends Error {
  /**
   * @param {string} message - Error message
   * @param {number} status - HTTP status code
   * @param {string} code - Error code for programmatic handling
   */
  constructor(message, status = 0, code = 'UNKNOWN_ERROR') {
    super(message);
    this.name = 'APIError';
    this.status = status;
    this.code = code;
  }

  /**
   * Get a user-friendly error message
   * @returns {string}
   */
  get userMessage() {
    switch (this.code) {
      case 'NETWORK_ERROR':
        return 'Unable to connect to server. Check if the API is running on port 5050.';
      case 'TIMEOUT':
        return 'Request timed out. The server may be busy or unresponsive.';
      case 'SKILL_EXISTS':
        return 'A skill with this name already exists. Choose a different name or enable overwrite.';
      case 'SKILL_NOT_FOUND':
        return 'The requested skill was not found. It may have been deleted.';
      case 'INVALID_PATH':
        return 'The specified path is invalid or inaccessible.';
      case 'PERMISSION_DENIED':
        return 'Permission denied. Check file system permissions.';
      case 'VALIDATION_ERROR':
        return this.message || 'Invalid input. Please check your data.';
      default:
        return this.message || 'An unexpected error occurred.';
    }
  }
}

/**
 * Delay helper for retry logic
 * @param {number} ms - Milliseconds to delay
 * @returns {Promise<void>}
 */
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * API Service
 */
export const API = {
  baseUrl: ''  // Use relative URLs for Vercel,

  // Request configuration
  config: {
    timeout: 30000,      // 30 second default timeout
    retries: 3,          // Number of retry attempts
    retryDelay: 1000,    // Base delay for exponential backoff
  },

  /**
   * Make an API request with retry logic
   * @param {string} endpoint - API endpoint (e.g., '/api/skills')
   * @param {Object} options - Fetch options
   * @returns {Promise<*>} Response data
   */
  async request(endpoint, options = {}) {
    const url = `${this.baseUrl}${endpoint}`;
    const { retries = this.config.retries, ...fetchOptions } = options;

    const defaultHeaders = {
      'Content-Type': 'application/json',
    };

    const config = {
      ...fetchOptions,
      headers: {
        ...defaultHeaders,
        ...fetchOptions.headers,
      },
    };

    // Handle body serialization
    if (config.body && typeof config.body === 'object' && !(config.body instanceof FormData)) {
      config.body = JSON.stringify(config.body);
    }

    // FormData should not have Content-Type header (browser sets it with boundary)
    if (config.body instanceof FormData) {
      delete config.headers['Content-Type'];
    }

    let lastError;

    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        // Create abort controller for timeout
        const controller = new AbortController();
        const timeoutId = setTimeout(
          () => controller.abort(),
          options.timeout || this.config.timeout
        );

        try {
          const response = await fetch(url, {
            ...config,
            signal: controller.signal,
          });

          clearTimeout(timeoutId);

          // Parse response
          let data;
          const contentType = response.headers.get('content-type');
          if (contentType && contentType.includes('application/json')) {
            data = await response.json();
          } else {
            data = await response.text();
          }

          // Handle error responses
          if (!response.ok) {
            const errorMessage = data?.error || data?.message || `HTTP ${response.status}`;
            const errorCode = this.mapStatusToCode(response.status, data);
            throw new APIError(errorMessage, response.status, errorCode);
          }

          return data;

        } catch (error) {
          clearTimeout(timeoutId);
          throw error;
        }

      } catch (error) {
        lastError = error;

        // Don't retry on certain errors
        if (error instanceof APIError) {
          if ([400, 401, 403, 404, 409].includes(error.status)) {
            throw error; // Client errors shouldn't be retried
          }
        }

        // Handle abort/timeout
        if (error.name === 'AbortError') {
          lastError = new APIError('Request timed out', 0, 'TIMEOUT');
        }

        // Handle network errors
        if (error instanceof TypeError && error.message.includes('fetch')) {
          lastError = new APIError('Network error', 0, 'NETWORK_ERROR');
        }

        // Wait before retry (exponential backoff)
        if (attempt < retries) {
          const waitTime = this.config.retryDelay * Math.pow(2, attempt);
          console.warn(`Request failed, retrying in ${waitTime}ms...`, error.message);
          await delay(waitTime);
        }
      }
    }

    throw lastError;
  },

  /**
   * Map HTTP status code to error code
   * @param {number} status - HTTP status
   * @param {Object} data - Response data
   * @returns {string} Error code
   */
  mapStatusToCode(status, data) {
    if (data?.code) return data.code;

    switch (status) {
      case 400: return 'VALIDATION_ERROR';
      case 403: return 'PERMISSION_DENIED';
      case 404: return 'SKILL_NOT_FOUND';
      case 408: return 'TIMEOUT';
      case 409: return 'SKILL_EXISTS';
      case 500: return 'SERVER_ERROR';
      case 502:
      case 503:
      case 504: return 'SERVICE_UNAVAILABLE';
      default: return 'UNKNOWN_ERROR';
    }
  },

  // ============================================
  // Skill Operations
  // ============================================

  skills: {
    /**
     * List all skills
     * @returns {Promise<{skills: Skill[]}>}
     */
    async list() {
      return API.request('/api/skills');
    },

    /**
     * Get a specific skill by name
     * @param {string} name - Skill name
     * @returns {Promise<Skill>}
     */
    async get(name) {
      return API.request(`/api/skills/${encodeURIComponent(name)}`);
    },

    /**
     * Create a new skill
     * @param {Object} data - Skill data
     * @param {string} data.name - Skill name
     * @param {string} data.description - Description
     * @param {string} data.content - Markdown content
     * @param {string[]} data.tags - Tags
     * @param {boolean} data.overwrite - Overwrite if exists
     * @returns {Promise<{success: boolean, name: string, path: string}>}
     */
    async create(data) {
      return API.request('/api/skills', {
        method: 'POST',
        body: data,
      });
    },

    /**
     * Update an existing skill
     * @param {string} name - Skill name
     * @param {Object} data - Updated skill data
     * @returns {Promise<{success: boolean, name: string}>}
     */
    async update(name, data) {
      return API.request(`/api/skills/${encodeURIComponent(name)}`, {
        method: 'PUT',
        body: data,
      });
    },

    /**
     * Delete a skill
     * @param {string} name - Skill name
     * @returns {Promise<{success: boolean, name: string}>}
     */
    async delete(name) {
      return API.request(`/api/skills/${encodeURIComponent(name)}`, {
        method: 'DELETE',
      });
    },
  },

  // ============================================
  // Import Operations
  // ============================================

  import: {
    /**
     * Import a skill from a folder path
     * @param {string} path - Folder path
     * @param {string} name - Optional new name
     * @returns {Promise<{success: boolean, name: string, files_imported: number}>}
     */
    async folder(path, name = '') {
      return API.request('/api/import/folder', {
        method: 'POST',
        body: { path, name },
      });
    },

    /**
     * Import files via multipart form
     * @param {FormData} formData - Form data with files
     * @returns {Promise<{success: boolean, name: string, files_imported: string[]}>}
     */
    async files(formData) {
      return API.request('/api/import/files', {
        method: 'POST',
        body: formData,
      });
    },

    /**
     * Import files via JSON with base64 content
     * @param {Object} data - Import data
     * @param {string} data.skill_name - Skill name
     * @param {Array} data.files - Files array with path and content
     * @returns {Promise<{success: boolean, name: string, files_imported: string[]}>}
     */
    async json(data) {
      return API.request('/api/import/json', {
        method: 'POST',
        body: data,
      });
    },
  },

  // ============================================
  // Browse Operations
  // ============================================

  browse: {
    /**
     * Browse filesystem for import
     * @param {string} path - Path to browse (empty for root/drives)
     * @returns {Promise<{path: string, parent: string|null, dirs: Array, files: Array}>}
     */
    async list(path = '') {
      const params = path ? `?path=${encodeURIComponent(path)}` : '';
      return API.request(`/api/browse${params}`);
    },
  },

  // ============================================
  // Utility Methods
  // ============================================

  /**
   * Reload the skills index on the server
   * @returns {Promise<{success: boolean, message: string}>}
   */
  async reload() {
    return this.request('/api/reload', { method: 'POST' });
  },

  /**
   * Check if the API is reachable
   * @returns {Promise<boolean>}
   */
  async checkConnection() {
    try {
      await this.request('/api/skills', { retries: 0, timeout: 5000 });
      return true;
    } catch {
      return false;
    }
  },
};

// Export for use in other modules
export default API;
