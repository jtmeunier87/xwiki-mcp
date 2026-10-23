import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/server';
import { XWikiError } from '../client.js';
import type { XWikiClient } from '../client.js';

export function register(server: McpServer, client: XWikiClient): void {
  server.registerTool(
    'xwiki_remove_tags',
    {
      description:
        "Remove tags from a page. Other tags on the page are kept. Returns the tags removed, any that were not on the page, and the page's remaining tags. Tag names match exactly (case-sensitive).",
      inputSchema: z.object({
        space: z.string().describe('Space name. Use dot notation for nested spaces: "Docs.Guides"'),
        page: z.string().describe('Page name (e.g. "WebHome")'),
        tags: z.array(z.string()).min(1).describe('Tags to remove, e.g. ["draft", "review"]'),
      }),
    },
    async ({ space, page, tags }) => {
      try {
        const result = await client.removeTags(space, page, tags);
        return { content: [{ type: 'text', text: JSON.stringify(result) }] };
      } catch (e) {
        const msg =
          e instanceof XWikiError && e.status === 404 ? `Page not found: ${space}/${page}` : e instanceof Error ? e.message : String(e);
        return { content: [{ type: 'text', text: msg }], isError: true };
      }
    },
  );
}
