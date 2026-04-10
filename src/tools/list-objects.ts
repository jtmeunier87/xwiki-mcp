import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { XWikiClient } from '../client.js';
import { XWikiError } from '../client.js';

export function register(server: McpServer, client: XWikiClient): void {
  server.tool(
    'list_objects',
    'List all XObjects attached to a page. Optionally filter by class name. Returns object numbers and properties.',
    {
      space: z.string().describe('Space name in dot notation (e.g. "Main" or "Administration Hub.Sales")'),
      page: z.string().describe('Page name (e.g. "WebHome")'),
      class_name: z.string().optional().describe('Optional class name to filter by (e.g. "XWiki.XWikiComments"). If omitted, returns all objects on the page.'),
    },
    async ({ space, page, class_name }) => {
      try {
        const objects = await client.listObjects(space, page, class_name);
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({ objects, count: objects.length }, null, 2),
          }],
        };
      } catch (err) {
        const msg = err instanceof XWikiError ? err.message : String(err);
        return {
          content: [{ type: 'text', text: `Error listing objects: ${msg}` }],
          isError: true,
        };
      }
    },
  );
}
