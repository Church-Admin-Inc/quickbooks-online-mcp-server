import { describe, it, expect } from '@jest/globals';
import { renderPage, escapeHtml } from '../../../src/http/page';

describe('renderPage', () => {
  it('produces a complete HTML document', () => {
    const html = renderPage({ title: 'Privacy', body: '<p>Hello.</p>' });
    expect(html.startsWith('<!DOCTYPE html><html lang="en">')).toBe(true);
    expect(html.endsWith('</html>')).toBe(true);
    expect(html).toContain('<meta charset="utf-8">');
    expect(html).toContain('<p>Hello.</p>');
  });

  it('escapes the title, which is the one value it interpolates as text', () => {
    const html = renderPage({ title: '<script>alert("x")</script> & Co', body: '' });
    expect(html).not.toContain('<script>alert');
    expect(html).toContain('&#60;script&#62;');
  });

  it('names the server in the title so a history entry is recognisable', () => {
    expect(renderPage({ title: 'Privacy', body: '' })).toContain('<title>Privacy - QuickBooks</title>');
  });

  it('is self-contained: no external stylesheet, font, script or image request', () => {
    const html = renderPage({ title: 'Privacy', body: '<p>Hello.</p>' });
    expect(html).not.toMatch(/<link\b|<script\b|https?:\/\//);
  });

  it('renders legibly on a phone: a viewport meta and a fluid, padded body', () => {
    const html = renderPage({ title: 'Privacy', body: '' });
    expect(html).toContain('<meta name="viewport" content="width=device-width,initial-scale=1">');
    expect(html).toContain('width:100%');
    expect(html).toMatch(/max-width:\d/);
  });

  it('lets a page add its own styles after the shared ones, so it can override them', () => {
    const html = renderPage({ title: 'Privacy', body: '', styles: '.mine{color:red}' });
    const styles = /<style>([\s\S]*?)<\/style>/.exec(html)?.[1] ?? '';
    expect(styles.endsWith('.mine{color:red}')).toBe(true);
    expect(styles).toContain('body{');
  });

  it('puts a page class on <body> when asked, and omits the attribute otherwise', () => {
    expect(renderPage({ title: 'T', body: '', bodyClass: 'success' })).toContain('<body class="success">');
    expect(renderPage({ title: 'T', body: '' })).toContain('<body>');
  });

});

describe('escapeHtml', () => {
  it('escapes the characters that could break out of markup or an attribute', () => {
    expect(escapeHtml(`&<>"'`)).toBe('&#38;&#60;&#62;&#34;&#39;');
  });

  it('leaves ordinary text alone', () => {
    expect(escapeHtml('Grace Community Church')).toBe('Grace Community Church');
  });
});
