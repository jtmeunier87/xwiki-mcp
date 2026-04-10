import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { config } from '../config.js';
import type { XWikiClient } from '../client.js';

export function register(server: McpServer, client: XWikiClient): void {
  server.registerTool(
    'xwiki_search',
    {
      description: 'Full-text search across the wiki. Returns pages matching the query.',
      inputSchema: {
        query: z.string().describe('Search query'),
        scope: z
          .enum(['content', 'title', 'name'])
          .optional()
          .default('content')
          .describe('Where to search: content (default), title, or page name'),
        space: z.string().optional().describe('Limit search to a specific space'),
        start: z.number().int().min(0).optional().default(0).describe('Pagination offset'),
        limit: z.number().int().min(1).max(100).optional().describe('Number of results (default 20)'),
      },
    },
    async ({ query, scope, space, start, limit }) => {
      try {
        const effectiveLimit = limit ?? Math.min(config.pageLimit, 20);
        const { results, pagination } = await client.search(query, scope, space, start, effectiveLimit);
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({ results, _pagination: pagination }, null, 2),
          }],
        };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return { content: [{ type: 'text', text: msg }], isError: true };
      }
    },
  );
}
