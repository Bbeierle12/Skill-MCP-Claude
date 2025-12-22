/**
 * Toast Notification Component
 * Non-intrusive notifications with undo support
 */

// Toast container ID
const CONTAINER_ID = 'toast-container';

// Toast types and their styles
const TOAST_TYPES = {
  success: {
    bg: 'bg-green-600',
    icon: 'check-circle',
    defaultDuration: 3000,
  },
  error: {
    bg: 'bg-red-600',
    icon: 'alert-circle',
    defaultDuration: 5000,
  },
  warning: {
    bg: 'bg-yellow-600',
    icon: 'alert-triangle',
    defaultDuration: 4000,
  },
  info: {
    bg: 'bg-blue-600',
    icon: 'info',
    defaultDuration: 3000,
  },
};

// Active toasts for tracking
const activeToasts = new Map();
let toastCounter = 0;

/**
 * Ensure toast container exists
 * @returns {HTMLElement}
 */
function getContainer() {
  let container = document.getElementById(CONTAINER_ID);
  if (!container) {
    container = document.createElement('div');
    container.id = CONTAINER_ID;
    container.className = 'fixed bottom-4 right-4 z-[100] flex flex-col gap-2 pointer-events-none';
    container.setAttribute('role', 'region');
    container.setAttribute('aria-label', 'Notifications');
    container.setAttribute('aria-live', 'polite');
    document.body.appendChild(container);
  }
  return container;
}

/**
 * Create toast HTML
 * @param {string} id - Toast ID
 * @param {string} message - Toast message
 * @param {string} type - Toast type
 * @param {Object} options - Additional options
 * @returns {string}
 */
function createToastHTML(id, message, type, options = {}) {
  const typeConfig = TOAST_TYPES[type] || TOAST_TYPES.info;
  const { undoAction, undoLabel = 'Undo' } = options;

  return `
    <div id="${id}"
         class="toast ${typeConfig.bg} text-white px-4 py-3 rounded-lg shadow-lg flex items-center gap-3 pointer-events-auto transform translate-x-full opacity-0 transition-all duration-300"
         role="alert">
      <i data-lucide="${typeConfig.icon}" class="w-5 h-5 flex-shrink-0"></i>
      <span class="flex-grow text-sm">${message}</span>
      ${undoAction ? `
        <button type="button"
                class="toast-undo px-2 py-1 text-xs font-medium bg-white/20 hover:bg-white/30 rounded transition-colors"
                data-toast-undo="${id}">
          ${undoLabel}
        </button>
      ` : ''}
      <button type="button"
              class="toast-close p-1 hover:bg-white/20 rounded transition-colors"
              data-toast-close="${id}"
              aria-label="Dismiss notification">
        <i data-lucide="x" class="w-4 h-4"></i>
      </button>
    </div>
  `;
}

/**
 * Show a toast notification
 * @param {string} message - Message to display
 * @param {string} type - Toast type: 'success', 'error', 'warning', 'info'
 * @param {Object} options - Additional options
 * @param {number} options.duration - Auto-dismiss duration (0 for persistent)
 * @param {Function} options.undoAction - Undo callback function
 * @param {string} options.undoLabel - Custom undo button label
 * @returns {string} Toast ID
 */
export function showToast(message, type = 'info', options = {}) {
  const container = getContainer();
  const typeConfig = TOAST_TYPES[type] || TOAST_TYPES.info;
  const duration = options.duration ?? typeConfig.defaultDuration;

  const id = `toast-${++toastCounter}`;
  const html = createToastHTML(id, message, type, options);

  // Create element
  const temp = document.createElement('div');
  temp.innerHTML = html;
  const toast = temp.firstElementChild;
  container.appendChild(toast);

  // Initialize icons
  if (window.lucide) {
    window.lucide.createIcons({ nodes: [toast] });
  }

  // Animate in
  requestAnimationFrame(() => {
    toast.classList.remove('translate-x-full', 'opacity-0');
    toast.classList.add('translate-x-0', 'opacity-100');
  });

  // Track toast
  const toastData = {
    id,
    element: toast,
    undoAction: options.undoAction,
    timeoutId: null,
  };
  activeToasts.set(id, toastData);

  // Auto-dismiss
  if (duration > 0) {
    toastData.timeoutId = setTimeout(() => {
      dismissToast(id);
    }, duration);
  }

  return id;
}

/**
 * Dismiss a toast
 * @param {string} id - Toast ID
 * @param {boolean} executeUndo - Whether to execute undo action
 */
export function dismissToast(id, executeUndo = false) {
  const toastData = activeToasts.get(id);
  if (!toastData) return;

  const { element, undoAction, timeoutId } = toastData;

  // Clear auto-dismiss timeout
  if (timeoutId) {
    clearTimeout(timeoutId);
  }

  // Execute undo if requested
  if (executeUndo && typeof undoAction === 'function') {
    try {
      undoAction();
    } catch (error) {
      console.error('Undo action failed:', error);
    }
  }

  // Animate out
  element.classList.remove('translate-x-0', 'opacity-100');
  element.classList.add('translate-x-full', 'opacity-0');

  // Remove after animation
  setTimeout(() => {
    element.remove();
    activeToasts.delete(id);
  }, 300);
}

/**
 * Dismiss all toasts
 */
export function dismissAllToasts() {
  for (const id of activeToasts.keys()) {
    dismissToast(id);
  }
}

/**
 * Convenience methods
 */
export const toast = {
  success: (message, options) => showToast(message, 'success', options),
  error: (message, options) => showToast(message, 'error', options),
  warning: (message, options) => showToast(message, 'warning', options),
  info: (message, options) => showToast(message, 'info', options),

  /**
   * Show a toast with undo action for destructive operations
   * @param {string} message - Message
   * @param {Function} undoAction - Function to call on undo
   * @param {number} duration - Duration before auto-dismiss
   * @returns {string} Toast ID
   */
  withUndo: (message, undoAction, duration = 5000) => {
    return showToast(message, 'info', { undoAction, duration });
  },
};

/**
 * Initialize toast event listeners
 * Call once on app startup
 */
export function initToastListeners() {
  document.addEventListener('click', (event) => {
    // Close button
    const closeButton = event.target.closest('[data-toast-close]');
    if (closeButton) {
      const toastId = closeButton.dataset.toastClose;
      dismissToast(toastId);
      return;
    }

    // Undo button
    const undoButton = event.target.closest('[data-toast-undo]');
    if (undoButton) {
      const toastId = undoButton.dataset.toastUndo;
      dismissToast(toastId, true);
    }
  });
}

/**
 * Show loading toast that can be updated
 * @param {string} message - Initial message
 * @returns {Object} Controller with update() and dismiss() methods
 */
export function showLoadingToast(message) {
  const container = getContainer();
  const id = `toast-${++toastCounter}`;

  const html = `
    <div id="${id}"
         class="toast bg-gray-700 text-white px-4 py-3 rounded-lg shadow-lg flex items-center gap-3 pointer-events-auto transform translate-x-full opacity-0 transition-all duration-300"
         role="status"
         aria-live="polite">
      <div class="loading-spinner w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
      <span class="toast-message flex-grow text-sm">${message}</span>
    </div>
  `;

  const temp = document.createElement('div');
  temp.innerHTML = html;
  const toast = temp.firstElementChild;
  container.appendChild(toast);

  requestAnimationFrame(() => {
    toast.classList.remove('translate-x-full', 'opacity-0');
    toast.classList.add('translate-x-0', 'opacity-100');
  });

  activeToasts.set(id, { id, element: toast, timeoutId: null });

  return {
    /**
     * Update the loading message
     * @param {string} newMessage - New message
     */
    update(newMessage) {
      const messageEl = toast.querySelector('.toast-message');
      if (messageEl) {
        messageEl.textContent = newMessage;
      }
    },

    /**
     * Complete with success
     * @param {string} message - Success message
     */
    success(message) {
      dismissToast(id);
      showToast(message, 'success');
    },

    /**
     * Complete with error
     * @param {string} message - Error message
     */
    error(message) {
      dismissToast(id);
      showToast(message, 'error');
    },

    /**
     * Dismiss the loading toast
     */
    dismiss() {
      dismissToast(id);
    },
  };
}
