import { describe, it, expect, jest } from '@jest/globals';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  CONNECT_COMPANY_MIME_TYPE,
  CONNECT_COMPANY_RESOURCE_URI,
  CONNECT_COMPANY_UI_META,
  connectCompanyResultFields,
  connectCompanyStructuredContent,
  registerConnectCompanyApp,
  renderConnectCompanyApp,
} from '../../../src/mcp-apps/connect-company-app';

// The three parts of the MCP Apps contract (issue #28) are asserted against
// literal spec values, not against the module's own constants, so a typo in a
// constant fails here rather than silently producing a component no host
// recognises.

describe('the Company-connection component', () => {
  it('is published at a ui:// URI under the MCP Apps mimeType', () => {
    expect(CONNECT_COMPANY_RESOURCE_URI.startsWith('ui://')).toBe(true);
    expect(CONNECT_COMPANY_MIME_TYPE).toBe('text/html;profile=mcp-app');
  });

  it('points at itself through _meta.ui.resourceUri', () => {
    expect(CONNECT_COMPANY_UI_META).toEqual({ ui: { resourceUri: CONNECT_COMPANY_RESOURCE_URI } });
  });

  it('registers as a readable resource serving its own HTML', async () => {
    const registerResource = jest.fn();
    registerConnectCompanyApp({ registerResource } as unknown as McpServer);

    expect(registerResource).toHaveBeenCalledTimes(1);
    const [, uri, config, read] = registerResource.mock.calls[0] as any[];
    expect(uri).toBe(CONNECT_COMPANY_RESOURCE_URI);
    expect(config.mimeType).toBe(CONNECT_COMPANY_MIME_TYPE);
    expect(await read()).toEqual({
      contents: [
        {
          uri: CONNECT_COMPANY_RESOURCE_URI,
          mimeType: CONNECT_COMPANY_MIME_TYPE,
          text: renderConnectCompanyApp(),
        },
      ],
    });
  });

  it('is self-contained: no external stylesheet, font, script or image request', () => {
    // An MCP App runs in a sandboxed cross-origin iframe; a subresource
    // request is the first thing such a sandbox denies.
    const html = renderConnectCompanyApp();
    expect(html).not.toMatch(/<link\b/);
    expect(html).not.toMatch(/<script\b[^>]*\ssrc=/);
    expect(html).not.toMatch(/<img\b/);
  });

  it('reads sensibly before any Company is named, since authorize_company names none', () => {
    // The document's static text is what an employee sees for reason "new"
    // (and for the moment before a host delivers any data at all), so it has
    // to stand on its own without a Company.
    const html = renderConnectCompanyApp();
    expect(html).toContain('<h1 id="heading">Connect a QuickBooks Company</h1>');
    expect(html).toContain('Sign in with your Intuit account and choose the Company to connect.');
  });

  it('renders on a dark host surface as well as a light one', () => {
    expect(renderConnectCompanyApp()).toContain('prefers-color-scheme:dark');
  });

  it('renders an actual button, and never builds markup from untrusted data', () => {
    const html = renderConnectCompanyApp();
    expect(html).toContain('id="connect"');
    expect(html).toContain('Connect QuickBooks');
    // Company names come from QuickBooks CompanyInfo, so the component must
    // reach the DOM through textContent only.
    expect(html).not.toContain('innerHTML');
  });
});

describe('connectCompanyStructuredContent', () => {
  it('names the Company when one is known', () => {
    expect(
      connectCompanyStructuredContent({
        authorizeUrl: 'https://qbo.example.com/auth?token=t',
        reason: 'missing',
        companyName: 'Grace Community Church',
        realmId: '9130',
      })
    ).toEqual({
      authorize_url: 'https://qbo.example.com/auth?token=t',
      reason: 'missing',
      company_name: 'Grace Community Church',
      realm_id: '9130',
    });
  });

  it('omits the Company entirely when none is named, rather than sending nulls', () => {
    // authorize_company's case: the employee picks the Company on Intuit's
    // own screen, so the component has to render with no Company at all.
    const content = connectCompanyStructuredContent({
      authorizeUrl: 'https://qbo.example.com/auth?token=t',
      reason: 'new',
    });
    expect(content).toEqual({ authorize_url: 'https://qbo.example.com/auth?token=t', reason: 'new' });
    expect('company_name' in content).toBe(false);
    expect('realm_id' in content).toBe(false);
  });

  it('keeps an unhealthy connection distinct from one never authorized', () => {
    const unhealthy = connectCompanyStructuredContent({
      authorizeUrl: 'https://qbo.example.com/auth?token=t',
      reason: 'unhealthy',
      realmId: '9130',
    });
    expect(unhealthy['reason']).toBe('unhealthy');
  });
});

describe('connectCompanyResultFields', () => {
  it('carries both the data and the pointer a host needs to render the component', () => {
    const fields = connectCompanyResultFields({
      authorizeUrl: 'https://qbo.example.com/auth?token=t',
      reason: 'new',
    });
    expect(fields.structuredContent).toEqual({
      authorize_url: 'https://qbo.example.com/auth?token=t',
      reason: 'new',
    });
    expect(fields._meta).toEqual({ ui: { resourceUri: CONNECT_COMPANY_RESOURCE_URI } });
  });
});
