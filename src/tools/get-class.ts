import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import type { XWikiClient } from '../client.js';
import { XWikiError } from '../client.js';

export function register(server: McpServer, client: XWikiClient): void {
  server.registerTool(
    'xwiki_get_class',
    {
      description:
        'Get the full definition of a single XWiki class: each property with its type and non-empty attributes (e.g. prettyName, and for StaticList properties the allowed "values" and "multiSelect"). Use xwiki_list_classes first to discover available class names.',
      inputSchema: z.object({
        class_name: z.string().describe('Fully qualified class name (e.g. "XWiki.XWikiUsers" or "Sandbox.Code.ExampleClass")'),
      }),
    },
    async ({ class_name }) => {
      try {
        const xwikiClass = await client.getClass(class_name);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(xwikiClass),
            },
          ],
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
