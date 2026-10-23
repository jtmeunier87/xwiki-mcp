import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { XWikiError } from '../client.js';
import type { XWikiClient } from '../client.js';

export function register(server: McpServer, client: XWikiClient): void {
  server.registerTool(
    'xwiki_list_deleted_pages',
    {
      description: `List pages in the wiki's recycle bin, newest first: each entry's recycle-bin id (for xwiki_restore_deleted_page), page reference, title, who deleted it and when, its batch id (pages deleted together share one), and whether it can be restored. name filters by part of the page reference (case-insensitive). Paged with start / limit.`,
      inputSchema: {
        name: z.string().optional().describe('Part of the page reference, e.g. "Guides" or "Docs.Guides.Setup"'),
        start: z.number().int().min(0).default(0).describe('Offset for pagination (default 0)'),
        limit: z.number().int().min(1).max(200).default(25).describe('Entries per call (default 25)'),
      },
    },
    async ({ name, start, limit }) => {
      try {
        const result = await client.listDeletedPages(name, start, limit).then(r => ({ count: r.pages.length, pages: r.pages, _pagination: r.pagination }));
        return { content: [{ type: 'text', text: JSON.stringify(result) }] };
      } catch (e) {
        const msg = e instanceof XWikiError && e.status === 404
          ? 'Recycle bin listing not available (XWiki.DeletedDocumentsJSON not found).'
          : e instanceof Error ? e.message : String(e);
        return { content: [{ type: 'text', text: msg }], isError: true };
      }
    },
  );
}
