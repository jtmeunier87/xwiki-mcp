import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import type { XWikiClient } from '../client.js';

export function register(server: McpServer, client: XWikiClient): void {
  server.registerTool(
    'xwiki_get_page_version',
    {
      description: 'Retrieve the full content of a wiki page at a specific historical version (e.g. "3.1", "1.1").',
      inputSchema: z.object({
        space: z.string().describe("Wiki space name (e.g. 'Main')"),
        page: z.string().describe("Page name (e.g. 'WebHome')"),
        version: z.string().describe("Version string to retrieve (e.g. '3.1', '1.1'). Use get_page_history to find available versions."),
      }),
    },
    async ({ space, page, version }) => {
      const pageData = await client.getPageVersion(space, page, version);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(pageData),
          },
        ],
      };
    },
  );
}
