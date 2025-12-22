/**
 * Claude Console Modal Component
 * Interactive console for running Claude CLI commands
 */

import { createModalWithFooter, openModal, closeModal } from '../components/modal.js';
import { escapeHtml } from '../utils/escapeHtml.js';
import { AppState } from '../state.js';
import { API } from '../api.js';
import { toast } from '../components/toast.js';

const MODAL_ID = 'claude-console-modal';

// Console history
let commandHistory = [];
let historyIndex = -1;
let isRunning = false;

/**
 * Get the modal HTML structure
 * @returns {string}
 */
function getModalHTML() {
  const claudeAvailable = AppState.getState().claudeAvailable;

  if (!claudeAvailable) {
    return createModalWithFooter(
      {
        id: MODAL_ID,
        title: 'Claude Console',
        size: 'xl',
      },
      `<div class="flex flex-col items-center justify-center py-12 text-center">
        <i data-lucide="terminal" class="w-16 h-16 text-gray-600 mb-4"></i>
        <h3 class="text-lg font-medium text-white mb-2">Claude CLI Not Available</h3>
        <p class="text-gray-400 mb-6 max-w-md">
          The Claude Code CLI is not installed or not accessible from this system.
          The console requires the CLI to be available at a recognized path.
        </p>
        <a href="https://claude.ai/claude-code"
           target="_blank"
           rel="noopener noreferrer"
           class="flex items-center gap-2 px-4 py-2 text-sm font-medium text-purple-400 hover:text-purple-300 transition-colors">
          <i data-lucide="external-link" class="w-4 h-4"></i>
          Learn how to install Claude Code CLI
        </a>
      </div>`,
      `<button type="button"
               class="px-4 py-2 text-sm font-medium text-white bg-gray-700 hover:bg-gray-600 rounded-lg transition-colors"
               data-modal-close="${MODAL_ID}">
        Close
      </button>`
    );
  }

  return createModalWithFooter(
    {
      id: MODAL_ID,
      title: 'Claude Console',
      size: '4xl',
    },
    renderConsoleBody(),
    renderConsoleFooter()
  );
}

/**
 * Render console body
 * @returns {string}
 */
function renderConsoleBody() {
  return `
    <div class="console-container flex flex-col h-[60vh]">
      <!-- Skill context selector -->
      <div class="console-context flex items-center gap-3 mb-4 p-3 bg-gray-900 rounded-lg">
        <label for="console-skill-context" class="text-sm font-medium text-gray-400 flex-shrink-0">
          Skill Context:
        </label>
        <select id="console-skill-context"
                class="flex-grow px-3 py-1.5 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:border-purple-500 focus:outline-none">
          <option value="">None (general prompt)</option>
          ${renderSkillOptions()}
        </select>
        <button type="button"
                class="p-1.5 text-gray-400 hover:text-white transition-colors"
                data-action="refresh-skills"
                title="Refresh skills list">
          <i data-lucide="refresh-cw" class="w-4 h-4"></i>
        </button>
      </div>

      <!-- Output area -->
      <div id="console-output"
           class="flex-grow bg-gray-900 rounded-lg p-4 overflow-y-auto font-mono text-sm space-y-2"
           role="log"
           aria-label="Console output"
           aria-live="polite">
        <div class="text-gray-500">
          Welcome to Claude Console. Enter a prompt below to interact with Claude.
        </div>
        <div class="text-gray-600 text-xs">
          Tip: Use ↑/↓ arrows to navigate command history
        </div>
      </div>

      <!-- Input area -->
      <div class="console-input mt-4">
        <div class="flex gap-2">
          <div class="flex-grow relative">
            <textarea id="console-prompt"
                      rows="3"
                      class="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:border-purple-500 focus:ring-1 focus:ring-purple-500 focus:outline-none transition-colors resize-none font-mono text-sm"
                      placeholder="Enter your prompt here... (Ctrl+Enter to send)"
                      aria-label="Console prompt input"></textarea>
          </div>
          <button type="button"
                  id="console-send-btn"
                  class="px-4 py-2 h-fit text-sm font-medium text-white bg-purple-600 hover:bg-purple-500 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed self-end"
                  data-action="send-console-prompt"
                  aria-label="Send prompt">
            <i data-lucide="send" class="w-4 h-4"></i>
          </button>
        </div>
      </div>
    </div>
  `;
}

/**
 * Render skill options for context selector
 * @returns {string}
 */
function renderSkillOptions() {
  const skills = AppState.getState().skills;
  return skills.map(skill => `
    <option value="${escapeHtml(skill.name)}">${escapeHtml(skill.name)}</option>
  `).join('');
}

/**
 * Render console footer
 * @returns {string}
 */
function renderConsoleFooter() {
  return `
    <div class="flex items-center justify-between w-full">
      <div class="flex items-center gap-4">
        <button type="button"
                class="flex items-center gap-2 px-3 py-1.5 text-sm text-gray-400 hover:text-white transition-colors"
                data-action="clear-console"
                title="Clear console output">
          <i data-lucide="trash-2" class="w-4 h-4"></i>
          Clear
        </button>
        <span id="console-status" class="text-xs text-gray-500">
          Ready
        </span>
      </div>
      <button type="button"
              class="px-4 py-2 text-sm font-medium text-gray-300 hover:text-white transition-colors"
              data-modal-close="${MODAL_ID}">
        Close
      </button>
    </div>
  `;
}

/**
 * Append output to console
 * @param {string} content - Content to append
 * @param {string} type - Output type: 'input', 'output', 'error', 'system'
 */
function appendOutput(content, type = 'output') {
  const output = document.getElementById('console-output');
  if (!output) return;

  const typeClasses = {
    input: 'text-purple-400',
    output: 'text-gray-300',
    error: 'text-red-400',
    system: 'text-gray-500 italic',
  };

  const prefixes = {
    input: '> ',
    output: '',
    error: 'ERROR: ',
    system: '# ',
  };

  const div = document.createElement('div');
  div.className = `console-line ${typeClasses[type] || typeClasses.output} whitespace-pre-wrap`;
  div.textContent = prefixes[type] + content;
  output.appendChild(div);

  // Scroll to bottom
  output.scrollTop = output.scrollHeight;
}

/**
 * Clear console output
 */
function clearConsole() {
  const output = document.getElementById('console-output');
  if (output) {
    output.innerHTML = `
      <div class="text-gray-500">Console cleared.</div>
    `;
  }
}

/**
 * Send prompt to Claude
 */
async function sendPrompt() {
  if (isRunning) return;

  const promptInput = document.getElementById('console-prompt');
  const contextSelect = document.getElementById('console-skill-context');
  const sendBtn = document.getElementById('console-send-btn');
  const statusEl = document.getElementById('console-status');

  const prompt = promptInput.value.trim();
  if (!prompt) return;

  const skillContext = contextSelect?.value || '';

  // Add to history
  commandHistory.push(prompt);
  historyIndex = commandHistory.length;

  // Clear input
  promptInput.value = '';

  // Show input in console
  appendOutput(prompt, 'input');

  // Update UI state
  isRunning = true;
  sendBtn.disabled = true;
  statusEl.textContent = 'Running...';
  statusEl.classList.add('text-yellow-500');
  statusEl.classList.remove('text-gray-500');

  try {
    // Get skill content if context selected
    let contextContent = '';
    if (skillContext) {
      const skill = await API.skills.get(skillContext);
      contextContent = skill.content || '';
      appendOutput(`Using skill context: ${skillContext}`, 'system');
    }

    // Send to Claude
    const result = await API.claude.run(prompt, contextContent);

    if (result.stdout) {
      appendOutput(result.stdout, 'output');
    }

    if (result.stderr && result.returncode !== 0) {
      appendOutput(result.stderr, 'error');
    }

    if (result.returncode !== 0) {
      appendOutput(`Process exited with code ${result.returncode}`, 'system');
    }

  } catch (error) {
    console.error('Claude command failed:', error);
    appendOutput(error.userMessage || error.message, 'error');
  } finally {
    isRunning = false;
    sendBtn.disabled = false;
    statusEl.textContent = 'Ready';
    statusEl.classList.remove('text-yellow-500');
    statusEl.classList.add('text-gray-500');
  }
}

/**
 * Handle keyboard navigation in prompt input
 * @param {KeyboardEvent} event
 */
function handlePromptKeydown(event) {
  const promptInput = document.getElementById('console-prompt');
  if (!promptInput) return;

  // Ctrl+Enter to send
  if (event.key === 'Enter' && event.ctrlKey) {
    event.preventDefault();
    sendPrompt();
    return;
  }

  // Arrow up for history
  if (event.key === 'ArrowUp' && promptInput.selectionStart === 0) {
    event.preventDefault();
    if (historyIndex > 0) {
      historyIndex--;
      promptInput.value = commandHistory[historyIndex];
    }
    return;
  }

  // Arrow down for history
  if (event.key === 'ArrowDown') {
    event.preventDefault();
    if (historyIndex < commandHistory.length - 1) {
      historyIndex++;
      promptInput.value = commandHistory[historyIndex];
    } else if (historyIndex === commandHistory.length - 1) {
      historyIndex = commandHistory.length;
      promptInput.value = '';
    }
  }
}

/**
 * Open the Claude console modal
 */
export function openClaudeConsole() {
  // Ensure modal exists in DOM
  if (!document.getElementById(MODAL_ID)) {
    const container = document.getElementById('modals-container');
    if (container) {
      container.insertAdjacentHTML('beforeend', getModalHTML());
    }
  }

  openModal(MODAL_ID);

  // Focus prompt input
  setTimeout(() => {
    document.getElementById('console-prompt')?.focus();
  }, 100);
}

/**
 * Close the Claude console modal
 */
export function closeClaudeConsole() {
  closeModal(MODAL_ID);
}

/**
 * Refresh skill options in context selector
 */
async function refreshSkillOptions() {
  const select = document.getElementById('console-skill-context');
  if (!select) return;

  try {
    const result = await API.skills.list();
    AppState.setSkills(result.skills);

    const currentValue = select.value;
    select.innerHTML = `
      <option value="">None (general prompt)</option>
      ${renderSkillOptions()}
    `;
    select.value = currentValue;

    toast.success('Skills refreshed');
  } catch (error) {
    console.error('Failed to refresh skills:', error);
    toast.error('Failed to refresh skills');
  }
}

/**
 * Initialize Claude console event handlers
 */
export function initClaudeConsoleHandlers() {
  document.addEventListener('click', (event) => {
    const target = event.target.closest('[data-action]');
    if (!target) return;

    const action = target.dataset.action;

    switch (action) {
      case 'open-claude-console':
        openClaudeConsole();
        break;

      case 'send-console-prompt':
        sendPrompt();
        break;

      case 'clear-console':
        clearConsole();
        break;

      case 'refresh-skills':
        refreshSkillOptions();
        break;
    }
  });

  // Keyboard handlers for prompt input
  document.addEventListener('keydown', (event) => {
    if (event.target.id === 'console-prompt') {
      handlePromptKeydown(event);
    }
  });
}
