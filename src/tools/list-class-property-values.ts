import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { XWikiError } from '../client.js';
import type { XWikiClient } from '../client.js';

export function register(server: McpServer, client: XWikiClient): void {
  server.registerTool(
    'xwiki_list_class_property_values',
    {
      description: `List the allowed values of a class property whose values come from elsewhere: a database list (DBList, DBTreeList) or a page, user or group picker. Each value has its label when it differs. filter narrows to values matching text (as the picker's search does). For a StaticList the values are in xwiki_get_class.`,
      inputSchema: {
        class_name: z.string().describe('Full class name (e.g. "Sandbox.Code.ExampleClass")'),
        property: z.string().describe('Property name'),
        filter: z.string().optional().describe('Only values matching this text'),
        limit: z.number().int().min(1).max(1000).default(100).describe('Maximum values (default 100)'),
      },
    },
    async ({ class_name, property, filter, limit }) => {
      try {
        const result = await client.getClassPropertyValues(class_name, property, filter, limit).then(values => ({ class_name, property, count: values.length, values }));
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (e) {
        const msg = e instanceof XWikiError && e.status === 404
          ? `Class or property not found: ${class_name}.${property}`
          : e instanceof Error ? e.message : String(e);
        return { content: [{ type: 'text', text: msg }], isError: true };
      }
    },
  );
}
