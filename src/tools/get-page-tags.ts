import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import type { XWikiClient } from '../client.js';
import { XWikiError } from '../client.js';

export function register(server: McpServer, client: XWikiClient): void {
  server.registerTool(
    'xwiki_get_page_tags',
    {
      description: 'Get all tags applied to a page.',
      inputSchema: z.object({
        space: z.string().describe('Space name in dot notation (e.g. "Main" or "Docs")'),
        page: z.string().describe('Page name (e.g. "WebHome")'),
      }),
    },
    async ({ space, page }) => {
      try {
        const tags = await client.getTags(space, page);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ tags, count: tags.length }),
            },
          ],
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
