import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import type { XWikiClient } from '../client.js';

export function register(server: McpServer, client: XWikiClient): void {
  server.registerTool(
    'xwiki_find_pages',
    {
      description: `Find pages across the entire wiki using one or more filters. Unlike list_pages (which requires knowing the space), this searches the whole wiki.

Filters (at least one required):
- name: partial page name match (e.g. "WebHome" finds all WebHome pages)
- space: exact space name to filter by (e.g. "Sandbox")
- author: xWiki username of the page author (e.g. "XWiki.JaneDoe")

Filters are combined with AND when multiple are provided.`,
      inputSchema: z.object({
        name: z.string().optional().describe("Filter by page name (partial match, e.g. 'WebHome')"),
        space: z.string().optional().describe("Filter by space name (exact match, e.g. 'Sandbox')"),
        author: z.string().optional().describe("Filter by author username (e.g. 'XWiki.JaneDoe' or 'XWiki.Admin')"),
        limit: z.number().int().min(1).max(200).default(50).describe('Maximum pages to return (default 50)'),
      }),
    },
    async ({ name, space, author, limit }) => {
      if (!name && !space && !author) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ error: 'At least one filter (name, space, or author) is required.' }),
            },
          ],
          isError: true,
        };
      }
      const pages = await client.findPages({ name, space, author }, limit);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ filters: { name, space, author }, count: pages.length, pages }),
          },
        ],
      };
    },
  );
}
