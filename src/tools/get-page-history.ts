import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { XWikiClient } from '../client.js';

export function register(server: McpServer, client: XWikiClient): void {
  server.tool(
    'xwiki_get_page_history',
    'Get the revision history of a wiki page, showing all past versions with timestamps, authors, and edit comments.',
    {
      space: z.string().describe("Wiki space name (e.g. 'Main', 'Sandbox')"),
      page: z.string().describe("Page name within the space (e.g. 'WebHome')"),
      limit: z.number().int().min(1).max(100).default(20).describe('Maximum number of history entries to return (default 20)'),
    },
    async ({ space, page, limit }) => {
      const history = await client.getPageHistory(space, page, limit);
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({ space, page, count: history.length, history }, null, 2),
        }],
      };
    },
  );
}
