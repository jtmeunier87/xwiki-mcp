import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { XWikiError } from '../client.js';
import type { XWikiClient } from '../client.js';

export function register(server: McpServer, client: XWikiClient): void {
  server.registerTool(
    'xwiki_delete_page',
    {
      description:
        'Delete a wiki page permanently. This action cannot be undone. ' +
        'The page and all its content will be removed.',
      inputSchema: {
        space: z.string().describe('Space name. Use dot notation for nested spaces: "Space1.SubSpace"'),
        page: z.string().describe('Page name to delete (e.g. "MyPage")'),
      },
    },
    async ({ space, page }) => {
      try {
        const result = await client.deletePage(space, page);
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({ ...result, space, page }, null, 2),
          }],
        };
      } catch (e) {
        const msg = e instanceof XWikiError && e.status === 404
          ? `Page not found: ${space}/${page}`
          : e instanceof Error ? e.message : String(e);
        return { content: [{ type: 'text', text: msg }], isError: true };
      }
    },
  );
}
