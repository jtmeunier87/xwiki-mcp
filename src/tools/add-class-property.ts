import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { XWikiClient } from '../client.js';
import { XWikiError } from '../client.js';

export function register(server: McpServer, client: XWikiClient): void {
  server.tool(
    'xwiki_add_class_property',
    'Add a new property to an XWiki class, optionally with attributes such as prettyName or hint. Existing objects of the class get the property empty. The class is read back to confirm.',
    {
      class_name: z.string().describe('Fully qualified class name (e.g. "Sandbox.Code.ExampleClass")'),
      property: z.string().describe('New property name: letters and digits, no spaces (e.g. "dueDate")'),
      type: z.string().describe('Property type as xwiki_get_class shows it, e.g. String, TextArea, Number, Boolean, Date, StaticList, DBList, Page, Users'),
      attributes: z.record(z.string(), z.string()).optional().describe('Attributes to set after adding, e.g. {"prettyName": "Due date", "hint": "Date the work is due"}'),
    },
    async ({ class_name, property, type, attributes }) => {
      try {
        const result = await client.addClassProperty(class_name, property, type, attributes ?? {});
        return { content: [{ type: 'text', text: JSON.stringify(result) }] };
      } catch (err) {
        const msg = err instanceof XWikiError ? err.message : String(err);
        return { content: [{ type: 'text', text: `Error adding class property: ${msg}` }], isError: true };
      }
    },
  );
}
