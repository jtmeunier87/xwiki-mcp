import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import type { XWikiClient } from '../client.js';
import { XWikiError } from '../client.js';

export function register(server: McpServer, client: XWikiClient): void {
  server.registerTool(
    'xwiki_update_object',
    {
      description:
        'Update properties of an existing XObject on a page. Each supplied property\'s whole value is replaced; ' +
        'unspecified properties retain their current values. ' +
        'To change only part of a long property value (e.g. a few lines of code), use xwiki_replace_in_page instead.',
      inputSchema: z.object({
        space: z.string().describe('Space name in dot notation (e.g. "Main" or "Docs.Guides")'),
        page: z.string().describe('Page name (e.g. "WebHome")'),
        class_name: z.string().describe('Fully qualified class name (e.g. "XWiki.XWikiComments")'),
        object_number: z.number().int().min(0).describe('Object number (0-based index within the class on this page)'),
        properties: z.record(z.string(), z.string()).describe('Key-value map of property names to new values'),
      }),
    },
    async ({ space, page, class_name, object_number, properties }) => {
      try {
        const result = await client.updateObject(space, page, class_name, object_number, properties);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result),
            },
          ],
        };
      } catch (err) {
        const msg = err instanceof XWikiError ? err.message : String(err);
        return {
          content: [{ type: 'text', text: `Error updating object: ${msg}` }],
          isError: true,
        };
      }
    },
  );
}
