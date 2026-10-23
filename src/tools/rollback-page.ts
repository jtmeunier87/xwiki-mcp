import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import type { XWikiClient } from '../client.js';

export function register(server: McpServer, client: XWikiClient): void {
  server.registerTool(
    'xwiki_rollback_page',
    {
      description:
        'Roll a page back to an earlier version (content and objects). xWiki saves the old version as a new version, so history is kept. Use xwiki_list_page_versions to find the version.',
      inputSchema: z.object({
        space: z.string().describe("Space name in dot notation (e.g. 'Main' or 'Space.SubSpace')"),
        page: z.string().describe("Page name (e.g. 'WebHome')"),
        version: z.string().describe("Version to restore (e.g. '1.1'), from xwiki_list_page_versions"),
      }),
    },
    async ({ space, page, version }) => {
      const result = await client.rollbackPage(space, page, version);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result),
          },
        ],
      };
    },
  );
}
