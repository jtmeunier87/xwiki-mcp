import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { XWikiClient } from '../client.js';
import { XWikiError } from '../client.js';

export function register(server: McpServer, client: XWikiClient): void {
  server.tool(
    'xwiki_add_tags',
    'Add one or more tags to a page. Existing tags are preserved — this is additive, not a replacement. Returns the full list of tags after the update.',
    {
      space: z.string().describe('Space name in dot notation (e.g. "Main" or "Administration Hub")'),
      page: z.string().describe('Page name (e.g. "WebHome")'),
      tags: z.array(z.string()).min(1).describe('Array of tag names to add (e.g. ["architecture", "reviewed"])'),
    },
    async ({ space, page, tags }) => {
      try {
        const result = await client.addTags(space, page, tags);
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({ tags: result, count: result.length }, null, 2),
          }],
        };
      } catch (err) {
        const msg = err instanceof XWikiError ? err.message : String(err);
        return {
          content: [{ type: 'text', text: `Error adding tags: ${msg}` }],
          isError: true,
        };
      }
    },
  );
}
