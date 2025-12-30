/**
 * Centralized State Management
 * Reactive state with subscriber pattern for UI updates
 */

/**
 * @typedef {Object} Skill
 * @property {string} name - Skill name/ID
 * @property {string} description - Skill description
 * @property {string} content - Skill markdown content
 * @property {string[]} tags - Skill tags
 * @property {boolean} has_scripts - Whether skill has scripts
 * @property {boolean} has_references - Whether skill has references
 * @property {number} file_count - Number of files in skill
 */

/**
 * @typedef {Object} UIState
 * @property {string|null} activeModal - Currently open modal ID
 * @property {string|null} editingSkill - Skill being edited
 * @property {string|null} viewingSkill - Skill being viewed
 * @property {boolean} isLoading - Global loading state
 * @property {string} loadingMessage - Loading message to display
 */

/**
 * @typedef {Object} FilterState
 * @property {string} search - Search query
 * @property {string} category - Active category filter ('all' or category name)
 */

// Categories for skill classification
export const CATEGORIES = {
  development: {
    name: 'Development',
    keywords: ['code', 'programming', 'api', 'debug', 'test', 'react', 'typescript', 'javascript'],
    color: 'blue'
  },
  documentation: {
    name: 'Documentation',
    keywords: ['doc', 'readme', 'guide', 'tutorial', 'help', 'manual'],
    color: 'green'
  },
  forms: {
    name: 'Forms',
    keywords: ['form', 'input', 'validation', 'field', 'submit'],
    color: 'purple'
  },
  building: {
    name: '3D/Building',
    keywords: ['3d', 'build', 'model', 'scene', 'render', 'three', 'babylon'],
    color: 'orange'
  },
  visual: {
    name: 'Visual/Creative',
    keywords: ['visual', 'design', 'ui', 'ux', 'style', 'theme', 'animation'],
    color: 'pink'
  },
  other: {
    name: 'Other',
    keywords: [],
    color: 'gray'
  }
};

/**
 * Infer category from skill data
 * @param {Skill} skill - The skill to categorize
 * @returns {string} Category key
 */
export function inferCategory(skill) {
  const searchText = `${skill.name} ${skill.description || ''} ${(skill.tags || []).join(' ')}`.toLowerCase();

  for (const [key, category] of Object.entries(CATEGORIES)) {
    if (key === 'other') continue;
    if (category.keywords.some(kw => searchText.includes(kw))) {
      return key;
    }
  }

  return 'other';
}

/**
 * Get category display info
 * @param {string} categoryKey - Category key
 * @returns {Object} Category info with name and color
 */
export function getCategoryInfo(categoryKey) {
  return CATEGORIES[categoryKey] || CATEGORIES.other;
}

// Create the state store
function createStore(initialState) {
  let state = { ...initialState };
  const subscribers = new Set();

  return {
    /**
     * Get the current state (read-only)
     * @returns {Object} Current state
     */
    getState() {
      return state;
    },

    /**
     * Update state at a path
     * @param {string} path - Dot-notation path (e.g., 'ui.isLoading')
     * @param {*} value - New value
     */
    update(path, value) {
      const keys = path.split('.');
      const newState = { ...state };
      let current = newState;

      for (let i = 0; i < keys.length - 1; i++) {
        current[keys[i]] = { ...current[keys[i]] };
        current = current[keys[i]];
      }

      current[keys[keys.length - 1]] = value;
      state = newState;
      this.notify(path, value);
    },

    /**
     * Batch update multiple paths
     * @param {Object} updates - Object of path: value pairs
     */
    batchUpdate(updates) {
      for (const [path, value] of Object.entries(updates)) {
        const keys = path.split('.');
        let current = state;

        for (let i = 0; i < keys.length - 1; i++) {
          current[keys[i]] = { ...current[keys[i]] };
          current = current[keys[i]];
        }

        current[keys[keys.length - 1]] = value;
      }

      state = { ...state };
      this.notify('batch', updates);
    },

    /**
     * Set entire skills array
     * @param {Skill[]} skills - New skills array
     */
    setSkills(skills) {
      state = { ...state, skills: [...skills] };
      this.notify('skills', skills);
    },

    /**
     * Add a skill
     * @param {Skill} skill - Skill to add
     */
    addSkill(skill) {
      state = { ...state, skills: [...state.skills, skill] };
      this.notify('skills.add', skill);
    },

    /**
     * Update a skill by name
     * @param {string} name - Skill name
     * @param {Partial<Skill>} updates - Updates to apply
     */
    updateSkill(name, updates) {
      const index = state.skills.findIndex(s => s.name === name);
      if (index === -1) return;

      const newSkills = [...state.skills];
      newSkills[index] = { ...newSkills[index], ...updates };
      state = { ...state, skills: newSkills };
      this.notify('skills.update', { name, updates });
    },

    /**
     * Remove a skill by name
     * @param {string} name - Skill name
     */
    removeSkill(name) {
      state = {
        ...state,
        skills: state.skills.filter(s => s.name !== name)
      };
      this.notify('skills.remove', name);
    },

    /**
     * Get a skill by name
     * @param {string} name - Skill name
     * @returns {Skill|undefined}
     */
    getSkill(name) {
      return state.skills.find(s => s.name === name);
    },

    /**
     * Get filtered skills based on current filters
     * @returns {Skill[]}
     */
    getFilteredSkills() {
      let result = [...state.skills];

      // Apply category filter
      if (state.filters.category !== 'all') {
        result = result.filter(skill =>
          inferCategory(skill) === state.filters.category
        );
      }

      // Apply search filter
      if (state.filters.search) {
        const search = state.filters.search.toLowerCase();
        result = result.filter(skill =>
          skill.name.toLowerCase().includes(search) ||
          (skill.description || '').toLowerCase().includes(search) ||
          (skill.tags || []).some(tag => tag.toLowerCase().includes(search))
        );
      }

      return result;
    },

    /**
     * Get skill counts by category
     * @returns {Object} Category counts
     */
    getCategoryCounts() {
      const counts = { all: state.skills.length };

      for (const key of Object.keys(CATEGORIES)) {
        counts[key] = 0;
      }

      for (const skill of state.skills) {
        const category = inferCategory(skill);
        counts[category] = (counts[category] || 0) + 1;
      }

      return counts;
    },

    /**
     * Subscribe to state changes
     * @param {Function} callback - Callback function (path, value) => void
     * @returns {Function} Unsubscribe function
     */
    subscribe(callback) {
      subscribers.add(callback);
      return () => subscribers.delete(callback);
    },

    /**
     * Notify all subscribers of a change
     * @param {string} path - Path that changed
     * @param {*} value - New value
     */
    notify(path, value) {
      for (const callback of subscribers) {
        try {
          callback(path, value, state);
        } catch (error) {
          console.error('State subscriber error:', error);
        }
      }
    },

    /**
     * Reset state to initial values
     */
    reset() {
      state = { ...initialState };
      this.notify('reset', state);
    }
  };
}

// Initial state
const initialState = {
  // Data
  skills: [],

  // Connection status
  isOnline: false,

  // UI state
  ui: {
    activeModal: null,
    editingSkill: null,
    viewingSkill: null,
    isLoading: false,
    loadingMessage: ''
  },

  // Filter state
  filters: {
    search: '',
    category: 'all'
  },

  // File selection (for imports)
  selectedFiles: [],

  // Browse state
  browse: {
    currentPath: '',
    directories: [],
    files: []
  },

  // Cache
  cache: {
    lastFetch: null,
    skillContents: {}
  }
};

// Create and export the store singleton
export const AppState = createStore(initialState);

// Storage key for persisting state
const STORAGE_KEY = 'skills-manager-state';

/**
 * Save current state to localStorage
 */
export function persistState() {
  try {
    const state = AppState.getState();
    const toPersist = {
      skills: state.skills,
      filters: state.filters,
      cache: {
        lastFetch: Date.now()
      }
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(toPersist));
  } catch (error) {
    console.warn('Failed to persist state:', error);
  }
}

/**
 * Load persisted state from localStorage
 * @returns {Object|null} Persisted state or null
 */
export function loadPersistedState() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return null;

    const parsed = JSON.parse(stored);

    // Check if cache is stale (older than 5 minutes)
    if (parsed.cache?.lastFetch) {
      const age = Date.now() - parsed.cache.lastFetch;
      if (age > 5 * 60 * 1000) {
        return null; // Cache too old
      }
    }

    return parsed;
  } catch (error) {
    console.warn('Failed to load persisted state:', error);
    return null;
  }
}

/**
 * Initialize state with persisted data
 */
export function initializeState() {
  const persisted = loadPersistedState();
  if (persisted) {
    if (persisted.skills) {
      AppState.setSkills(persisted.skills);
    }
    if (persisted.filters) {
      AppState.batchUpdate({
        'filters.search': persisted.filters.search || '',
        'filters.category': persisted.filters.category || 'all'
      });
    }
  }
}

// Auto-persist on relevant changes
AppState.subscribe((path) => {
  if (path.startsWith('skills') || path.startsWith('filters')) {
    // Debounce persistence to avoid excessive writes
    clearTimeout(window._persistTimeout);
    window._persistTimeout = setTimeout(persistState, 1000);
  }
});
