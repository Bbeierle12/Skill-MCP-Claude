/**
 * Edit Modal Component
 * Edit existing skills with live preview
 */

import { createModalWithFooter, openModal, closeModal, setModalTitle, setModalBody } from '../components/modal.js';
import { escapeHtml } from '../utils/escapeHtml.js';
import { validateSkillName, validateDescription, validateContent } from '../utils/validation.js';
import { AppState } from '../state.js';
import { API } from '../api.js';
import { toast, showLoadingToast } from '../components/toast.js';

const MODAL_ID = 'edit-skill-modal';

/**
 * Get the modal HTML structure
 * @returns {string}
 */
function getModalHTML() {
  return createModalWithFooter(
    {
      id: MODAL_ID,
      title: 'Edit Skill',
      size: '4xl',
    },
    `<div class="edit-form-container">
      <div class="loading-placeholder flex items-center justify-center py-8">
        <div class="loading-spinner w-8 h-8 border-2 border-gray-600 border-t-purple-500 rounded-full animate-spin"></div>
      </div>
    </div>`,
    `<div class="flex items-center justify-end gap-3 w-full">
      <button type="button"
              class="px-4 py-2 text-sm font-medium text-gray-300 hover:text-white transition-colors"
              data-modal-close="${MODAL_ID}">
        Cancel
      </button>
      <button type="button"
              id="save-skill-btn"
              class="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-purple-600 hover:bg-purple-500 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              data-action="save-skill">
        <i data-lucide="save" class="w-4 h-4"></i>
        Save Changes
      </button>
    </div>`
  );
}

/**
 * Render edit form
 * @param {Object} skill - Skill data
 * @returns {string} HTML
 */
function renderEditForm(skill) {
  return `
    <form id="edit-skill-form" class="space-y-6">
      <!-- Skill name (read-only) -->
      <div class="form-group">
        <label class="block text-sm font-medium text-gray-300 mb-2">
          Skill Name
        </label>
        <input type="text"
               value="${escapeHtml(skill.name)}"
               class="w-full px-4 py-2 bg-gray-900 border border-gray-700 rounded-lg text-gray-400 cursor-not-allowed"
               disabled
               readonly>
        <p class="mt-1 text-xs text-gray-500">Skill names cannot be changed after creation</p>
      </div>

      <!-- Description -->
      <div class="form-group">
        <label for="edit-description" class="block text-sm font-medium text-gray-300 mb-2">
          Description
        </label>
        <input type="text"
               id="edit-description"
               name="description"
               value="${escapeHtml(skill.description || '')}"
               class="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:border-purple-500 focus:ring-1 focus:ring-purple-500 focus:outline-none transition-colors"
               placeholder="Brief description of the skill"
               maxlength="500">
        <p class="mt-1 text-xs text-gray-500">
          <span id="desc-char-count">${(skill.description || '').length}</span>/500 characters
        </p>
      </div>

      <!-- Tags -->
      <div class="form-group">
        <label for="edit-tags" class="block text-sm font-medium text-gray-300 mb-2">
          Tags
        </label>
        <input type="text"
               id="edit-tags"
               name="tags"
               value="${escapeHtml((skill.tags || []).join(', '))}"
               class="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:border-purple-500 focus:ring-1 focus:ring-purple-500 focus:outline-none transition-colors"
               placeholder="Comma-separated tags (e.g., react, forms, validation)">
        <p class="mt-1 text-xs text-gray-500">Separate tags with commas</p>
      </div>

      <!-- Content -->
      <div class="form-group">
        <label for="edit-content" class="block text-sm font-medium text-gray-300 mb-2">
          Content (Markdown)
        </label>
        <textarea id="edit-content"
                  name="content"
                  rows="15"
                  class="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:border-purple-500 focus:ring-1 focus:ring-purple-500 focus:outline-none transition-colors font-mono text-sm resize-y"
                  placeholder="# Skill Title&#10;&#10;Write your skill content in Markdown...">${escapeHtml(skill.content || '')}</textarea>
        <div class="flex items-center justify-between mt-1">
          <p class="text-xs text-gray-500">
            <span id="content-char-count">${(skill.content || '').length}</span> characters
          </p>
          <button type="button"
                  class="text-xs text-purple-400 hover:text-purple-300 transition-colors"
                  data-action="preview-content">
            Preview
          </button>
        </div>
      </div>

      <!-- Validation errors -->
      <div id="edit-errors" class="hidden p-4 bg-red-900/20 border border-red-500/30 rounded-lg">
        <div class="flex items-start gap-3">
          <i data-lucide="alert-circle" class="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5"></i>
          <div>
            <h4 class="text-sm font-medium text-red-400">Please fix the following errors:</h4>
            <ul id="error-list" class="mt-2 text-sm text-red-300 list-disc list-inside space-y-1"></ul>
          </div>
        </div>
      </div>
    </form>
  `;
}

/**
 * Parse tags from comma-separated string
 * @param {string} tagString - Comma-separated tags
 * @returns {string[]}
 */
function parseTags(tagString) {
  if (!tagString) return [];
  return tagString
    .split(',')
    .map(tag => tag.trim())
    .filter(tag => tag.length > 0);
}

/**
 * Validate form and show errors
 * @returns {Object|null} Form data if valid, null if invalid
 */
function validateForm() {
  const form = document.getElementById('edit-skill-form');
  if (!form) return null;

  const description = form.querySelector('#edit-description').value;
  const content = form.querySelector('#edit-content').value;
  const tagsStr = form.querySelector('#edit-tags').value;
  const tags = parseTags(tagsStr);

  const errors = [];

  const descResult = validateDescription(description);
  if (!descResult.valid) errors.push(descResult.error);

  const contentResult = validateContent(content);
  if (!contentResult.valid) errors.push(contentResult.error);

  // Validate tags
  if (tags.length > 10) {
    errors.push('Maximum 10 tags allowed');
  }

  for (const tag of tags) {
    if (tag.length > 30) {
      errors.push(`Tag "${tag}" is too long (max 30 characters)`);
      break;
    }
  }

  const errorsContainer = document.getElementById('edit-errors');
  const errorList = document.getElementById('error-list');

  if (errors.length > 0) {
    errorsContainer.classList.remove('hidden');
    errorList.innerHTML = errors.map(e => `<li>${escapeHtml(e)}</li>`).join('');

    if (window.lucide) {
      window.lucide.createIcons({ nodes: [errorsContainer] });
    }

    return null;
  }

  errorsContainer.classList.add('hidden');

  return {
    description: description.trim(),
    content: content.trim(),
    tags,
  };
}

/**
 * Open the edit modal for a skill
 * @param {string} skillName - Name of skill to edit
 */
export async function openEditModal(skillName) {
  // Ensure modal exists in DOM
  if (!document.getElementById(MODAL_ID)) {
    const container = document.getElementById('modals-container');
    if (container) {
      container.insertAdjacentHTML('beforeend', getModalHTML());
    }
  }

  // Update state
  AppState.update('ui.editingSkill', skillName);

  // Open modal with loading state
  openModal(MODAL_ID);
  setModalTitle(MODAL_ID, `Editing: ${skillName}`);

  try {
    // Fetch full skill details
    const skill = await API.skills.get(skillName);

    // Render form
    setModalBody(MODAL_ID, renderEditForm(skill));

    // Initialize icons
    if (window.lucide) {
      const modal = document.getElementById(MODAL_ID);
      window.lucide.createIcons({ nodes: [modal] });
    }

    // Setup character counters
    setupCharacterCounters();

  } catch (error) {
    console.error('Failed to load skill:', error);

    setModalBody(MODAL_ID, `
      <div class="flex flex-col items-center justify-center py-8 text-center">
        <i data-lucide="alert-circle" class="w-12 h-12 text-red-500 mb-4"></i>
        <h3 class="text-lg font-medium text-white mb-2">Failed to load skill</h3>
        <p class="text-gray-400 mb-4">${escapeHtml(error.userMessage || error.message)}</p>
        <button type="button"
                class="px-4 py-2 text-sm font-medium text-white bg-purple-600 hover:bg-purple-500 rounded-lg transition-colors"
                data-action="retry-edit-skill"
                data-skill="${escapeHtml(skillName)}">
          Try Again
        </button>
      </div>
    `);
  }
}

/**
 * Setup character counter event listeners
 */
function setupCharacterCounters() {
  const descInput = document.getElementById('edit-description');
  const descCount = document.getElementById('desc-char-count');
  const contentInput = document.getElementById('edit-content');
  const contentCount = document.getElementById('content-char-count');

  if (descInput && descCount) {
    descInput.addEventListener('input', () => {
      descCount.textContent = descInput.value.length;
    });
  }

  if (contentInput && contentCount) {
    contentInput.addEventListener('input', () => {
      contentCount.textContent = contentInput.value.length;
    });
  }
}

/**
 * Save the current skill
 */
export async function saveSkill() {
  const skillName = AppState.getState().ui.editingSkill;
  if (!skillName) return;

  const formData = validateForm();
  if (!formData) return;

  const saveBtn = document.getElementById('save-skill-btn');
  if (saveBtn) {
    saveBtn.disabled = true;
  }

  const loading = showLoadingToast('Saving changes...');

  try {
    await API.skills.update(skillName, formData);

    // Update local state
    AppState.updateSkill(skillName, {
      description: formData.description,
      tags: formData.tags,
      content: formData.content,
    });

    loading.success('Skill updated successfully');
    closeEditModal();

  } catch (error) {
    console.error('Failed to save skill:', error);
    loading.error(error.userMessage || 'Failed to save skill');

    if (saveBtn) {
      saveBtn.disabled = false;
    }
  }
}

/**
 * Close the edit modal
 */
export function closeEditModal() {
  closeModal(MODAL_ID);
  AppState.update('ui.editingSkill', null);
}

/**
 * Initialize edit modal event handlers
 */
export function initEditModalHandlers() {
  document.addEventListener('click', (event) => {
    const action = event.target.closest('[data-action]')?.dataset.action;

    if (action === 'save-skill') {
      saveSkill();
    }

    if (action === 'retry-edit-skill') {
      const skillName = event.target.closest('[data-skill]')?.dataset.skill;
      if (skillName) {
        openEditModal(skillName);
      }
    }

    if (action === 'edit-from-view') {
      const skillName = AppState.getState().ui.viewingSkill;
      if (skillName) {
        // Close view modal and open edit modal
        const viewModal = document.getElementById('view-skill-modal');
        if (viewModal) {
          viewModal.classList.add('hidden');
        }
        openEditModal(skillName);
      }
    }
  });

  // Handle form submission via Enter in inputs
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      const target = event.target;
      if (target.matches('#edit-skill-form input')) {
        event.preventDefault();
        saveSkill();
      }
    }
  });
}
