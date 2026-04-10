import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { XWikiClient } from '../client.js';

export function register(server: McpServer, client: XWikiClient): void {
  server.tool(
    'get_object_property',
    `Read a single named property from an XObject on a page. More efficient than get_object when you only need one field.

Use this for:
- Status checks: read just the "status" property of a task object
- Existence checks: verify a specific field value without fetching the whole object
- Conditional logic: branch based on a single property value

Use get_class to discover property names for a class.`,
    {
      space: z.string().describe("Wiki space name (e.g. 'Main')"),
      page: z.string().describe("Page name (e.g. 'WebHome')"),
      class_name: z.string().describe("Fully-qualified class name (e.g. 'Administration Hub.Sales.Customer Profile.Code.ClientClass')"),
      object_number: z.number().int().min(0).default(0).describe('Object index on the page (0-based, default 0)'),
      property_name: z.string().describe("Property name to read (e.g. 'status', 'title', 'UUID')"),
    },
    async ({ space, page, class_name, object_number, property_name }) => {
      const prop = await client.getObjectProperty(space, page, class_name, object_number, property_name);
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({ space, page, class_name, object_number, property: prop }, null, 2),
        }],
      };
    },
  );
}
