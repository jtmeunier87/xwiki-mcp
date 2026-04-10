import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { XWikiClient } from '../client.js';
import { XWikiError } from '../client.js';

export function register(server: McpServer, client: XWikiClient): void {
  server.tool(
    'delete_object',
    'Delete an XObject from a page by class name and object number. This is permanent.',
    {
      space: z.string().describe('Space name in dot notation (e.g. "Main" or "Administration Hub.Sales")'),
      page: z.string().describe('Page name (e.g. "WebHome")'),
      class_name: z.string().describe('Fully qualified class name (e.g. "XWiki.XWikiComments")'),
      object_number: z.number().int().min(0).describe('Object number (0-based index within the class on this page)'),
    },
    async ({ space, page, class_name, object_number }) => {
      try {
        const result = await client.deleteObject(space, page, class_name, object_number);
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({ class_name, object_number, ...result }, null, 2),
          }],
        };
      } catch (err) {
        const msg = err instanceof XWikiError ? err.message : String(err);
        return {
          content: [{ type: 'text', text: `Error deleting object: ${msg}` }],
          isError: true,
        };
      }
    },
  );
}
