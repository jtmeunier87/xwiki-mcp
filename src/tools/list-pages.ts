import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { config } from '../config.js';
import type { XWikiClient } from '../client.js';

export function register(server: McpServer, client: XWikiClient): void {
  server.registerTool(
    'list_pages',
    {
      description: 'Get list of pages in a wiki space. Supports nested spaces using dot notation (e.g. "Space1.SubSpace").',
      inputSchema: {
        space: z.string().describe('Space name. Use dot notation for nested spaces: "Space1.SubSpace"'),
        start: z.number().int().min(0).optional().default(0).describe('Pagination offset'),
        limit: z.number().int().min(1).max(200).optional().describe('Number of results (default from XWIKI_PAGE_LIMIT)'),
      },
    },
    async ({ space, start, limit }) => {
      try {
        const effectiveLimit = limit ?? config.pageLimit;
        const { pages, pagination } = await client.listPages(space, start, effectiveLimit);
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({ pages, _pagination: pagination }, null, 2),
          }],
        };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return { content: [{ type: 'text', text: msg }], isError: true };
      }
    },
  );
}
