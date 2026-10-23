import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';

vi.mock('./config.js', () => ({
  config: { baseUrl: 'https://wiki.example.com', authType: 'none', wikiName: 'xwiki', restPath: '/rest', pageLimit: 50, timeoutMs: 30000 },
}));

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { annotationsFor, registerTools, type Access, type Register } from './registry.js';
import type { XWikiClient } from './client.js';

/** A fake server that records what was registered. */
function recorder() {
  const calls: Array<{ name: string; annotations?: unknown; cb: (...a: unknown[]) => unknown }> = [];
  const server = {
    registerTool: (name: string, cfg: { annotations?: unknown }, cb: (...a: unknown[]) => unknown) => { calls.push({ name, annotations: cfg.annotations, cb }); },
    tool: (name: string, _d: string, _s: unknown, annotations: unknown, cb: (...a: unknown[]) => unknown) => { calls.push({ name, annotations, cb }); },
  } as unknown as McpServer;
  return { server, calls };
}

const newStyle = (name: string, cb: () => unknown = () => ({ content: [] })): Register => s => {
  s.registerTool(name, { description: 'd', inputSchema: { x: z.string() } }, cb as never);
};
const oldStyle = (name: string, cb: () => unknown = () => ({ content: [] })): Register => s => {
  s.tool(name, 'd', { x: z.string() }, cb as never);
};

describe('annotationsFor', () => {
  it('marks reads read-only and classifies writes', () => {
    expect(annotationsFor('xwiki_get_page', 'read')).toEqual({ readOnlyHint: true, openWorldHint: false });
    expect(annotationsFor('xwiki_add_comment', 'write')).toMatchObject({ readOnlyHint: false, destructiveHint: false, idempotentHint: false });
    expect(annotationsFor('xwiki_update_page', 'write')).toMatchObject({ destructiveHint: true, idempotentHint: true });
    expect(annotationsFor('xwiki_move_page', 'write')).toMatchObject({ destructiveHint: true, idempotentHint: false });
    expect(annotationsFor('xwiki_delete_page', 'delete')).toMatchObject({ destructiveHint: true, idempotentHint: true });
  });
});

describe('registerTools', () => {
  const client = {} as XWikiClient;

  it('adds annotations for both registration styles and skips disabled tools', () => {
    const { server, calls } = recorder();
    const tools: Array<[Access, Register]> = [
      ['read', newStyle('xwiki_get_page')],
      ['write', oldStyle('xwiki_update_object')],
      ['write', newStyle('xwiki_move_page')],
    ];
    const seen = new Set<string>();

    const names = registerTools(server, client, tools, new Set(['xwiki_move_page']), seen);

    expect(names).toEqual(['xwiki_get_page', 'xwiki_update_object']);
    expect([...seen]).toEqual(['xwiki_get_page', 'xwiki_update_object', 'xwiki_move_page']);
    expect(calls.map(c => c.name)).toEqual(['xwiki_get_page', 'xwiki_update_object']);
    expect(calls[0].annotations).toEqual({ readOnlyHint: true, openWorldHint: false });
    expect(calls[1].annotations).toMatchObject({ readOnlyHint: false, destructiveHint: true, idempotentHint: true });
  });

  it('turns a thrown error into an isError result', async () => {
    const { server, calls } = recorder();
    registerTools(server, client, [['read', newStyle('xwiki_get_page', () => { throw new Error('Not found: /spaces/Main/pages/X'); })]], new Set());

    expect(await calls[0].cb()).toEqual({ content: [{ type: 'text', text: 'Not found: /spaces/Main/pages/X' }], isError: true });
  });

  it('works with the real McpServer', () => {
    const server = new McpServer({ name: 't', version: '0' });
    const names = registerTools(server, client, [['read', newStyle('xwiki_a')], ['delete', oldStyle('xwiki_b')]], new Set());
    expect(names).toEqual(['xwiki_a', 'xwiki_b']);
  });
});
