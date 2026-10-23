import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import type { XWikiClient } from '../client.js';
import { XWikiError } from '../client.js';

export function register(server: McpServer, client: XWikiClient): void {
  server.registerTool(
    'xwiki_get_object',
    {
      description: 'Get a single XObject by class name and object number from a page. Returns the full object with all property values.',
      inputSchema: z.object({
        space: z.string().describe('Space name in dot notation (e.g. "Main" or "Docs.Guides")'),
        page: z.string().describe('Page name (e.g. "WebHome")'),
        class_name: z.string().describe('Fully qualified class name (e.g. "XWiki.XWikiComments")'),
        object_number: z.number().int().min(0).describe('Object number (0-based index within the class on this page)'),
      }),
    },
    async ({ space, page, class_name, object_number }) => {
      try {
        const obj = await client.getObject(space, page, class_name, object_number);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(obj),
            },
          ],
        };
      } catch (err) {
        const msg = err instanceof XWikiError ? err.message : String(err);
        return {
          content: [{ type: 'text', text: `Error fetching object: ${msg}` }],
          isError: true,
        };
      }
    },
  );
}
