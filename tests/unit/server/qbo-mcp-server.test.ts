import { describe, it, expect } from '@jest/globals';
import { createMcpServer, QuickbooksMCPServer } from '../../../src/server/qbo-mcp-server';

describe('createMcpServer', () => {
  it('builds a fresh McpServer instance on every call', () => {
    const first = createMcpServer();
    const second = createMcpServer();
    expect(first).not.toBe(second);
  });
});

describe('QuickbooksMCPServer.GetServer', () => {
  it('returns the same instance on every call', () => {
    const first = QuickbooksMCPServer.GetServer();
    const second = QuickbooksMCPServer.GetServer();
    expect(first).toBe(second);
  });
});
