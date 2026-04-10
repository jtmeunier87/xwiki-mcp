import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { XWikiClient } from '../client.js';

export function register(server: McpServer, client: XWikiClient): void {
  server.tool(
    'get_pages_by_tag',
    'Get all pages that have a specific tag. Use get_all_wiki_tags first to see available tags. Useful for topic-based navigation (e.g. find all pages tagged "PM" or "AV").',
    {
      tag: z.string().describe("The tag name to search for (e.g. 'PM', 'AV', 'Documentation')"),
      limit: z.number().int().min(1).max(200).default(50).describe('Maximum number of pages to return (default 50)'),
    },
    async ({ tag, limit }) => {
      const pages = await client.getPagesByTag(tag, limit);
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({ tag, count: pages.length, pages }, null, 2),
        }],
      };
    },
  );
}
