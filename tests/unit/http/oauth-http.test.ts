import { describe, it, expect } from '@jest/globals';
import { guardOAuthEndpoint, resolveOrigin } from '../../../src/http/oauth-http.js';

function fakeRequest(opts: {
  headers?: Record<string, string | string[]>;
  encrypted?: boolean;
  localPort?: number;
}): Parameters<typeof resolveOrigin>[0] {
  return {
    headers: opts.headers ?? {},
    socket: { encrypted: opts.encrypted, localPort: opts.localPort },
  } as unknown as Parameters<typeof resolveOrigin>[0];
}

describe('resolveOrigin', () => {
  it('defaults to http on a plain, non-TLS loopback connection with a non-standard port', () => {
    expect(resolveOrigin(fakeRequest({ localPort: 3000 }), '127.0.0.1')).toBe('http://127.0.0.1:3000');
  });

  it('infers https from an encrypted socket when no X-Forwarded-Proto is present', () => {
    expect(resolveOrigin(fakeRequest({ encrypted: true, localPort: 3000 }), 'qbo.example.com')).toBe(
      'https://qbo.example.com:3000'
    );
  });

  it('trusts X-Forwarded-Proto from a reverse proxy (e.g. Cloud Run) over the raw socket, and ignores the container-internal local port', () => {
    expect(
      resolveOrigin(fakeRequest({ headers: { 'x-forwarded-proto': 'https' }, localPort: 8080 }), 'qbo.example.com')
    ).toBe('https://qbo.example.com');
  });

  it('takes the first value when X-Forwarded-Proto is a comma-separated chain', () => {
    expect(
      resolveOrigin(fakeRequest({ headers: { 'x-forwarded-proto': 'https, http' }, localPort: 8080 }), 'qbo.example.com')
    ).toBe('https://qbo.example.com');
  });

  it('takes the first value when X-Forwarded-Proto is sent as multiple headers (array)', () => {
    expect(
      resolveOrigin(fakeRequest({ headers: { 'x-forwarded-proto': ['https', 'http'] }, localPort: 8080 }), 'qbo.example.com')
    ).toBe('https://qbo.example.com');
  });

  it('prefers an explicit port on the Host header over the socket local port, even behind a proxy', () => {
    expect(
      resolveOrigin(
        fakeRequest({ headers: { 'x-forwarded-proto': 'https', host: 'qbo.example.com:8443' }, localPort: 8080 }),
        'qbo.example.com'
      )
    ).toBe('https://qbo.example.com:8443');
  });

  it('omits the port for the standard port of its protocol (443)', () => {
    expect(
      resolveOrigin(fakeRequest({ headers: { 'x-forwarded-proto': 'https' }, localPort: 443 }), 'qbo.example.com')
    ).toBe('https://qbo.example.com');
  });

  it('omits the port for the standard port of its protocol (80)', () => {
    expect(resolveOrigin(fakeRequest({ localPort: 80 }), 'qbo.example.com')).toBe('http://qbo.example.com');
  });
});

describe('guardOAuthEndpoint', () => {
  interface Calls {
    writeHead: unknown[][];
    end: unknown[][];
  }

  function fakeResponse(headersSent: boolean): Parameters<typeof guardOAuthEndpoint>[0] & { calls: Calls } {
    const calls: Calls = { writeHead: [], end: [] };
    return {
      headersSent,
      writableEnded: false,
      writeHead: (...args: unknown[]) => calls.writeHead.push(args),
      end: (...args: unknown[]) => calls.end.push(args),
      calls,
    } as unknown as Parameters<typeof guardOAuthEndpoint>[0] & { calls: Calls };
  }

  it('answers 500 with a server_error body when the handler throws before sending headers', async () => {
    const res = fakeResponse(false);
    await guardOAuthEndpoint(res, () => {
      throw new Error('boom');
    });
    expect(res.calls.writeHead[0]?.[0]).toBe(500);
    expect(res.calls.end[0]?.[0]).toBe(JSON.stringify({ error: 'server_error' }));
  });

  it('just terminates the response when the handler throws after headers are already sent', async () => {
    const res = fakeResponse(true);
    await guardOAuthEndpoint(res, () => {
      throw new Error('boom');
    });
    expect(res.calls.writeHead).toHaveLength(0);
    expect(res.calls.end).toHaveLength(1);
  });

  it('does not call end() again when the response was already fully sent', async () => {
    const res = fakeResponse(true);
    (res as unknown as { writableEnded: boolean }).writableEnded = true;
    await guardOAuthEndpoint(res, () => {
      throw new Error('boom');
    });
    expect(res.calls.end).toHaveLength(0);
  });

  it('does not touch the response when the handler resolves normally', async () => {
    const res = fakeResponse(false);
    await guardOAuthEndpoint(res, () => {});
    expect(res.calls.writeHead).toHaveLength(0);
    expect(res.calls.end).toHaveLength(0);
  });

  it('propagates a rejection from an async handler through the same catch path', async () => {
    const res = fakeResponse(false);
    await guardOAuthEndpoint(res, async () => {
      throw new Error('async boom');
    });
    expect(res.calls.writeHead[0]?.[0]).toBe(500);
  });
});
