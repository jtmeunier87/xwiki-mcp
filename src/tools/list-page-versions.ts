import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { XWikiError } from '../client.js';
import type { XWikiClient } from '../client.js';

export function register(server: McpServer, client: XWikiClient): void {
  server.registerTool(
    'xwiki_list_page_versions',
    {
      description: 'Get the revision history of a wiki page, showing all past versions with timestamps, authors, and edit comments.',
      inputSchema: z.object({
        space: z.string().describe("Wiki space name (e.g. 'Main', 'Sandbox')"),
        page: z.string().describe("Page name within the space (e.g. 'WebHome')"),
        limit: z.number().int().min(1).max(100).default(20).describe('Maximum number of history entries to return (default 20)'),
      }),
    },
    async ({ space, page, limit }) => {
      let history;
      try {
        history = await client.getPageHistory(space, page, limit);
      } catch (e) {
        if (e instanceof XWikiError && e.status === 404) {
          return { content: [{ type: 'text', text: `Page not found: ${space}/${page}` }], isError: true };
        }
        throw e;
      }
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ space, page, count: history.length, history }),
          },
        ],
      };
    },
  );
}
