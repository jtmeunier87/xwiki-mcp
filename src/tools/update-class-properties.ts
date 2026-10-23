import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import type { XWikiClient } from '../client.js';
import { XWikiError } from '../client.js';

export function register(server: McpServer, client: XWikiClient): void {
  server.registerTool(
    'xwiki_update_class_properties',
    {
      description:
        'Change attributes of existing properties of an XWiki class, e.g. hint, prettyName, or the values of a StaticList. Only the attributes given change; the class is read back to confirm. Renaming a property is not supported. Use xwiki_get_class first to see property and attribute names.',
      inputSchema: z.object({
        class_name: z.string().describe('Fully qualified class name (e.g. "Sandbox.Code.ExampleClass")'),
        properties: z
          .record(z.string(), z.record(z.string(), z.string()))
          .describe(
            'Map of property name to the attributes to set, e.g. {"status": {"hint": "Current state"}, "title": {"prettyName": "Title"}}. Booleans are "1" or "0"; list values use the class separator, e.g. "Draft|Approved".',
          ),
      }),
    },
    async ({ class_name, properties }) => {
      try {
        const result = await client.updateClassProperties(class_name, properties);
        return { content: [{ type: 'text', text: JSON.stringify(result) }] };
      } catch (err) {
        const msg = err instanceof XWikiError ? err.message : String(err);
        return { content: [{ type: 'text', text: `Error updating class: ${msg}` }], isError: true };
      }
    },
  );
}
