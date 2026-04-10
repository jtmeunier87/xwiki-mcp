import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { XWikiClient } from '../client.js';
import { XWikiError } from '../client.js';

export function register(server: McpServer, client: XWikiClient): void {
  server.tool(
    'create_object',
    'Create a new XObject of a given class on a page. Use list_classes and get_class to discover available class names and their property schemas before calling this.',
    {
      space: z.string().describe('Space name in dot notation (e.g. "Main" or "Administration Hub.Sales")'),
      page: z.string().describe('Page name (e.g. "WebHome")'),
      class_name: z.string().describe('Fully qualified class name (e.g. "Administration Hub.Sales.Customer Profile.Code.ClientClass")'),
      properties: z.record(z.string(), z.string()).describe('Key-value map of property names to string values (e.g. {"name": "Acme Corp", "status": "active"})'),
    },
    async ({ space, page, class_name, properties }) => {
      try {
        const result = await client.createObject(space, page, class_name, properties);
        return {
          content: [{
            type: 'text',
            text: JSON.stringify(result, null, 2),
          }],
        };
      } catch (err) {
        const msg = err instanceof XWikiError ? err.message : String(err);
        return {
          content: [{ type: 'text', text: `Error creating object: ${msg}` }],
          isError: true,
        };
      }
    },
  );
}
