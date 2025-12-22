/**
 * Skill Grid Component
 * Renders the main skill grid with filtering and empty states
 */

import { AppState, CATEGORIES, getCategoryInfo } from '../state.js';
import { SkillCard, SkillCardSkeleton, EmptyStateCard } from './skillCard.js';
import { escapeHtml } from '../utils/escapeHtml.js';

/**
 * Render category filter buttons
 * @returns {string} HTML string
 */
export function CategoryFilters() {
  const state = AppState.getState();
  const counts = AppState.getCategoryCounts();
  const activeCategory = state.filters.category;

  const categories = [
    { key: 'all', name: 'All', count: counts.all },
    ...Object.entries(CATEGORIES).map(([key, info]) => ({
      key,
      name: info.name,
      count: counts[key] || 0,
    })),
  ];

  return `
    <div class="category-filters flex flex-wrap gap-2" role="tablist" aria-label="Filter by category">
      ${categories.map(cat => {
        const isActive = activeCategory === cat.key;
        const activeClass = isActive
          ? 'bg-purple-600 text-white border-purple-500'
          : 'bg-gray-800 text-gray-400 border-gray-700 hover:border-gray-600 hover:text-gray-300';

        return `
          <button type="button"
                  class="category-filter flex items-center gap-2 px-3 py-1.5 text-sm font-medium rounded-full border transition-colors ${activeClass}"
                  data-action="filter-category"
                  data-category="${cat.key}"
                  role="tab"
                  aria-selected="${isActive}"
                  aria-controls="skills-grid">
            ${escapeHtml(cat.name)}
            <span class="text-xs opacity-70">(${cat.count})</span>
          </button>
        `;
      }).join('')}
    </div>
  `;
}

/**
 * Render the search bar
 * @returns {string} HTML string
 */
export function SearchBar() {
  const state = AppState.getState();

  return `
    <div class="search-bar relative">
      <i data-lucide="search" class="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-500 pointer-events-none"></i>
      <input type="search"
             id="skill-search"
             class="w-full pl-10 pr-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:border-purple-500 focus:ring-1 focus:ring-purple-500 focus:outline-none transition-colors"
             placeholder="Search skills..."
             value="${escapeHtml(state.filters.search)}"
             aria-label="Search skills">
      ${state.filters.search ? `
        <button type="button"
                class="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-gray-500 hover:text-white transition-colors"
                data-action="clear-search"
                aria-label="Clear search">
          <i data-lucide="x" class="w-4 h-4"></i>
        </button>
      ` : ''}
    </div>
  `;
}

/**
 * Render stats bar
 * @returns {string} HTML string
 */
export function StatsBar() {
  const state = AppState.getState();
  const filteredSkills = AppState.getFilteredSkills();
  const totalSkills = state.skills.length;

  const showingText = filteredSkills.length === totalSkills
    ? `Showing all ${totalSkills} skills`
    : `Showing ${filteredSkills.length} of ${totalSkills} skills`;

  return `
    <div class="stats-bar flex items-center justify-between text-sm text-gray-500">
      <span>${showingText}</span>
      ${state.filters.search || state.filters.category !== 'all' ? `
        <button type="button"
                class="flex items-center gap-1 text-purple-400 hover:text-purple-300 transition-colors"
                data-action="clear-filters">
          <i data-lucide="x" class="w-4 h-4"></i>
          Clear filters
        </button>
      ` : ''}
    </div>
  `;
}

/**
 * Render loading skeletons
 * @param {number} count - Number of skeletons
 * @returns {string} HTML string
 */
export function LoadingGrid(count = 6) {
  return Array(count).fill(null).map(() => SkillCardSkeleton()).join('');
}

/**
 * Render the skill grid
 * @returns {string} HTML string
 */
export function SkillGrid() {
  const state = AppState.getState();

  // Loading state
  if (state.ui.isLoading) {
    return `
      <div id="skills-grid"
           class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4"
           role="region"
           aria-label="Skills grid"
           aria-busy="true">
        ${LoadingGrid(6)}
      </div>
    `;
  }

  const filteredSkills = AppState.getFilteredSkills();

  // Empty state - no skills at all
  if (state.skills.length === 0) {
    return `
      <div id="skills-grid"
           class="grid grid-cols-1"
           role="region"
           aria-label="Skills grid">
        ${EmptyStateCard(
          'Get started by creating your first skill or importing an existing one.',
          'Create Skill',
          'open-import-modal'
        )}
      </div>
    `;
  }

  // Empty state - no results from filter
  if (filteredSkills.length === 0) {
    const message = state.filters.search
      ? `No skills match "${state.filters.search}"`
      : `No skills in the ${getCategoryInfo(state.filters.category).name} category`;

    return `
      <div id="skills-grid"
           class="grid grid-cols-1"
           role="region"
           aria-label="Skills grid">
        ${EmptyStateCard(message, 'Clear Filters', 'clear-filters')}
      </div>
    `;
  }

  // Render skill cards
  return `
    <div id="skills-grid"
         class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4"
         role="region"
         aria-label="Skills grid">
      ${filteredSkills.map(skill => SkillCard(skill)).join('')}
    </div>
  `;
}

/**
 * Render the complete skills section (filters + grid)
 * @returns {string} HTML string
 */
export function SkillsSection() {
  return `
    <section class="skills-section space-y-4">
      <!-- Header with search and filters -->
      <div class="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
        <div class="w-full sm:w-72">
          ${SearchBar()}
        </div>
        <div class="flex-grow overflow-x-auto">
          ${CategoryFilters()}
        </div>
      </div>

      <!-- Stats -->
      ${StatsBar()}

      <!-- Grid -->
      ${SkillGrid()}
    </section>
  `;
}

/**
 * Update just the grid portion (for efficient re-renders)
 */
export function updateGrid() {
  const container = document.getElementById('skills-grid');
  if (!container) return;

  const state = AppState.getState();
  const filteredSkills = AppState.getFilteredSkills();

  // Update aria-busy
  container.setAttribute('aria-busy', state.ui.isLoading ? 'true' : 'false');

  // Handle empty states
  if (state.ui.isLoading) {
    container.innerHTML = LoadingGrid(6);
  } else if (state.skills.length === 0) {
    container.innerHTML = EmptyStateCard(
      'Get started by creating your first skill or importing an existing one.',
      'Create Skill',
      'open-import-modal'
    );
  } else if (filteredSkills.length === 0) {
    const message = state.filters.search
      ? `No skills match "${state.filters.search}"`
      : `No skills in the ${getCategoryInfo(state.filters.category).name} category`;
    container.innerHTML = EmptyStateCard(message, 'Clear Filters', 'clear-filters');
  } else {
    container.innerHTML = filteredSkills.map(skill => SkillCard(skill)).join('');
  }

  // Initialize icons
  if (window.lucide) {
    window.lucide.createIcons({ nodes: [container] });
  }
}

/**
 * Update category filters (active state and counts)
 */
export function updateFilters() {
  const container = document.querySelector('.category-filters');
  if (!container) return;

  container.innerHTML = CategoryFilters().match(/<button[\s\S]*?<\/button>/g)?.join('') || '';

  // Initialize icons
  if (window.lucide) {
    window.lucide.createIcons({ nodes: [container] });
  }
}

/**
 * Update stats bar
 */
export function updateStats() {
  const container = document.querySelector('.stats-bar');
  if (!container) return;

  const temp = document.createElement('div');
  temp.innerHTML = StatsBar();
  container.innerHTML = temp.firstElementChild?.innerHTML || '';

  // Initialize icons
  if (window.lucide) {
    window.lucide.createIcons({ nodes: [container] });
  }
}
