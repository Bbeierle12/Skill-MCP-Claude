/**
 * Skill Card Component
 * Renders individual skill cards with accessible controls
 */

import { escapeHtml } from '../utils/escapeHtml.js';
import { inferCategory, getCategoryInfo } from '../state.js';

/**
 * Category badge colors mapped to Tailwind classes
 */
const CATEGORY_COLORS = {
  development: 'bg-blue-500/20 text-blue-300 border-blue-500/30',
  documentation: 'bg-green-500/20 text-green-300 border-green-500/30',
  forms: 'bg-purple-500/20 text-purple-300 border-purple-500/30',
  building: 'bg-orange-500/20 text-orange-300 border-orange-500/30',
  visual: 'bg-pink-500/20 text-pink-300 border-pink-500/30',
  other: 'bg-gray-500/20 text-gray-300 border-gray-500/30',
};

/**
 * Get category badge class
 * @param {string} category - Category key
 * @returns {string} Tailwind classes
 */
function getCategoryBadgeClass(category) {
  return CATEGORY_COLORS[category] || CATEGORY_COLORS.other;
}

/**
 * Truncate text with ellipsis
 * @param {string} text - Text to truncate
 * @param {number} maxLength - Maximum length
 * @returns {string}
 */
function truncate(text, maxLength = 100) {
  if (!text) return '';
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength).trim() + '...';
}

/**
 * Render a skill card
 * @param {Object} skill - Skill data
 * @param {string} skill.name - Skill name
 * @param {string} skill.description - Skill description
 * @param {string[]} skill.tags - Skill tags
 * @param {boolean} skill.has_scripts - Has scripts directory
 * @param {boolean} skill.has_references - Has references directory
 * @param {number} skill.file_count - Number of files
 * @returns {string} HTML string
 */
export function SkillCard(skill) {
  const category = inferCategory(skill);
  const categoryInfo = getCategoryInfo(category);
  const badgeClass = getCategoryBadgeClass(category);

  const name = escapeHtml(skill.name);
  const description = escapeHtml(truncate(skill.description || 'No description provided', 120));
  const tags = (skill.tags || []).slice(0, 3);

  return `
    <article class="skill-card group relative bg-gray-800/50 border border-gray-700 rounded-xl p-4 hover:border-purple-500/50 hover:bg-gray-800 transition-all duration-200"
             data-skill="${name}"
             data-category="${category}"
             role="article"
             aria-label="Skill: ${name}">

      <!-- Header -->
      <header class="flex items-start justify-between gap-2 mb-3">
        <div class="flex-grow min-w-0">
          <h3 class="text-lg font-semibold text-white truncate" title="${name}">
            ${name}
          </h3>
          <span class="inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full border ${badgeClass}">
            ${escapeHtml(categoryInfo.name)}
          </span>
        </div>

        <!-- Quick Actions (visible on hover) -->
        <div class="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <button type="button"
                  class="p-1.5 text-gray-400 hover:text-white hover:bg-gray-700 rounded-lg transition-colors"
                  data-action="copy"
                  data-skill="${name}"
                  aria-label="Copy ${name} content to clipboard"
                  title="Copy to clipboard">
            <i data-lucide="copy" class="w-4 h-4"></i>
          </button>
        </div>
      </header>

      <!-- Description -->
      <p class="text-sm text-gray-400 mb-3 line-clamp-2">
        ${description}
      </p>

      <!-- Tags -->
      ${tags.length > 0 ? `
        <div class="flex flex-wrap gap-1 mb-3">
          ${tags.map(tag => `
            <span class="px-2 py-0.5 text-xs bg-gray-700 text-gray-300 rounded">
              ${escapeHtml(tag)}
            </span>
          `).join('')}
          ${skill.tags && skill.tags.length > 3 ? `
            <span class="px-2 py-0.5 text-xs bg-gray-700 text-gray-400 rounded">
              +${skill.tags.length - 3}
            </span>
          ` : ''}
        </div>
      ` : ''}

      <!-- Meta Info -->
      <div class="flex items-center gap-3 text-xs text-gray-500 mb-4">
        ${skill.file_count ? `
          <span class="flex items-center gap-1" title="${skill.file_count} files">
            <i data-lucide="file" class="w-3 h-3"></i>
            ${skill.file_count}
          </span>
        ` : ''}
        ${skill.has_scripts ? `
          <span class="flex items-center gap-1" title="Has scripts">
            <i data-lucide="code" class="w-3 h-3"></i>
            Scripts
          </span>
        ` : ''}
        ${skill.has_references ? `
          <span class="flex items-center gap-1" title="Has references">
            <i data-lucide="book-open" class="w-3 h-3"></i>
            Refs
          </span>
        ` : ''}
      </div>

      <!-- Actions -->
      <footer class="flex items-center gap-2 pt-3 border-t border-gray-700">
        <button type="button"
                class="flex-1 flex items-center justify-center gap-2 px-3 py-2 text-sm font-medium text-white bg-purple-600 hover:bg-purple-500 rounded-lg transition-colors"
                data-action="view"
                data-skill="${name}"
                aria-label="View ${name} details">
          <i data-lucide="eye" class="w-4 h-4"></i>
          View
        </button>
        <button type="button"
                class="flex items-center justify-center gap-2 px-3 py-2 text-sm font-medium text-gray-300 bg-gray-700 hover:bg-gray-600 rounded-lg transition-colors"
                data-action="edit"
                data-skill="${name}"
                aria-label="Edit ${name}">
          <i data-lucide="edit-2" class="w-4 h-4"></i>
        </button>
        <button type="button"
                class="flex items-center justify-center gap-2 px-3 py-2 text-sm font-medium text-red-400 hover:text-white hover:bg-red-600 rounded-lg transition-colors"
                data-action="delete"
                data-skill="${name}"
                aria-label="Delete ${name}">
          <i data-lucide="trash-2" class="w-4 h-4"></i>
        </button>
      </footer>
    </article>
  `;
}

/**
 * Render a skeleton loading card
 * @returns {string} HTML string
 */
export function SkillCardSkeleton() {
  return `
    <div class="skill-card-skeleton bg-gray-800/50 border border-gray-700 rounded-xl p-4 animate-pulse">
      <!-- Header skeleton -->
      <div class="flex items-start justify-between gap-2 mb-3">
        <div class="flex-grow">
          <div class="h-6 bg-gray-700 rounded w-3/4 mb-2"></div>
          <div class="h-4 bg-gray-700 rounded w-1/4"></div>
        </div>
      </div>

      <!-- Description skeleton -->
      <div class="space-y-2 mb-3">
        <div class="h-4 bg-gray-700 rounded w-full"></div>
        <div class="h-4 bg-gray-700 rounded w-2/3"></div>
      </div>

      <!-- Tags skeleton -->
      <div class="flex gap-1 mb-3">
        <div class="h-5 bg-gray-700 rounded w-16"></div>
        <div class="h-5 bg-gray-700 rounded w-12"></div>
      </div>

      <!-- Actions skeleton -->
      <div class="flex items-center gap-2 pt-3 border-t border-gray-700">
        <div class="flex-1 h-9 bg-gray-700 rounded"></div>
        <div class="h-9 w-9 bg-gray-700 rounded"></div>
        <div class="h-9 w-9 bg-gray-700 rounded"></div>
      </div>
    </div>
  `;
}

/**
 * Render an empty state card
 * @param {string} message - Message to display
 * @param {string} actionLabel - Action button label
 * @param {string} actionId - Action button data attribute
 * @returns {string} HTML string
 */
export function EmptyStateCard(message, actionLabel, actionId) {
  return `
    <div class="col-span-full flex flex-col items-center justify-center py-16 px-4 text-center">
      <div class="w-16 h-16 mb-4 rounded-full bg-gray-800 flex items-center justify-center">
        <i data-lucide="inbox" class="w-8 h-8 text-gray-500"></i>
      </div>
      <h3 class="text-lg font-medium text-gray-300 mb-2">No Skills Found</h3>
      <p class="text-sm text-gray-500 mb-6 max-w-md">
        ${escapeHtml(message)}
      </p>
      ${actionLabel ? `
        <button type="button"
                class="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-purple-600 hover:bg-purple-500 rounded-lg transition-colors"
                data-action="${actionId}">
          <i data-lucide="plus" class="w-4 h-4"></i>
          ${escapeHtml(actionLabel)}
        </button>
      ` : ''}
    </div>
  `;
}

/**
 * Render a compact skill list item (for lists/selects)
 * @param {Object} skill - Skill data
 * @returns {string} HTML string
 */
export function SkillListItem(skill) {
  const category = inferCategory(skill);
  const badgeClass = getCategoryBadgeClass(category);
  const name = escapeHtml(skill.name);

  return `
    <div class="skill-list-item flex items-center gap-3 px-3 py-2 hover:bg-gray-700 rounded-lg cursor-pointer transition-colors"
         data-skill="${name}"
         data-action="select-skill"
         role="option"
         aria-selected="false">
      <span class="w-2 h-2 rounded-full ${badgeClass.split(' ')[0]}"></span>
      <span class="flex-grow text-sm text-white truncate">${name}</span>
      <span class="text-xs text-gray-500">${escapeHtml(truncate(skill.description, 30))}</span>
    </div>
  `;
}
