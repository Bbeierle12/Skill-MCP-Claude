/**
 * View Modal Component
 * Displays skill details with markdown preview
 */

import { createModalWithFooter, openModal, closeModal, setModalTitle, setModalBody } from '../components/modal.js';
import { escapeHtml } from '../utils/escapeHtml.js';
import { AppState, inferCategory, getCategoryInfo } from '../state.js';
import { API } from '../api.js';
import { toast } from '../components/toast.js';

const MODAL_ID = 'view-skill-modal';

/**
 * Simple markdown to HTML converter
 * @param {string} markdown - Markdown content
 * @returns {string} HTML string
 */
function markdownToHtml(markdown) {
  if (!markdown) return '';

  let html = escapeHtml(markdown);

  // Headers
  html = html.replace(/^### (.*$)/gim, '<h3 class="text-lg font-semibold text-white mt-4 mb-2">$1</h3>');
  html = html.replace(/^## (.*$)/gim, '<h2 class="text-xl font-semibold text-white mt-6 mb-3">$1</h2>');
  html = html.replace(/^# (.*$)/gim, '<h1 class="text-2xl font-bold text-white mt-6 mb-4">$1</h1>');

  // Code blocks
  html = html.replace(/```(\w+)?\n([\s\S]*?)```/g, (match, lang, code) => {
    return `<pre class="bg-gray-900 rounded-lg p-4 my-4 overflow-x-auto"><code class="text-sm text-gray-300">${code.trim()}</code></pre>`;
  });

  // Inline code
  html = html.replace(/`([^`]+)`/g, '<code class="bg-gray-700 px-1.5 py-0.5 rounded text-purple-300 text-sm">$1</code>');

  // Bold
  html = html.replace(/\*\*(.*?)\*\*/g, '<strong class="font-semibold text-white">$1</strong>');

  // Italic
  html = html.replace(/\*(.*?)\*/g, '<em class="italic">$1</em>');

  // Links
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" class="text-purple-400 hover:text-purple-300 underline" target="_blank" rel="noopener noreferrer">$1</a>');

  // Unordered lists
  html = html.replace(/^\s*[-*]\s+(.*$)/gim, '<li class="ml-4 text-gray-300">$1</li>');
  html = html.replace(/(<li.*<\/li>)\n(<li)/g, '$1$2');
  html = html.replace(/((?:<li.*<\/li>\n?)+)/g, '<ul class="list-disc list-inside my-3 space-y-1">$1</ul>');

  // Ordered lists
  html = html.replace(/^\s*\d+\.\s+(.*$)/gim, '<li class="ml-4 text-gray-300">$1</li>');

  // Blockquotes
  html = html.replace(/^>\s+(.*$)/gim, '<blockquote class="border-l-4 border-purple-500 pl-4 my-4 text-gray-400 italic">$1</blockquote>');

  // Horizontal rules
  html = html.replace(/^---$/gim, '<hr class="border-gray-700 my-6">');

  // Paragraphs (remaining text)
  html = html.split('\n\n').map(block => {
    if (block.match(/^<[a-z]/i)) return block;
    if (block.trim() === '') return '';
    return `<p class="text-gray-300 my-3">${block}</p>`;
  }).join('\n');

  // Clean up extra newlines
  html = html.replace(/\n{3,}/g, '\n\n');

  return html;
}

/**
 * Get the modal HTML structure
 * @returns {string}
 */
function getModalHTML() {
  return createModalWithFooter(
    {
      id: MODAL_ID,
      title: 'View Skill',
      size: '4xl',
    },
    `<div class="skill-content prose prose-invert max-w-none">
      <div class="loading-placeholder flex items-center justify-center py-8">
        <div class="loading-spinner w-8 h-8 border-2 border-gray-600 border-t-purple-500 rounded-full animate-spin"></div>
      </div>
    </div>`,
    `<div class="flex items-center justify-between w-full">
      <div class="flex items-center gap-2">
        <button type="button"
                class="flex items-center gap-2 px-4 py-2 text-sm font-medium text-gray-300 hover:text-white transition-colors"
                data-action="copy-skill-content"
                aria-label="Copy skill content">
          <i data-lucide="copy" class="w-4 h-4"></i>
          Copy
        </button>
        <button type="button"
                class="flex items-center gap-2 px-4 py-2 text-sm font-medium text-gray-300 hover:text-white transition-colors"
                data-action="edit-from-view"
                aria-label="Edit this skill">
          <i data-lucide="edit-2" class="w-4 h-4"></i>
          Edit
        </button>
      </div>
      <button type="button"
              class="px-4 py-2 text-sm font-medium text-white bg-purple-600 hover:bg-purple-500 rounded-lg transition-colors"
              data-modal-close="${MODAL_ID}">
        Close
      </button>
    </div>`
  );
}

/**
 * Render skill content
 * @param {Object} skill - Skill data
 * @returns {string} HTML
 */
function renderSkillContent(skill) {
  const category = inferCategory(skill);
  const categoryInfo = getCategoryInfo(category);

  return `
    <!-- Skill Header -->
    <div class="skill-header mb-6 pb-4 border-b border-gray-700">
      <div class="flex items-start justify-between gap-4 mb-3">
        <h1 class="text-2xl font-bold text-white">${escapeHtml(skill.name)}</h1>
        <span class="px-3 py-1 text-sm font-medium rounded-full bg-${categoryInfo.color}-500/20 text-${categoryInfo.color}-300 border border-${categoryInfo.color}-500/30">
          ${escapeHtml(categoryInfo.name)}
        </span>
      </div>

      ${skill.description ? `
        <p class="text-gray-400">${escapeHtml(skill.description)}</p>
      ` : ''}

      ${skill.tags && skill.tags.length > 0 ? `
        <div class="flex flex-wrap gap-2 mt-3">
          ${skill.tags.map(tag => `
            <span class="px-2 py-1 text-xs bg-gray-700 text-gray-300 rounded">
              ${escapeHtml(tag)}
            </span>
          `).join('')}
        </div>
      ` : ''}

      <!-- Meta info -->
      <div class="flex items-center gap-4 mt-4 text-sm text-gray-500">
        ${skill.file_count ? `
          <span class="flex items-center gap-1">
            <i data-lucide="file" class="w-4 h-4"></i>
            ${skill.file_count} files
          </span>
        ` : ''}
        ${skill.has_scripts ? `
          <span class="flex items-center gap-1">
            <i data-lucide="code" class="w-4 h-4"></i>
            Has scripts
          </span>
        ` : ''}
        ${skill.has_references ? `
          <span class="flex items-center gap-1">
            <i data-lucide="book-open" class="w-4 h-4"></i>
            Has references
          </span>
        ` : ''}
      </div>
    </div>

    <!-- Skill Content -->
    <div class="skill-body">
      ${markdownToHtml(skill.content || '')}
    </div>

    <!-- Files list if available -->
    ${skill.files && skill.files.length > 0 ? `
      <div class="skill-files mt-8 pt-4 border-t border-gray-700">
        <h3 class="text-lg font-semibold text-white mb-3">Files</h3>
        <div class="grid grid-cols-2 md:grid-cols-3 gap-2">
          ${skill.files.map(file => `
            <div class="flex items-center gap-2 px-3 py-2 bg-gray-900 rounded-lg text-sm">
              <i data-lucide="file-text" class="w-4 h-4 text-gray-500"></i>
              <span class="text-gray-300 truncate">${escapeHtml(file)}</span>
            </div>
          `).join('')}
        </div>
      </div>
    ` : ''}
  `;
}

/**
 * Open the view modal for a skill
 * @param {string} skillName - Name of skill to view
 */
export async function openViewModal(skillName) {
  // Ensure modal exists in DOM
  if (!document.getElementById(MODAL_ID)) {
    const container = document.getElementById('modals-container');
    if (container) {
      container.insertAdjacentHTML('beforeend', getModalHTML());
    }
  }

  // Update state
  AppState.update('ui.viewingSkill', skillName);

  // Open modal with loading state
  openModal(MODAL_ID);
  setModalTitle(MODAL_ID, `Viewing: ${skillName}`);

  try {
    // Fetch full skill details
    const skill = await API.skills.get(skillName);

    // Render content
    setModalBody(MODAL_ID, renderSkillContent(skill));

    // Initialize icons
    if (window.lucide) {
      const modal = document.getElementById(MODAL_ID);
      window.lucide.createIcons({ nodes: [modal] });
    }

  } catch (error) {
    console.error('Failed to load skill:', error);

    setModalBody(MODAL_ID, `
      <div class="flex flex-col items-center justify-center py-8 text-center">
        <i data-lucide="alert-circle" class="w-12 h-12 text-red-500 mb-4"></i>
        <h3 class="text-lg font-medium text-white mb-2">Failed to load skill</h3>
        <p class="text-gray-400 mb-4">${escapeHtml(error.userMessage || error.message)}</p>
        <button type="button"
                class="px-4 py-2 text-sm font-medium text-white bg-purple-600 hover:bg-purple-500 rounded-lg transition-colors"
                data-action="retry-load-skill"
                data-skill="${escapeHtml(skillName)}">
          Try Again
        </button>
      </div>
    `);
  }
}

/**
 * Close the view modal
 */
export function closeViewModal() {
  closeModal(MODAL_ID);
  AppState.update('ui.viewingSkill', null);
}

/**
 * Copy current skill content to clipboard
 */
export async function copySkillContent() {
  const skillName = AppState.getState().ui.viewingSkill;
  if (!skillName) return;

  try {
    const skill = AppState.getSkill(skillName);
    if (!skill?.content) {
      const fullSkill = await API.skills.get(skillName);
      await navigator.clipboard.writeText(fullSkill.content || '');
    } else {
      await navigator.clipboard.writeText(skill.content);
    }

    toast.success('Skill content copied to clipboard');
  } catch (error) {
    console.error('Failed to copy:', error);
    toast.error('Failed to copy to clipboard');
  }
}

/**
 * Initialize view modal event handlers
 */
export function initViewModalHandlers() {
  document.addEventListener('click', (event) => {
    const action = event.target.closest('[data-action]')?.dataset.action;

    if (action === 'copy-skill-content') {
      copySkillContent();
    }

    if (action === 'retry-load-skill') {
      const skillName = event.target.closest('[data-skill]')?.dataset.skill;
      if (skillName) {
        openViewModal(skillName);
      }
    }
  });
}
