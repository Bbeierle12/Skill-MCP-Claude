/**
 * Tests for escapeHtml utility
 */

import { describe, it, expect } from 'vitest';
import { escapeHtml, escapeHtmlWithBreaks, escapeAttribute } from '../../js/utils/escapeHtml.js';

describe('escapeHtml', () => {
  it('escapes < and > characters', () => {
    expect(escapeHtml('<script>')).toBe('&lt;script&gt;');
    expect(escapeHtml('<div>Hello</div>')).toBe('&lt;div&gt;Hello&lt;&#x2F;div&gt;');
  });

  it('escapes & character', () => {
    expect(escapeHtml('Tom & Jerry')).toBe('Tom &amp; Jerry');
    expect(escapeHtml('a && b')).toBe('a &amp;&amp; b');
  });

  it('escapes quote characters', () => {
    expect(escapeHtml('"hello"')).toBe('&quot;hello&quot;');
    expect(escapeHtml("it's")).toBe('it&#39;s');
  });

  it('escapes backticks and equals', () => {
    expect(escapeHtml('`code`')).toBe('&#x60;code&#x60;');
    expect(escapeHtml('a=b')).toBe('a&#x3D;b');
  });

  it('handles null and undefined', () => {
    expect(escapeHtml(null)).toBe('');
    expect(escapeHtml(undefined)).toBe('');
  });

  it('converts non-strings to strings', () => {
    expect(escapeHtml(123)).toBe('123');
    expect(escapeHtml(true)).toBe('true');
    expect(escapeHtml({ a: 1 })).toBe('[object Object]');
  });

  it('handles empty string', () => {
    expect(escapeHtml('')).toBe('');
  });

  it('preserves safe characters', () => {
    expect(escapeHtml('Hello World 123')).toBe('Hello World 123');
    expect(escapeHtml('abc-def_ghi')).toBe('abc-def_ghi');
  });

  it('handles complex XSS attempts', () => {
    const xss = '<script>alert("XSS")</script>';
    const escaped = escapeHtml(xss);
    expect(escaped).not.toContain('<script>');
    expect(escaped).not.toContain('</script>');
    expect(escaped).toBe('&lt;script&gt;alert(&quot;XSS&quot;)&lt;&#x2F;script&gt;');
  });
});

describe('escapeHtmlWithBreaks', () => {
  it('converts newlines to <br> tags', () => {
    expect(escapeHtmlWithBreaks('line1\nline2')).toBe('line1<br>line2');
    expect(escapeHtmlWithBreaks('a\nb\nc')).toBe('a<br>b<br>c');
  });

  it('escapes HTML and preserves breaks', () => {
    expect(escapeHtmlWithBreaks('<b>bold</b>\n<i>italic</i>')).toBe(
      '&lt;b&gt;bold&lt;&#x2F;b&gt;<br>&lt;i&gt;italic&lt;&#x2F;i&gt;'
    );
  });

  it('handles empty string', () => {
    expect(escapeHtmlWithBreaks('')).toBe('');
  });
});

describe('escapeAttribute', () => {
  it('escapes for use in HTML attributes', () => {
    expect(escapeAttribute('value with "quotes"')).toBe('value with &quot;quotes&quot;');
    expect(escapeAttribute("it's fine")).toBe('it&#39;s fine');
  });

  it('escapes special characters', () => {
    expect(escapeAttribute('<script>')).toBe('&lt;script&gt;');
  });
});
