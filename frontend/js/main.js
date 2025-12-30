/**
 * Skills Manager - Main Entry Point
 * Initializes the application and sets up event handlers
 */

import { AppState, initializeState, persistState } from './state.js';
import { API } from './api.js';
import { debounce } from './utils/debounce.js';
import { initModalListeners } from './components/modal.js';
import { initToastListeners, toast, showLoadingToast } from './components/toast.js';
import { SkillsSection, updateGrid, updateFilters, updateStats } from './components/skillGrid.js';
import { openViewModal, initViewModalHandlers } from './modals/viewModal.js';
import { openEditModal, initEditModalHandlers } from './modals/editModal.js';
import { openImportModal, initImportModalHandlers } from './modals/importModal.js';

// ============================================
// Connection Management
// ============================================

const CONNECTION_CHECK_INTERVAL = 30000; // 30 seconds
let connectionCheckTimer = null;

/**
 * Update connection status UI
 * @param {boolean} isOnline
 */
function updateConnectionStatus(isOnline) {
  const statusEl = document.getElementById('connection-status');
  if (!statusEl) return;

  const textEl = statusEl.querySelector('.status-text');

  if (isOnline) {
    statusEl.classList.remove('offline');
    statusEl.classList.add('online');
    textEl.textContent = 'Connected';
  } else {
    statusEl.classList.remove('online');
    statusEl.classList.add('offline');
    textEl.textContent = 'Offline';
  }
}

/**
 * Check connection to API server
 */
async function checkConnection() {
  try {
    const isOnline = await API.checkConnection();
    AppState.update('isOnline', isOnline);
    updateConnectionStatus(isOnline);
    return isOnline;
  } catch {
    AppState.update('isOnline', false);
    updateConnectionStatus(false);
    return false;
  }
}

/**
 * Start periodic connection checks
 */
function startConnectionMonitor() {
  checkConnection();
  connectionCheckTimer = setInterval(checkConnection, CONNECTION_CHECK_INTERVAL);
}

/**
 * Stop connection monitoring
 */
function stopConnectionMonitor() {
  if (connectionCheckTimer) {
    clearInterval(connectionCheckTimer);
    connectionCheckTimer = null;
  }
}


// ============================================
// Skills Loading
// ============================================

/**
 * Load skills from API
 */
async function loadSkills() {
  AppState.update('ui.isLoading', true);
  updateGrid();

  try {
    const result = await API.skills.list();
    AppState.setSkills(result.skills || []);
  } catch (error) {
    console.error('Failed to load skills:', error);

    // Try to use cached data
    const cached = AppState.getState().skills;
    if (cached.length === 0) {
      toast.error('Failed to load skills. Is the server running?');
    } else {
      toast.warning('Using cached data. Server connection failed.');
    }
  } finally {
    AppState.update('ui.isLoading', false);
    renderSkillsSection();
  }
}

/**
 * Render the skills section
 */
function renderSkillsSection() {
  const container = document.getElementById('skills-section');
  if (!container) return;

  container.innerHTML = SkillsSection();

  // Initialize Lucide icons
  if (window.lucide) {
    window.lucide.createIcons();
  }

  // Setup search input handler
  setupSearchHandler();
}


// ============================================
// Event Handlers
// ============================================

/**
 * Setup debounced search handler
 */
function setupSearchHandler() {
  const searchInput = document.getElementById('skill-search');
  if (!searchInput) return;

  const handleSearch = debounce((value) => {
    AppState.update('filters.search', value);
    updateGrid();
    updateStats();
  }, 250);

  searchInput.addEventListener('input', (e) => {
    handleSearch(e.target.value);
  });
}

/**
 * Handle skill actions (view, edit, delete, copy)
 * @param {string} action - Action type
 * @param {string} skillName - Skill name
 */
async function handleSkillAction(action, skillName) {
  switch (action) {
    case 'view':
      openViewModal(skillName);
      break;

    case 'edit':
      openEditModal(skillName);
      break;

    case 'delete':
      await deleteSkill(skillName);
      break;

    case 'copy':
      await copySkillToClipboard(skillName);
      break;
  }
}

/**
 * Delete a skill with undo capability
 * @param {string} skillName - Skill to delete
 */
async function deleteSkill(skillName) {
  const skill = AppState.getSkill(skillName);
  if (!skill) return;

  // Optimistically remove from UI
  AppState.removeSkill(skillName);
  updateGrid();
  updateFilters();
  updateStats();

  // Show toast with undo
  const toastId = toast.withUndo(
    `Deleted "${skillName}"`,
    async () => {
      // Undo: restore skill locally
      AppState.addSkill(skill);
      updateGrid();
      updateFilters();
      updateStats();
      toast.info(`Restored "${skillName}"`);
    },
    5000
  );

  // Actually delete after toast expires (if not undone)
  setTimeout(async () => {
    // Check if skill was restored (undo was clicked)
    if (AppState.getSkill(skillName)) return;

    try {
      await API.skills.delete(skillName);
    } catch (error) {
      console.error('Failed to delete skill:', error);
      // Restore on error
      AppState.addSkill(skill);
      updateGrid();
      toast.error(`Failed to delete "${skillName}": ${error.userMessage || error.message}`);
    }
  }, 5500);
}

/**
 * Copy skill content to clipboard
 * @param {string} skillName - Skill name
 */
async function copySkillToClipboard(skillName) {
  try {
    let skill = AppState.getSkill(skillName);

    if (!skill?.content) {
      skill = await API.skills.get(skillName);
    }

    await navigator.clipboard.writeText(skill.content || '');
    toast.success('Copied to clipboard');
  } catch (error) {
    console.error('Failed to copy:', error);
    toast.error('Failed to copy to clipboard');
  }
}

/**
 * Handle filter changes
 * @param {string} category - Category to filter by
 */
function handleCategoryFilter(category) {
  AppState.update('filters.category', category);
  updateGrid();
  updateFilters();
  updateStats();
}

/**
 * Clear all filters
 */
function clearFilters() {
  AppState.batchUpdate({
    'filters.search': '',
    'filters.category': 'all'
  });

  const searchInput = document.getElementById('skill-search');
  if (searchInput) {
    searchInput.value = '';
  }

  updateGrid();
  updateFilters();
  updateStats();
}


// ============================================
// Global Event Delegation
// ============================================

/**
 * Setup global event delegation
 */
function setupEventDelegation() {
  document.addEventListener('click', (event) => {
    const target = event.target;

    // Skill actions (view, edit, delete, copy)
    const actionButton = target.closest('[data-action]');
    if (actionButton) {
      const action = actionButton.dataset.action;
      const skillName = actionButton.dataset.skill;

      // Skill-specific actions
      if (skillName && ['view', 'edit', 'delete', 'copy'].includes(action)) {
        event.preventDefault();
        handleSkillAction(action, skillName);
        return;
      }

      // Category filter
      if (action === 'filter-category') {
        const category = actionButton.dataset.category;
        handleCategoryFilter(category);
        return;
      }

      // Clear filters
      if (action === 'clear-filters' || action === 'clear-search') {
        clearFilters();
        return;
      }

      // Open import modal
      if (action === 'open-import-modal') {
        openImportModal();
        return;
      }

    }
  });
}


// ============================================
// State Subscriptions
// ============================================

/**
 * Setup state change subscriptions
 */
function setupStateSubscriptions() {
  AppState.subscribe((path, value, state) => {
    // Handle skill changes
    if (path.startsWith('skills')) {
      updateGrid();
      updateFilters();
      updateStats();
    }

    // Handle filter changes
    if (path.startsWith('filters')) {
      updateGrid();
      updateStats();
    }

    // Handle loading state
    if (path === 'ui.isLoading') {
      updateGrid();
    }
  });
}


// ============================================
// Initialization
// ============================================

/**
 * Initialize the application
 */
async function init() {
  console.log('Skills Manager initializing...');

  // Initialize state from localStorage
  initializeState();

  // Setup event handlers
  initModalListeners();
  initToastListeners();
  initViewModalHandlers();
  initEditModalHandlers();
  initImportModalHandlers();
  setupEventDelegation();
  setupStateSubscriptions();

  // Start connection monitoring
  startConnectionMonitor();

  // Load skills
  await loadSkills();

  // Initialize Lucide icons
  if (window.lucide) {
    window.lucide.createIcons();
  }

  console.log('Skills Manager initialized');
}

// Handle visibility change (pause/resume connection checks)
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    stopConnectionMonitor();
  } else {
    startConnectionMonitor();
    loadSkills(); // Refresh on tab focus
  }
});

// Handle online/offline events
window.addEventListener('online', () => {
  checkConnection();
  loadSkills();
});

window.addEventListener('offline', () => {
  AppState.update('isOnline', false);
  updateConnectionStatus(false);
});

// Persist state before unload
window.addEventListener('beforeunload', () => {
  persistState();
});

// Start the application
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
