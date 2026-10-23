import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/server';
import { XWikiError } from '../client.js';
import type { XWikiClient } from '../client.js';

export function register(server: McpServer, client: XWikiClient): void {
  server.registerTool(
    'xwiki_set_class_property_enabled',
    {
      description: `Disable or enable a class property. A disabled property is hidden from the object editor and from new objects, but existing values are kept, so it is a safe alternative to deleting a field; enabling it shows the field again. Uses the class editor's /bin/propdisable/ and /bin/propenable/ actions. Needs edit right on the class page.`,
      inputSchema: z.object({
        class_name: z.string().describe('Full class name (e.g. "Sandbox.Code.ExampleClass")'),
        property: z.string().describe('Property name (e.g. "status")'),
        enabled: z.boolean().describe('false to disable the property, true to enable it again'),
      }),
    },
    async ({ class_name, property, enabled }) => {
      try {
        const result = await client.setClassPropertyEnabled(class_name, property, enabled);
        return { content: [{ type: 'text', text: JSON.stringify(result) }] };
      } catch (e) {
        const msg =
          e instanceof XWikiError && e.status === 404
            ? `Class or property not found: ${class_name}.${property}`
            : e instanceof Error
              ? e.message
              : String(e);
        return { content: [{ type: 'text', text: msg }], isError: true };
      }
    },
  );
}
