/**
 * Tests for validation utilities
 */

import { describe, it, expect } from 'vitest';
import {
  validateSkillName,
  validateDescription,
  validateContent,
  validatePath,
  validateTags,
  validateSkill,
  sanitizeSkillName,
} from '../../js/utils/validation.js';

describe('validateSkillName', () => {
  it('rejects empty names', () => {
    expect(validateSkillName('')).toEqual({ valid: false, error: 'Name is required' });
    expect(validateSkillName('   ')).toEqual({ valid: false, error: 'Name is required' });
    expect(validateSkillName(null)).toEqual({ valid: false, error: 'Name is required' });
    expect(validateSkillName(undefined)).toEqual({ valid: false, error: 'Name is required' });
  });

  it('rejects names that are too short', () => {
    expect(validateSkillName('a')).toEqual({ valid: false, error: 'Name must be at least 2 characters' });
  });

  it('rejects names that are too long', () => {
    const longName = 'a'.repeat(51);
    expect(validateSkillName(longName)).toEqual({ valid: false, error: 'Name must be 50 characters or less' });
  });

  it('rejects names starting with invalid characters', () => {
    expect(validateSkillName('-test')).toEqual({
      valid: false,
      error: 'Name must start with a letter or number and contain only letters, numbers, hyphens, and underscores'
    });
    expect(validateSkillName('_test')).toEqual({
      valid: false,
      error: 'Name must start with a letter or number and contain only letters, numbers, hyphens, and underscores'
    });
  });

  it('rejects names with invalid characters', () => {
    expect(validateSkillName('my skill')).toEqual({
      valid: false,
      error: 'Name must start with a letter or number and contain only letters, numbers, hyphens, and underscores'
    });
    expect(validateSkillName('my@skill')).toEqual({
      valid: false,
      error: 'Name must start with a letter or number and contain only letters, numbers, hyphens, and underscores'
    });
  });

  it('rejects reserved names', () => {
    expect(validateSkillName('new')).toEqual({ valid: false, error: '"new" is a reserved name' });
    expect(validateSkillName('API')).toEqual({ valid: false, error: '"API" is a reserved name' });
    expect(validateSkillName('Delete')).toEqual({ valid: false, error: '"Delete" is a reserved name' });
  });

  it('accepts valid names', () => {
    expect(validateSkillName('my-skill')).toEqual({ valid: true, error: null });
    expect(validateSkillName('skill123')).toEqual({ valid: true, error: null });
    expect(validateSkillName('React-Forms')).toEqual({ valid: true, error: null });
    expect(validateSkillName('my_skill_v2')).toEqual({ valid: true, error: null });
  });
});

describe('validateDescription', () => {
  it('accepts empty descriptions (optional)', () => {
    expect(validateDescription('')).toEqual({ valid: true, error: null });
    expect(validateDescription(null)).toEqual({ valid: true, error: null });
    expect(validateDescription(undefined)).toEqual({ valid: true, error: null });
  });

  it('rejects descriptions that are too long', () => {
    const longDesc = 'a'.repeat(501);
    expect(validateDescription(longDesc)).toEqual({
      valid: false,
      error: 'Description must be 500 characters or less'
    });
  });

  it('accepts valid descriptions', () => {
    expect(validateDescription('A helpful skill')).toEqual({ valid: true, error: null });
    expect(validateDescription('a'.repeat(500))).toEqual({ valid: true, error: null });
  });
});

describe('validateContent', () => {
  it('rejects empty content', () => {
    expect(validateContent('')).toEqual({ valid: false, error: 'Content is required' });
    expect(validateContent('   ')).toEqual({ valid: false, error: 'Content cannot be empty' });
    expect(validateContent(null)).toEqual({ valid: false, error: 'Content is required' });
  });

  it('rejects content that is too long', () => {
    const longContent = 'a'.repeat(100001);
    expect(validateContent(longContent)).toEqual({
      valid: false,
      error: 'Content exceeds maximum length (100KB)'
    });
  });

  it('accepts valid content', () => {
    expect(validateContent('# My Skill')).toEqual({ valid: true, error: null });
  });
});

describe('validatePath', () => {
  it('rejects empty paths', () => {
    expect(validatePath('')).toEqual({ valid: false, error: 'Path is required' });
    expect(validatePath(null)).toEqual({ valid: false, error: 'Path is required' });
  });

  it('rejects path traversal attempts', () => {
    expect(validatePath('../secret')).toEqual({ valid: false, error: 'Path cannot contain ".."' });
    expect(validatePath('C:\\folder\\..\\secret')).toEqual({ valid: false, error: 'Path cannot contain ".."' });
  });

  it('rejects relative paths', () => {
    expect(validatePath('folder/file')).toEqual({ valid: false, error: 'Path must be an absolute path' });
  });

  it('accepts valid Windows paths', () => {
    expect(validatePath('C:\\Users\\test')).toEqual({ valid: true, error: null });
    expect(validatePath('D:/folder/subfolder')).toEqual({ valid: true, error: null });
  });

  it('accepts valid Unix paths', () => {
    expect(validatePath('/home/user/skills')).toEqual({ valid: true, error: null });
    expect(validatePath('~/skills')).toEqual({ valid: true, error: null });
  });
});

describe('validateTags', () => {
  it('accepts empty or missing tags (optional)', () => {
    expect(validateTags(null)).toEqual({ valid: true, error: null });
    expect(validateTags(undefined)).toEqual({ valid: true, error: null });
    expect(validateTags([])).toEqual({ valid: true, error: null });
  });

  it('rejects non-array tags', () => {
    expect(validateTags('tag')).toEqual({ valid: false, error: 'Tags must be an array' });
    expect(validateTags({ tag: true })).toEqual({ valid: false, error: 'Tags must be an array' });
  });

  it('rejects too many tags', () => {
    const manyTags = Array(11).fill('tag');
    expect(validateTags(manyTags)).toEqual({ valid: false, error: 'Maximum 10 tags allowed' });
  });

  it('rejects tags that are too long', () => {
    expect(validateTags(['a'.repeat(31)])).toEqual({
      valid: false,
      error: 'Each tag must be 30 characters or less'
    });
  });

  it('rejects tags with invalid characters', () => {
    expect(validateTags(['my tag'])).toEqual({
      valid: false,
      error: 'Tags can only contain letters, numbers, hyphens, and underscores'
    });
  });

  it('accepts valid tags', () => {
    expect(validateTags(['react', 'forms', 'validation'])).toEqual({ valid: true, error: null });
    expect(validateTags(['React-19', 'TypeScript_5'])).toEqual({ valid: true, error: null });
  });
});

describe('validateSkill', () => {
  it('rejects invalid skill objects', () => {
    expect(validateSkill(null)).toEqual({ valid: false, error: 'Invalid skill data' });
    expect(validateSkill('not an object')).toEqual({ valid: false, error: 'Invalid skill data' });
  });

  it('validates all fields', () => {
    const invalidSkill = {
      name: 'a', // Too short
      description: 'Valid description',
      content: '# Content',
      tags: ['valid'],
    };
    expect(validateSkill(invalidSkill).valid).toBe(false);
  });

  it('accepts valid skills', () => {
    const validSkill = {
      name: 'my-skill',
      description: 'A helpful skill',
      content: '# My Skill\n\nContent here',
      tags: ['react', 'forms'],
    };
    expect(validateSkill(validSkill)).toEqual({ valid: true, error: null });
  });
});

describe('sanitizeSkillName', () => {
  it('converts to lowercase', () => {
    expect(sanitizeSkillName('MySkill')).toBe('myskill');
  });

  it('replaces spaces with hyphens', () => {
    expect(sanitizeSkillName('My Skill')).toBe('my-skill');
  });

  it('replaces special characters with hyphens', () => {
    expect(sanitizeSkillName('My@Skill!')).toBe('my-skill');
  });

  it('removes leading/trailing hyphens', () => {
    expect(sanitizeSkillName('  My Skill  ')).toBe('my-skill');
    expect(sanitizeSkillName('---test---')).toBe('test');
  });

  it('limits length to 50 characters', () => {
    const longName = 'a'.repeat(60);
    expect(sanitizeSkillName(longName).length).toBe(50);
  });

  it('handles null/undefined', () => {
    expect(sanitizeSkillName(null)).toBe('');
    expect(sanitizeSkillName(undefined)).toBe('');
  });
});
