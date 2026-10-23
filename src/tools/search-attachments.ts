import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { XWikiError } from '../client.js';
import type { XWikiClient } from '../client.js';

export function register(server: McpServer, client: XWikiClient): void {
  server.registerTool(
    'xwiki_search_attachments',
    {
      description: `Find attachments across the wiki, or within one space and its subspaces, without knowing which page holds them.

Filters match part of the value: name (file name), page (page name), author (e.g. "JaneDoe"). types is a comma-separated list of media types or parts of them, e.g. "image" or "pdf,image/png". Returns each file's page, size, media type, author, date, version and download URL. Use xwiki_list_attachments for the files on one known page.`,
      inputSchema: {
        space: z.string().optional().describe('Limit to this space and its subspaces (dot notation, e.g. "Docs.Guides"). Omit for the whole wiki'),
        name: z.string().optional().describe('Part of the file name, e.g. "diagram" or ".png"'),
        page: z.string().optional().describe('Part of the page name'),
        author: z.string().optional().describe('Part of the author\'s user name, e.g. "JaneDoe"'),
        types: z.string().optional().describe('Comma-separated media types or parts, e.g. "image" or "application/pdf"'),
        start: z.number().int().min(0).default(0).describe('Offset for pagination (default 0)'),
        limit: z.number().int().min(1).max(200).default(25).describe('Results per call (default 25)'),
      },
    },
    async ({ space, name, page, author, types, start, limit }) => {
      try {
        const { attachments, pagination } = await client.searchAttachments({ space, name, page, author, types }, start, limit);
        return { content: [{ type: 'text', text: JSON.stringify({ count: attachments.length, attachments, _pagination: pagination }, null, 2) }] };
      } catch (e) {
        const msg = e instanceof XWikiError && e.status === 404
          ? `Space not found: ${space}`
          : e instanceof Error ? e.message : String(e);
        return { content: [{ type: 'text', text: msg }], isError: true };
      }
    },
  );
}
