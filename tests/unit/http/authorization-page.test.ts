import { describe, it, expect, jest } from '@jest/globals';
import type http from 'node:http';
import { renderAuthorizationPage, escapeHtml } from '../../../src/http/authorization-page';
import { tryHandleCompanyOAuthRequest } from '../../../src/http/company-oauth-http';
import type { CompanyOAuthDeps } from '../../../src/http/company-oauth-http';

describe('renderAuthorizationPage', () => {
  it('distinguishes success from failure structurally, not only in the text', () => {
    const success = renderAuthorizationPage({ outcome: 'success', heading: 'Connected', detail: 'Done.' });
    const failure = renderAuthorizationPage({ outcome: 'failure', heading: 'Nope', detail: 'Try again.' });
    expect(success).toContain('<body class="success">');
    expect(failure).toContain('<body class="failure">');
  });

  it('is self-contained: no external stylesheet, font, script or image request', () => {
    const html = renderAuthorizationPage({ outcome: 'success', heading: 'Connected', detail: 'Done.' });
    expect(html).not.toMatch(/<link\b|<script\b|https?:\/\//);
  });

  it('escapes every interpolated value, including the one that reaches the title', () => {
    const html = renderAuthorizationPage({
      outcome: 'success',
      heading: '<script>alert("x")</script> & Co',
      detail: "O'Brien & <b>Sons</b>",
    });
    expect(html).not.toContain('<script>alert');
    expect(html).not.toContain('<b>Sons</b>');
    expect(html).toContain('&#60;script&#62;');
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

describe('the Company-authorization endpoints', () => {
  function fakeResponse() {
    const chunks: string[] = [];
    return {
      headersSent: false,
      writableEnded: false,
      writeHead: jest.fn<(status: number, headers: Record<string, string>) => unknown>(function (this: any) {
        this.headersSent = true;
        return this;
      }),
      end: jest.fn<(chunk?: string) => void>(function (this: any, chunk?: string) {
        if (chunk) chunks.push(chunk);
        this.writableEnded = true;
      }),
      body: () => chunks.join(''),
    };
  }

  it('renders an unhandled failure as a page, not as the JSON the shared guard would send', async () => {
    // /token and the other machine-facing endpoints need JSON; a browser
    // renders it as a raw blob, so these two endpoints guard differently.
    const deps = {
      pending: {
        consume: () => {
          throw new Error('pending store unavailable');
        },
      },
    } as unknown as CompanyOAuthDeps;
    const res = fakeResponse();
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});

    const handled = await tryHandleCompanyOAuthRequest(
      { method: 'GET' } as http.IncomingMessage,
      res as unknown as http.ServerResponse,
      '/auth/quickbooks/authorize',
      new URL('https://qbo.example.com/auth/quickbooks/authorize?token=t'),
      'https://qbo.example.com',
      deps
    );

    expect(handled).toBe(true);
    expect(res.writeHead).toHaveBeenCalledWith(500, expect.objectContaining({ 'Content-Type': 'text/html' }));
    expect(res.body()).toContain('<body class="failure">');
    consoleError.mockRestore();
  });

  it('does not try to respond twice when the failure came after the response started', async () => {
    const deps = {
      pending: {
        consume: () => {
          throw new Error('too late');
        },
      },
    } as unknown as CompanyOAuthDeps;
    const res = fakeResponse();
    res.headersSent = true;
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});

    await tryHandleCompanyOAuthRequest(
      { method: 'GET' } as http.IncomingMessage,
      res as unknown as http.ServerResponse,
      '/auth/quickbooks/authorize',
      new URL('https://qbo.example.com/auth/quickbooks/authorize?token=t'),
      'https://qbo.example.com',
      deps
    );

    expect(res.writeHead).not.toHaveBeenCalled();
    expect(res.end).toHaveBeenCalled();
    consoleError.mockRestore();
  });
});
