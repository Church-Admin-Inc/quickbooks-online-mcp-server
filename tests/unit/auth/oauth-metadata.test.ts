import { describe, it, expect } from '@jest/globals';
import {
  buildAuthorizationServerMetadata,
  buildProtectedResourceMetadata,
  protectedResourceMetadataPath,
} from '../../../src/auth/oauth-metadata.js';

describe('protectedResourceMetadataPath', () => {
  it('appends the resource path after the well-known segment', () => {
    expect(protectedResourceMetadataPath('/mcp')).toBe('/.well-known/oauth-protected-resource/mcp');
  });
});

describe('buildProtectedResourceMetadata', () => {
  it('names the resource exactly, including path', () => {
    const metadata = buildProtectedResourceMetadata('https://qbo.example.com', '/mcp');
    expect(metadata).toEqual({
      resource: 'https://qbo.example.com/mcp',
      authorization_servers: ['https://qbo.example.com'],
    });
  });
});

describe('buildAuthorizationServerMetadata', () => {
  it('advertises PKCE S256 and no registration endpoint', () => {
    const metadata = buildAuthorizationServerMetadata('https://qbo.example.com');
    expect(metadata.code_challenge_methods_supported).toEqual(['S256']);
    expect(metadata).not.toHaveProperty('registration_endpoint');
    expect(metadata.issuer).toBe('https://qbo.example.com');
    expect(metadata.authorization_endpoint).toBe('https://qbo.example.com/authorize');
    expect(metadata.token_endpoint).toBe('https://qbo.example.com/token');
    expect(metadata.grant_types_supported).toEqual(['authorization_code']);
  });
});
