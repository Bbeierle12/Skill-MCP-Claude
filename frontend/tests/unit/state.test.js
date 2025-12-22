/**
 * Tests for state management
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// We need to re-import the module for each test to get a fresh state
let AppState, inferCategory, getCategoryInfo, CATEGORIES;

beforeEach(async () => {
  // Clear module cache and re-import
  vi.resetModules();
  const module = await import('../../js/state.js');
  AppState = module.AppState;
  inferCategory = module.inferCategory;
  getCategoryInfo = module.getCategoryInfo;
  CATEGORIES = module.CATEGORIES;

  // Reset state
  AppState.reset();
});

describe('AppState', () => {
  describe('getState', () => {
    it('returns the current state', () => {
      const state = AppState.getState();
      expect(state).toHaveProperty('skills');
      expect(state).toHaveProperty('isOnline');
      expect(state).toHaveProperty('ui');
      expect(state).toHaveProperty('filters');
    });
  });

  describe('update', () => {
    it('updates a simple path', () => {
      AppState.update('isOnline', true);
      expect(AppState.getState().isOnline).toBe(true);
    });

    it('updates a nested path', () => {
      AppState.update('ui.isLoading', true);
      expect(AppState.getState().ui.isLoading).toBe(true);
    });

    it('updates deeply nested paths', () => {
      AppState.update('filters.search', 'test');
      expect(AppState.getState().filters.search).toBe('test');
    });

    it('notifies subscribers', () => {
      const subscriber = vi.fn();
      AppState.subscribe(subscriber);

      AppState.update('isOnline', true);

      expect(subscriber).toHaveBeenCalledWith('isOnline', true, expect.any(Object));
    });
  });

  describe('batchUpdate', () => {
    it('updates multiple paths at once', () => {
      AppState.batchUpdate({
        'isOnline': true,
        'filters.search': 'test',
        'ui.isLoading': false,
      });

      const state = AppState.getState();
      expect(state.isOnline).toBe(true);
      expect(state.filters.search).toBe('test');
      expect(state.ui.isLoading).toBe(false);
    });

    it('notifies subscribers once for batch', () => {
      const subscriber = vi.fn();
      AppState.subscribe(subscriber);

      AppState.batchUpdate({
        'isOnline': true,
        'filters.search': 'test',
      });

      expect(subscriber).toHaveBeenCalledTimes(1);
      expect(subscriber).toHaveBeenCalledWith('batch', expect.any(Object), expect.any(Object));
    });
  });

  describe('skills management', () => {
    const testSkill = {
      name: 'test-skill',
      description: 'A test skill',
      content: '# Test',
      tags: ['test'],
    };

    it('setSkills replaces all skills', () => {
      AppState.setSkills([testSkill]);
      expect(AppState.getState().skills).toHaveLength(1);
      expect(AppState.getState().skills[0].name).toBe('test-skill');
    });

    it('addSkill appends a skill', () => {
      AppState.setSkills([testSkill]);
      AppState.addSkill({ name: 'skill-2', description: 'Second' });

      expect(AppState.getState().skills).toHaveLength(2);
    });

    it('updateSkill modifies existing skill', () => {
      AppState.setSkills([testSkill]);
      AppState.updateSkill('test-skill', { description: 'Updated' });

      const skill = AppState.getSkill('test-skill');
      expect(skill.description).toBe('Updated');
      expect(skill.name).toBe('test-skill'); // Original fields preserved
    });

    it('removeSkill removes a skill', () => {
      AppState.setSkills([testSkill, { name: 'skill-2' }]);
      AppState.removeSkill('test-skill');

      expect(AppState.getState().skills).toHaveLength(1);
      expect(AppState.getSkill('test-skill')).toBeUndefined();
    });

    it('getSkill returns skill by name', () => {
      AppState.setSkills([testSkill]);
      const skill = AppState.getSkill('test-skill');
      expect(skill).toEqual(testSkill);
    });

    it('getSkill returns undefined for missing skill', () => {
      expect(AppState.getSkill('nonexistent')).toBeUndefined();
    });
  });

  describe('getFilteredSkills', () => {
    const skills = [
      { name: 'react-forms', description: 'React form helpers', tags: ['react', 'forms'] },
      { name: 'vue-utils', description: 'Vue utilities', tags: ['vue'] },
      { name: 'documentation', description: 'Doc generator', tags: ['docs'] },
    ];

    beforeEach(() => {
      AppState.setSkills(skills);
    });

    it('returns all skills when no filters', () => {
      const filtered = AppState.getFilteredSkills();
      expect(filtered).toHaveLength(3);
    });

    it('filters by search term in name', () => {
      AppState.update('filters.search', 'react');
      const filtered = AppState.getFilteredSkills();
      expect(filtered).toHaveLength(1);
      expect(filtered[0].name).toBe('react-forms');
    });

    it('filters by search term in description', () => {
      AppState.update('filters.search', 'utilities');
      const filtered = AppState.getFilteredSkills();
      expect(filtered).toHaveLength(1);
      expect(filtered[0].name).toBe('vue-utils');
    });

    it('filters by search term in tags', () => {
      AppState.update('filters.search', 'docs');
      const filtered = AppState.getFilteredSkills();
      expect(filtered).toHaveLength(1);
      expect(filtered[0].name).toBe('documentation');
    });

    it('search is case-insensitive', () => {
      AppState.update('filters.search', 'REACT');
      const filtered = AppState.getFilteredSkills();
      expect(filtered).toHaveLength(1);
    });

    it('filters by category', () => {
      AppState.update('filters.category', 'documentation');
      const filtered = AppState.getFilteredSkills();
      // Only 'documentation' skill matches documentation category
      expect(filtered.some(s => s.name === 'documentation')).toBe(true);
    });

    it('combines search and category filters', () => {
      AppState.batchUpdate({
        'filters.search': 'react',
        'filters.category': 'forms',
      });
      const filtered = AppState.getFilteredSkills();
      expect(filtered).toHaveLength(1);
      expect(filtered[0].name).toBe('react-forms');
    });
  });

  describe('getCategoryCounts', () => {
    it('counts skills by category', () => {
      AppState.setSkills([
        { name: 'react-forms', tags: ['forms'] },
        { name: 'vue-forms', tags: ['forms'] },
        { name: 'docs', description: 'documentation helper' },
      ]);

      const counts = AppState.getCategoryCounts();
      expect(counts.all).toBe(3);
      expect(counts.forms).toBe(2);
    });
  });

  describe('subscribe', () => {
    it('returns unsubscribe function', () => {
      const subscriber = vi.fn();
      const unsubscribe = AppState.subscribe(subscriber);

      AppState.update('isOnline', true);
      expect(subscriber).toHaveBeenCalledTimes(1);

      unsubscribe();
      AppState.update('isOnline', false);
      expect(subscriber).toHaveBeenCalledTimes(1); // Not called again
    });

    it('handles subscriber errors gracefully', () => {
      const errorSubscriber = vi.fn(() => {
        throw new Error('Subscriber error');
      });
      const normalSubscriber = vi.fn();

      AppState.subscribe(errorSubscriber);
      AppState.subscribe(normalSubscriber);

      // Should not throw
      expect(() => AppState.update('isOnline', true)).not.toThrow();

      // Both should have been called
      expect(errorSubscriber).toHaveBeenCalled();
      expect(normalSubscriber).toHaveBeenCalled();
    });
  });
});

describe('inferCategory', () => {
  it('infers development category from keywords', () => {
    expect(inferCategory({ name: 'react-helper', description: 'React utilities' })).toBe('development');
    expect(inferCategory({ name: 'test', tags: ['programming'] })).toBe('other');
    expect(inferCategory({ name: 'api-client', description: '' })).toBe('development');
  });

  it('infers forms category', () => {
    expect(inferCategory({ name: 'form-validation', description: '' })).toBe('forms');
    expect(inferCategory({ name: 'test', description: 'input validation' })).toBe('forms');
  });

  it('infers documentation category', () => {
    expect(inferCategory({ name: 'doc-generator', description: '' })).toBe('documentation');
    expect(inferCategory({ name: 'test', tags: ['readme'] })).toBe('documentation');
  });

  it('returns other for unmatched skills', () => {
    expect(inferCategory({ name: 'random', description: 'something' })).toBe('other');
  });
});

describe('getCategoryInfo', () => {
  it('returns category info for valid keys', () => {
    const info = getCategoryInfo('development');
    expect(info).toHaveProperty('name');
    expect(info).toHaveProperty('color');
    expect(info.name).toBe('Development');
  });

  it('returns other category for invalid keys', () => {
    const info = getCategoryInfo('invalid');
    expect(info.name).toBe('Other');
  });
});
