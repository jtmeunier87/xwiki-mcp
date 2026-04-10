import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { XWikiClient } from '../client.js';
import { XWikiError } from '../client.js';

export function register(server: McpServer, client: XWikiClient): void {
  server.tool(
    'xwiki_get_tags',
    'Get all tags applied to a page.',
    {
      space: z.string().describe('Space name in dot notation (e.g. "Main" or "Administration Hub")'),
      page: z.string().describe('Page name (e.g. "WebHome")'),
    },
    async ({ space, page }) => {
      try {
        const tags = await client.getTags(space, page);
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({ tags, count: tags.length }, null, 2),
          }],
        };
      } catch (err) {
        const msg = err instanceof XWikiError ? err.message : String(err);
        return {
          content: [{ type: 'text', text: `Error fetching tags: ${msg}` }],
          isError: true,
        };
      }
    },
  );
}
