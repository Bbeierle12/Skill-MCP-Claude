/**
 * Import Modal Component
 * Create new skills or import from various sources
 */

import { createModalWithFooter, openModal, closeModal, setModalBody } from '../components/modal.js';
import { escapeHtml } from '../utils/escapeHtml.js';
import { validateSkillName, validateDescription, validateContent, sanitizeSkillName } from '../utils/validation.js';
import { AppState } from '../state.js';
import { API } from '../api.js';
import { toast, showLoadingToast } from '../components/toast.js';

const MODAL_ID = 'import-skill-modal';

// Import mode tabs
const IMPORT_MODES = {
  create: { label: 'Create New', icon: 'plus' },
  folder: { label: 'From Folder', icon: 'folder' },
  upload: { label: 'Upload Files', icon: 'upload' },
  ai: { label: 'AI Generate', icon: 'sparkles' },
};

// Current state within the modal
let currentMode = 'create';
let browseHistory = [];
let selectedFiles = [];

/**
 * Get the modal HTML structure
 * @returns {string}
 */
function getModalHTML() {
  return createModalWithFooter(
    {
      id: MODAL_ID,
      title: 'Create or Import Skill',
      size: '2xl',
    },
    renderModalContent(),
    renderModalFooter()
  );
}

/**
 * Render mode tabs
 * @returns {string}
 */
function renderModeTabs() {
  return `
    <div class="mode-tabs flex border-b border-gray-700 mb-6" role="tablist">
      ${Object.entries(IMPORT_MODES).map(([mode, config]) => {
        const isActive = mode === currentMode;
        const activeClass = isActive
          ? 'border-purple-500 text-purple-400'
          : 'border-transparent text-gray-400 hover:text-gray-300 hover:border-gray-600';

        return `
          <button type="button"
                  class="flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors ${activeClass}"
                  data-action="switch-import-mode"
                  data-mode="${mode}"
                  role="tab"
                  aria-selected="${isActive}"
                  aria-controls="import-panel-${mode}">
            <i data-lucide="${config.icon}" class="w-4 h-4"></i>
            ${config.label}
          </button>
        `;
      }).join('')}
    </div>
  `;
}

/**
 * Render create new skill form
 * @returns {string}
 */
function renderCreateForm() {
  return `
    <div id="import-panel-create" class="import-panel" role="tabpanel">
      <form id="create-skill-form" class="space-y-4">
        <div class="form-group">
          <label for="create-name" class="block text-sm font-medium text-gray-300 mb-2">
            Skill Name <span class="text-red-400">*</span>
          </label>
          <input type="text"
                 id="create-name"
                 name="name"
                 class="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:border-purple-500 focus:ring-1 focus:ring-purple-500 focus:outline-none transition-colors"
                 placeholder="my-skill-name"
                 required
                 autocomplete="off">
          <p class="mt-1 text-xs text-gray-500">Use lowercase letters, numbers, and hyphens</p>
        </div>

        <div class="form-group">
          <label for="create-description" class="block text-sm font-medium text-gray-300 mb-2">
            Description
          </label>
          <input type="text"
                 id="create-description"
                 name="description"
                 class="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:border-purple-500 focus:ring-1 focus:ring-purple-500 focus:outline-none transition-colors"
                 placeholder="Brief description of the skill">
        </div>

        <div class="form-group">
          <label for="create-content" class="block text-sm font-medium text-gray-300 mb-2">
            Initial Content (Markdown)
          </label>
          <textarea id="create-content"
                    name="content"
                    rows="8"
                    class="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:border-purple-500 focus:ring-1 focus:ring-purple-500 focus:outline-none transition-colors font-mono text-sm resize-y"
                    placeholder="# My Skill&#10;&#10;Description of what this skill does..."></textarea>
        </div>

        <div id="create-errors" class="hidden p-3 bg-red-900/20 border border-red-500/30 rounded-lg text-sm text-red-300"></div>
      </form>
    </div>
  `;
}

/**
 * Render folder browser
 * @returns {string}
 */
function renderFolderBrowser() {
  const state = AppState.getState();
  const { currentPath, directories, files } = state.browse;

  return `
    <div id="import-panel-folder" class="import-panel" role="tabpanel">
      <div class="space-y-4">
        <!-- Path input -->
        <div class="form-group">
          <label for="folder-path" class="block text-sm font-medium text-gray-300 mb-2">
            Folder Path
          </label>
          <div class="flex gap-2">
            <input type="text"
                   id="folder-path"
                   value="${escapeHtml(currentPath)}"
                   class="flex-grow px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:border-purple-500 focus:ring-1 focus:ring-purple-500 focus:outline-none transition-colors"
                   placeholder="C:\\path\\to\\skill or /path/to/skill">
            <button type="button"
                    class="px-4 py-2 text-sm font-medium text-white bg-gray-700 hover:bg-gray-600 rounded-lg transition-colors"
                    data-action="browse-path">
              Browse
            </button>
          </div>
        </div>

        <!-- Browser -->
        <div class="folder-browser bg-gray-900 rounded-lg border border-gray-700 max-h-64 overflow-y-auto">
          ${currentPath ? `
            <button type="button"
                    class="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-400 hover:bg-gray-800 transition-colors"
                    data-action="browse-parent">
              <i data-lucide="arrow-up" class="w-4 h-4"></i>
              ..
            </button>
          ` : ''}

          ${directories.length === 0 && files.length === 0 ? `
            <div class="px-3 py-8 text-center text-gray-500 text-sm">
              Enter a path and click Browse to explore
            </div>
          ` : ''}

          ${directories.map(dir => `
            <button type="button"
                    class="w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-gray-800 transition-colors ${dir.is_skill ? 'text-purple-400' : 'text-gray-300'}"
                    data-action="browse-dir"
                    data-path="${escapeHtml(dir.path)}">
              <i data-lucide="${dir.is_skill ? 'folder-open' : 'folder'}" class="w-4 h-4 ${dir.is_skill ? 'text-purple-400' : 'text-gray-500'}"></i>
              ${escapeHtml(dir.name)}
              ${dir.is_skill ? '<span class="ml-auto text-xs text-purple-400">Skill</span>' : ''}
            </button>
          `).join('')}
        </div>

        <!-- Import name -->
        <div class="form-group">
          <label for="folder-skill-name" class="block text-sm font-medium text-gray-300 mb-2">
            Import As (optional)
          </label>
          <input type="text"
                 id="folder-skill-name"
                 class="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:border-purple-500 focus:ring-1 focus:ring-purple-500 focus:outline-none transition-colors"
                 placeholder="Leave empty to use folder name">
        </div>

        <div id="folder-errors" class="hidden p-3 bg-red-900/20 border border-red-500/30 rounded-lg text-sm text-red-300"></div>
      </div>
    </div>
  `;
}

/**
 * Render file upload panel
 * @returns {string}
 */
function renderUploadPanel() {
  return `
    <div id="import-panel-upload" class="import-panel" role="tabpanel">
      <div class="space-y-4">
        <div class="form-group">
          <label for="upload-skill-name" class="block text-sm font-medium text-gray-300 mb-2">
            Skill Name <span class="text-red-400">*</span>
          </label>
          <input type="text"
                 id="upload-skill-name"
                 class="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:border-purple-500 focus:ring-1 focus:ring-purple-500 focus:outline-none transition-colors"
                 placeholder="my-skill-name"
                 required>
        </div>

        <!-- Drop zone -->
        <div id="drop-zone"
             class="border-2 border-dashed border-gray-600 rounded-lg p-8 text-center hover:border-purple-500 transition-colors cursor-pointer"
             data-action="trigger-file-input">
          <i data-lucide="upload-cloud" class="w-12 h-12 mx-auto mb-4 text-gray-500"></i>
          <p class="text-gray-300 mb-2">Drag and drop files here</p>
          <p class="text-sm text-gray-500 mb-4">or click to browse</p>
          <input type="file"
                 id="file-input"
                 multiple
                 class="hidden"
                 accept=".md,.json,.txt,.js,.ts,.py">
        </div>

        <!-- Selected files -->
        <div id="selected-files" class="${selectedFiles.length === 0 ? 'hidden' : ''}">
          <h4 class="text-sm font-medium text-gray-300 mb-2">Selected Files:</h4>
          <div class="space-y-1 max-h-32 overflow-y-auto">
            ${selectedFiles.map((file, i) => `
              <div class="flex items-center justify-between px-3 py-2 bg-gray-800 rounded-lg text-sm">
                <span class="text-gray-300 truncate">${escapeHtml(file.name)}</span>
                <button type="button"
                        class="p-1 text-gray-500 hover:text-red-400 transition-colors"
                        data-action="remove-file"
                        data-index="${i}">
                  <i data-lucide="x" class="w-4 h-4"></i>
                </button>
              </div>
            `).join('')}
          </div>
        </div>

        <div id="upload-errors" class="hidden p-3 bg-red-900/20 border border-red-500/30 rounded-lg text-sm text-red-300"></div>
      </div>
    </div>
  `;
}

/**
 * Render AI generation panel
 * @returns {string}
 */
function renderAIPanel() {
  return `
    <div id="import-panel-ai" class="import-panel" role="tabpanel">
      <div class="flex flex-col items-center justify-center py-8 text-center">
        <i data-lucide="sparkles" class="w-12 h-12 text-purple-500 mb-4"></i>
        <h3 class="text-lg font-medium text-white mb-2">AI Skill Generation</h3>
        <p class="text-gray-400 mb-4">Use Claude Code CLI directly to generate skills with AI.</p>
        <code class="text-sm text-purple-400 bg-gray-800 px-4 py-2 rounded-lg">claude "create a skill for..."</code>
      </div>
    </div>
  `;
}


/**
 * Render modal content based on current mode
 * @returns {string}
 */
function renderModalContent() {
  let panelContent = '';

  switch (currentMode) {
    case 'create':
      panelContent = renderCreateForm();
      break;
    case 'folder':
      panelContent = renderFolderBrowser();
      break;
    case 'upload':
      panelContent = renderUploadPanel();
      break;
    case 'ai':
      panelContent = renderAIPanel();
      break;
  }

  return `
    ${renderModeTabs()}
    ${panelContent}
  `;
}

/**
 * Render modal footer
 * @returns {string}
 */
function renderModalFooter() {
  const buttonLabel = currentMode === 'ai' ? 'Save Generated Skill' : 'Import';

  return `
    <div class="flex items-center justify-end gap-3 w-full">
      <button type="button"
              class="px-4 py-2 text-sm font-medium text-gray-300 hover:text-white transition-colors"
              data-modal-close="${MODAL_ID}">
        Cancel
      </button>
      <button type="button"
              id="import-btn"
              class="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-purple-600 hover:bg-purple-500 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              data-action="execute-import">
        <i data-lucide="download" class="w-4 h-4"></i>
        ${buttonLabel}
      </button>
    </div>
  `;
}

/**
 * Switch import mode
 * @param {string} mode - New mode
 */
function switchMode(mode) {
  if (!IMPORT_MODES[mode]) return;
  currentMode = mode;
  updateModalContent();
}

/**
 * Update modal content
 */
function updateModalContent() {
  setModalBody(MODAL_ID, renderModalContent());

  // Update footer
  const footer = document.querySelector(`#${MODAL_ID} .modal-footer`);
  if (footer) {
    footer.innerHTML = renderModalFooter();
  }

  // Initialize icons
  if (window.lucide) {
    const modal = document.getElementById(MODAL_ID);
    window.lucide.createIcons({ nodes: [modal] });
  }

  // Setup file input if on upload tab
  if (currentMode === 'upload') {
    setupFileInput();
  }
}

/**
 * Setup file input handlers
 */
function setupFileInput() {
  const fileInput = document.getElementById('file-input');
  const dropZone = document.getElementById('drop-zone');

  if (fileInput) {
    fileInput.addEventListener('change', (e) => {
      handleFiles(e.target.files);
    });
  }

  if (dropZone) {
    dropZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropZone.classList.add('border-purple-500', 'bg-purple-500/10');
    });

    dropZone.addEventListener('dragleave', () => {
      dropZone.classList.remove('border-purple-500', 'bg-purple-500/10');
    });

    dropZone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropZone.classList.remove('border-purple-500', 'bg-purple-500/10');
      handleFiles(e.dataTransfer.files);
    });
  }
}

/**
 * Handle selected files
 * @param {FileList} files - Selected files
 */
function handleFiles(files) {
  selectedFiles = [...selectedFiles, ...Array.from(files)];
  updateModalContent();
}

/**
 * Execute import based on current mode
 */
async function executeImport() {
  switch (currentMode) {
    case 'create':
      await createNewSkill();
      break;
    case 'folder':
      await importFromFolder();
      break;
    case 'upload':
      await uploadFiles();
      break;
    case 'ai':
      await saveGeneratedSkill();
      break;
  }
}

/**
 * Create a new skill
 */
async function createNewSkill() {
  const form = document.getElementById('create-skill-form');
  const errorsEl = document.getElementById('create-errors');

  const name = sanitizeSkillName(form.querySelector('#create-name').value);
  const description = form.querySelector('#create-description').value.trim();
  const content = form.querySelector('#create-content').value.trim();

  // Validate
  const nameResult = validateSkillName(name);
  if (!nameResult.valid) {
    errorsEl.textContent = nameResult.error;
    errorsEl.classList.remove('hidden');
    return;
  }

  errorsEl.classList.add('hidden');

  const loading = showLoadingToast('Creating skill...');

  try {
    const result = await API.skills.create({
      name,
      description,
      content: content || `# ${name}\n\nSkill description goes here.`,
    });

    // Add to local state
    AppState.addSkill({
      name,
      description,
      content,
      tags: [],
      file_count: 1,
    });

    loading.success(`Skill "${name}" created successfully`);
    closeImportModal();

  } catch (error) {
    console.error('Failed to create skill:', error);
    loading.error(error.userMessage || 'Failed to create skill');

    errorsEl.textContent = error.userMessage || error.message;
    errorsEl.classList.remove('hidden');
  }
}

/**
 * Import from folder
 */
async function importFromFolder() {
  const pathInput = document.getElementById('folder-path');
  const nameInput = document.getElementById('folder-skill-name');
  const errorsEl = document.getElementById('folder-errors');

  const path = pathInput.value.trim();
  const name = nameInput.value.trim();

  if (!path) {
    errorsEl.textContent = 'Please enter a folder path';
    errorsEl.classList.remove('hidden');
    return;
  }

  errorsEl.classList.add('hidden');

  const loading = showLoadingToast('Importing from folder...');

  try {
    const result = await API.import.folder(path, name);

    // Refresh skills list
    const skillsResponse = await API.skills.list();
    AppState.setSkills(skillsResponse.skills);

    loading.success(`Imported ${result.files_imported} files as "${result.name}"`);
    closeImportModal();

  } catch (error) {
    console.error('Failed to import folder:', error);
    loading.error(error.userMessage || 'Failed to import folder');

    errorsEl.textContent = error.userMessage || error.message;
    errorsEl.classList.remove('hidden');
  }
}

/**
 * Upload files
 */
async function uploadFiles() {
  const nameInput = document.getElementById('upload-skill-name');
  const errorsEl = document.getElementById('upload-errors');

  const name = sanitizeSkillName(nameInput.value);

  if (!name) {
    errorsEl.textContent = 'Please enter a skill name';
    errorsEl.classList.remove('hidden');
    return;
  }

  if (selectedFiles.length === 0) {
    errorsEl.textContent = 'Please select at least one file';
    errorsEl.classList.remove('hidden');
    return;
  }

  errorsEl.classList.add('hidden');

  const loading = showLoadingToast('Uploading files...');

  try {
    const formData = new FormData();
    formData.append('skill_name', name);

    for (const file of selectedFiles) {
      formData.append(file.name, file);
    }

    const result = await API.import.files(formData);

    // Refresh skills list
    const skillsResponse = await API.skills.list();
    AppState.setSkills(skillsResponse.skills);

    loading.success(`Uploaded ${result.files_imported.length} files as "${result.name}"`);
    closeImportModal();

  } catch (error) {
    console.error('Failed to upload files:', error);
    loading.error(error.userMessage || 'Failed to upload files');

    errorsEl.textContent = error.userMessage || error.message;
    errorsEl.classList.remove('hidden');
  }
}

/**
 * Generate skill with AI
 */
async function generateSkill() {
  const ideaInput = document.getElementById('ai-idea');
  const errorsEl = document.getElementById('ai-errors');
  const generateBtn = document.getElementById('generate-ai-btn');

  const idea = ideaInput.value.trim();

  if (!idea) {
    errorsEl.textContent = 'Please describe your skill idea';
    errorsEl.classList.remove('hidden');
    return;
  }

  errorsEl.classList.add('hidden');
  generateBtn.disabled = true;
  generateBtn.innerHTML = '<div class="loading-spinner w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div> Generating...';

  try {
    // AI generation removed - use Claude Code CLI directly

    // Show result
    const resultEl = document.getElementById('ai-result');
    const previewEl = document.getElementById('ai-preview');
    const nameInput = document.getElementById('ai-skill-name');

    resultEl.classList.remove('hidden');
    previewEl.innerHTML = `<pre class="text-sm text-gray-300 whitespace-pre-wrap">${escapeHtml(result.skill.content)}</pre>`;

    if (result.skill.name) {
      nameInput.value = result.skill.name;
    }

    // Store generated content
    resultEl.dataset.content = result.skill.content;

  } catch (error) {
    console.error('Failed to generate skill:', error);
    errorsEl.textContent = error.userMessage || 'Failed to generate skill';
    errorsEl.classList.remove('hidden');
  } finally {
    generateBtn.disabled = false;
    generateBtn.innerHTML = '<i data-lucide="sparkles" class="w-4 h-4"></i> Generate Skill';
    if (window.lucide) {
      window.lucide.createIcons({ nodes: [generateBtn] });
    }
  }
}

/**
 * Save generated skill
 */
async function saveGeneratedSkill() {
  const resultEl = document.getElementById('ai-result');
  const nameInput = document.getElementById('ai-skill-name');
  const errorsEl = document.getElementById('ai-errors');

  if (resultEl.classList.contains('hidden')) {
    errorsEl.textContent = 'Please generate a skill first';
    errorsEl.classList.remove('hidden');
    return;
  }

  const name = sanitizeSkillName(nameInput.value);
  const content = resultEl.dataset.content;

  if (!name) {
    errorsEl.textContent = 'Please enter a skill name';
    errorsEl.classList.remove('hidden');
    return;
  }

  errorsEl.classList.add('hidden');

  const loading = showLoadingToast('Saving generated skill...');

  try {
    await API.skills.create({
      name,
      content,
      description: 'AI-generated skill',
    });

    // Refresh skills list
    const skillsResponse = await API.skills.list();
    AppState.setSkills(skillsResponse.skills);

    loading.success(`Skill "${name}" created successfully`);
    closeImportModal();

  } catch (error) {
    console.error('Failed to save skill:', error);
    loading.error(error.userMessage || 'Failed to save skill');

    errorsEl.textContent = error.userMessage || error.message;
    errorsEl.classList.remove('hidden');
  }
}

/**
 * Browse to a path
 * @param {string} path - Path to browse
 */
async function browsePath(path) {
  try {
    const result = await API.browse.list(path);

    AppState.batchUpdate({
      'browse.currentPath': result.path || '',
      'browse.directories': result.dirs || [],
      'browse.files': result.files || [],
    });

    browseHistory.push(path);
    updateModalContent();

  } catch (error) {
    console.error('Failed to browse:', error);
    toast.error(error.userMessage || 'Failed to browse path');
  }
}

/**
 * Open the import modal
 */
export function openImportModal() {
  // Reset state
  currentMode = 'create';
  selectedFiles = [];
  browseHistory = [];

  // Ensure modal exists in DOM
  if (!document.getElementById(MODAL_ID)) {
    const container = document.getElementById('modals-container');
    if (container) {
      container.insertAdjacentHTML('beforeend', getModalHTML());
    }
  } else {
    updateModalContent();
  }

  openModal(MODAL_ID);
}

/**
 * Close the import modal
 */
export function closeImportModal() {
  closeModal(MODAL_ID);
  selectedFiles = [];
  browseHistory = [];
}

/**
 * Initialize import modal event handlers
 */
export function initImportModalHandlers() {
  document.addEventListener('click', (event) => {
    const target = event.target.closest('[data-action]');
    if (!target) return;

    const action = target.dataset.action;

    switch (action) {
      case 'switch-import-mode':
        switchMode(target.dataset.mode);
        break;

      case 'open-import-modal':
        openImportModal();
        break;

      case 'execute-import':
        executeImport();
        break;

      case 'browse-path':
        const pathInput = document.getElementById('folder-path');
        if (pathInput) {
          browsePath(pathInput.value.trim());
        }
        break;

      case 'browse-dir':
        browsePath(target.dataset.path);
        break;

      case 'browse-parent':
        const state = AppState.getState();
        const parent = state.browse.currentPath.split(/[/\\]/).slice(0, -1).join('/');
        browsePath(parent || '');
        break;

      case 'trigger-file-input':
        document.getElementById('file-input')?.click();
        break;

      case 'remove-file':
        const index = parseInt(target.dataset.index);
        selectedFiles.splice(index, 1);
        updateModalContent();
        break;

      case 'generate-skill':
        generateSkill();
        break;
    }
  });
}
