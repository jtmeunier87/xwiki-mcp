import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { XWikiClient } from '../client.js';
import { XWikiError } from '../client.js';

export function register(server: McpServer, client: XWikiClient): void {
  server.tool(
    'xwiki_update_object',
    'Update properties of an existing XObject on a page. Only the supplied properties are modified — unspecified properties retain their current values.',
    {
      space: z.string().describe('Space name in dot notation (e.g. "Main" or "Administration Hub.Sales")'),
      page: z.string().describe('Page name (e.g. "WebHome")'),
      class_name: z.string().describe('Fully qualified class name (e.g. "XWiki.XWikiComments")'),
      object_number: z.number().int().min(0).describe('Object number (0-based index within the class on this page)'),
      properties: z.record(z.string(), z.string()).describe('Key-value map of property names to new values'),
    },
    async ({ space, page, class_name, object_number, properties }) => {
      try {
        const result = await client.updateObject(space, page, class_name, object_number, properties);
        return {
          content: [{
            type: 'text',
            text: JSON.stringify(result, null, 2),
          }],
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
