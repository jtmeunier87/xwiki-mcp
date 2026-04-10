import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { XWikiClient } from '../client.js';
import { XWikiError } from '../client.js';

export function register(server: McpServer, client: XWikiClient): void {
  server.tool(
    'get_class',
    'Get the full definition of a single XWiki class including all its properties, types, and attributes. Use list_classes first to discover available class names.',
    {
      class_name: z.string().describe('Fully qualified class name (e.g. "XWiki.XWikiUsers" or "Administration Hub.Sales.Customer Profile.Code.ClientClass")'),
    },
    async ({ class_name }) => {
      try {
        const xwikiClass = await client.getClass(class_name);
        return {
          content: [{
            type: 'text',
            text: JSON.stringify(xwikiClass, null, 2),
          }],
        };
      } catch (err) {
        const msg = err instanceof XWikiError ? err.message : String(err);
        return {
          content: [{ type: 'text', text: `Error fetching class: ${msg}` }],
          isError: true,
        };
      }
    },
  );
}
