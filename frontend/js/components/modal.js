/**
 * Modal Base Component
 * Accessible modal implementation with focus trapping
 */

import { AppState } from '../state.js';

// Track the element that opened the modal for focus restoration
let triggerElement = null;

// Focusable elements selector
const FOCUSABLE_SELECTOR = [
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'a[href]',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

/**
 * Modal configuration
 * @typedef {Object} ModalConfig
 * @property {string} id - Modal ID
 * @property {string} title - Modal title
 * @property {string} size - Modal size: 'sm', 'md', 'lg', 'xl', 'full'
 * @property {boolean} closeOnBackdrop - Close when clicking backdrop
 * @property {boolean} closeOnEscape - Close when pressing Escape
 * @property {boolean} showClose - Show close button
 * @property {Function} onClose - Callback when modal closes
 */

/**
 * Get size class for modal
 * @param {string} size - Size key
 * @returns {string} CSS class
 */
function getSizeClass(size) {
  const sizes = {
    sm: 'max-w-sm',
    md: 'max-w-md',
    lg: 'max-w-lg',
    xl: 'max-w-xl',
    '2xl': 'max-w-2xl',
    '4xl': 'max-w-4xl',
    full: 'max-w-full mx-4',
  };
  return sizes[size] || sizes.md;
}

/**
 * Create modal HTML structure
 * @param {ModalConfig} config - Modal configuration
 * @param {string} content - Modal body content
 * @returns {string} Modal HTML
 */
export function createModal(config, content) {
  const {
    id,
    title,
    size = 'md',
    showClose = true,
  } = config;

  const sizeClass = getSizeClass(size);

  return `
    <div id="${id}"
         class="modal fixed inset-0 z-50 hidden"
         role="dialog"
         aria-modal="true"
         aria-labelledby="${id}-title">

      <!-- Backdrop -->
      <div class="modal-backdrop fixed inset-0 bg-black/60 backdrop-blur-sm"
           data-modal-backdrop="${id}"></div>

      <!-- Modal Container -->
      <div class="modal-container fixed inset-0 flex items-center justify-center p-4 pointer-events-none">
        <div class="modal-content ${sizeClass} w-full bg-gray-800 rounded-xl shadow-2xl pointer-events-auto"
             role="document">

          <!-- Header -->
          <div class="modal-header flex items-center justify-between px-6 py-4 border-b border-gray-700">
            <h2 id="${id}-title" class="text-lg font-semibold text-white">
              ${title}
            </h2>
            ${showClose ? `
              <button type="button"
                      class="modal-close p-2 text-gray-400 hover:text-white hover:bg-gray-700 rounded-lg transition-colors"
                      data-modal-close="${id}"
                      aria-label="Close modal">
                <i data-lucide="x" class="w-5 h-5"></i>
              </button>
            ` : ''}
          </div>

          <!-- Body -->
          <div class="modal-body px-6 py-4 max-h-[70vh] overflow-y-auto">
            ${content}
          </div>

        </div>
      </div>
    </div>
  `;
}

/**
 * Create modal with footer buttons
 * @param {ModalConfig} config - Modal configuration
 * @param {string} bodyContent - Modal body content
 * @param {string} footerContent - Modal footer content
 * @returns {string} Modal HTML
 */
export function createModalWithFooter(config, bodyContent, footerContent) {
  const {
    id,
    title,
    size = 'md',
    showClose = true,
  } = config;

  const sizeClass = getSizeClass(size);

  return `
    <div id="${id}"
         class="modal fixed inset-0 z-50 hidden"
         role="dialog"
         aria-modal="true"
         aria-labelledby="${id}-title">

      <!-- Backdrop -->
      <div class="modal-backdrop fixed inset-0 bg-black/60 backdrop-blur-sm"
           data-modal-backdrop="${id}"></div>

      <!-- Modal Container -->
      <div class="modal-container fixed inset-0 flex items-center justify-center p-4 pointer-events-none">
        <div class="modal-content ${sizeClass} w-full bg-gray-800 rounded-xl shadow-2xl pointer-events-auto flex flex-col max-h-[90vh]"
             role="document">

          <!-- Header -->
          <div class="modal-header flex items-center justify-between px-6 py-4 border-b border-gray-700 flex-shrink-0">
            <h2 id="${id}-title" class="text-lg font-semibold text-white">
              ${title}
            </h2>
            ${showClose ? `
              <button type="button"
                      class="modal-close p-2 text-gray-400 hover:text-white hover:bg-gray-700 rounded-lg transition-colors"
                      data-modal-close="${id}"
                      aria-label="Close modal">
                <i data-lucide="x" class="w-5 h-5"></i>
              </button>
            ` : ''}
          </div>

          <!-- Body -->
          <div class="modal-body px-6 py-4 overflow-y-auto flex-grow">
            ${bodyContent}
          </div>

          <!-- Footer -->
          <div class="modal-footer px-6 py-4 border-t border-gray-700 flex-shrink-0">
            ${footerContent}
          </div>

        </div>
      </div>
    </div>
  `;
}

/**
 * Open a modal by ID
 * @param {string} modalId - Modal ID
 */
export function openModal(modalId) {
  const modal = document.getElementById(modalId);
  if (!modal) {
    console.error(`Modal not found: ${modalId}`);
    return;
  }

  // Store trigger element for focus restoration
  triggerElement = document.activeElement;

  // Update state
  AppState.update('ui.activeModal', modalId);

  // Show modal
  modal.classList.remove('hidden');
  modal.classList.add('flex');

  // Set aria-hidden on main content
  const mainContent = document.getElementById('main-content');
  if (mainContent) {
    mainContent.setAttribute('aria-hidden', 'true');
  }

  // Focus first focusable element
  requestAnimationFrame(() => {
    const focusable = modal.querySelectorAll(FOCUSABLE_SELECTOR);
    if (focusable.length > 0) {
      focusable[0].focus();
    }
  });

  // Initialize icons in modal
  if (window.lucide) {
    window.lucide.createIcons({ nodes: [modal] });
  }
}

/**
 * Close a modal by ID
 * @param {string} modalId - Modal ID
 */
export function closeModal(modalId) {
  const modal = document.getElementById(modalId);
  if (!modal) return;

  // Hide modal
  modal.classList.add('hidden');
  modal.classList.remove('flex');

  // Update state
  if (AppState.getState().ui.activeModal === modalId) {
    AppState.update('ui.activeModal', null);
  }

  // Remove aria-hidden from main content
  const mainContent = document.getElementById('main-content');
  if (mainContent) {
    mainContent.removeAttribute('aria-hidden');
  }

  // Restore focus to trigger element
  if (triggerElement && typeof triggerElement.focus === 'function') {
    triggerElement.focus();
    triggerElement = null;
  }
}

/**
 * Close the currently active modal
 */
export function closeActiveModal() {
  const activeModal = AppState.getState().ui.activeModal;
  if (activeModal) {
    closeModal(activeModal);
  }
}

/**
 * Handle focus trapping within modal
 * @param {KeyboardEvent} event - Keyboard event
 */
function handleFocusTrap(event) {
  const activeModalId = AppState.getState().ui.activeModal;
  if (!activeModalId) return;

  const modal = document.getElementById(activeModalId);
  if (!modal) return;

  const focusableElements = modal.querySelectorAll(FOCUSABLE_SELECTOR);
  if (focusableElements.length === 0) return;

  const firstElement = focusableElements[0];
  const lastElement = focusableElements[focusableElements.length - 1];

  if (event.key === 'Tab') {
    if (event.shiftKey) {
      // Shift + Tab: going backwards
      if (document.activeElement === firstElement) {
        event.preventDefault();
        lastElement.focus();
      }
    } else {
      // Tab: going forwards
      if (document.activeElement === lastElement) {
        event.preventDefault();
        firstElement.focus();
      }
    }
  }
}

/**
 * Handle escape key to close modal
 * @param {KeyboardEvent} event - Keyboard event
 */
function handleEscapeKey(event) {
  if (event.key === 'Escape') {
    closeActiveModal();
  }
}

/**
 * Initialize modal event listeners
 * Call this once on app startup
 */
export function initModalListeners() {
  // Global keyboard listeners
  document.addEventListener('keydown', handleFocusTrap);
  document.addEventListener('keydown', handleEscapeKey);

  // Delegate backdrop and close button clicks
  document.addEventListener('click', (event) => {
    // Close button
    const closeButton = event.target.closest('[data-modal-close]');
    if (closeButton) {
      const modalId = closeButton.dataset.modalClose;
      closeModal(modalId);
      return;
    }

    // Backdrop click
    const backdrop = event.target.closest('[data-modal-backdrop]');
    if (backdrop && event.target === backdrop) {
      const modalId = backdrop.dataset.modalBackdrop;
      closeModal(modalId);
    }
  });
}

/**
 * Update modal title
 * @param {string} modalId - Modal ID
 * @param {string} title - New title
 */
export function setModalTitle(modalId, title) {
  const titleElement = document.getElementById(`${modalId}-title`);
  if (titleElement) {
    titleElement.textContent = title;
  }
}

/**
 * Update modal body content
 * @param {string} modalId - Modal ID
 * @param {string} content - New content HTML
 */
export function setModalBody(modalId, content) {
  const modal = document.getElementById(modalId);
  if (!modal) return;

  const body = modal.querySelector('.modal-body');
  if (body) {
    body.innerHTML = content;

    // Initialize icons
    if (window.lucide) {
      window.lucide.createIcons({ nodes: [body] });
    }
  }
}

/**
 * Check if a modal is currently open
 * @param {string} modalId - Modal ID
 * @returns {boolean}
 */
export function isModalOpen(modalId) {
  return AppState.getState().ui.activeModal === modalId;
}
