import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { XWikiError } from '../client.js';
import type { XWikiClient } from '../client.js';

export function register(server: McpServer, client: XWikiClient): void {
  server.registerTool(
    'xwiki_restore_deleted_page',
    {
      description: `Restore a deleted page from the recycle bin. Find its id with xwiki_list_deleted_pages (a page deleted several times has several entries; pick the one to restore). Restores that one entry, not other pages deleted in the same batch. Refused if a page exists at that reference again. Needs the right to restore it (usually the user who deleted it, or an admin).`,
      inputSchema: {
        space: z.string().describe('Space name. Use dot notation for nested spaces: "Docs.Guides"'),
        page: z.string().describe('Page name (e.g. "WebHome")'),
        id: z.number().int().min(0).describe('Recycle-bin id from xwiki_list_deleted_pages'),
      },
    },
    async ({ space, page, id }) => {
      try {
        const result = await client.restorePage(space, page, id);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (e) {
        const msg = e instanceof XWikiError && e.status === 404
          ? `Page not found: ${space}/${page}`
          : e instanceof Error ? e.message : String(e);
        return { content: [{ type: 'text', text: msg }], isError: true };
      }
    },
  );
}
