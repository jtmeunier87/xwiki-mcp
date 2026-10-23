import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/server';
import { XWikiError } from '../client.js';
import type { XWikiClient } from '../client.js';

export function register(server: McpServer, client: XWikiClient): void {
  server.registerTool(
    'xwiki_list_class_objects',
    {
      description: `List the objects of one class across the whole wiki, with the page each one is on and its property values.

Use it to read every record of a class in one paged call instead of searching for pages and reading each object. Results are ordered by page then object number (or by page modification date, newest first, with order: "date"). Pages the account cannot view are left out, so a page of results can be shorter than limit; keep paging while has_more is true.

include_properties (default true) reads each object in full, one extra request per object; set it to false for just page, object number and headline (the first property's value).`,
      inputSchema: z.object({
        class_name: z.string().describe('Full class name (e.g. "Sandbox.Code.ExampleClass", "XWiki.XWikiUsers")'),
        start: z.number().int().min(0).default(0).describe('Offset for pagination (default 0)'),
        limit: z.number().int().min(1).max(500).default(50).describe('Objects per call (default 50)'),
        order: z
          .enum(['page', 'date'])
          .default('page')
          .describe('page (default): by page name; date: by page modification date, newest first'),
        include_properties: z.boolean().default(true).describe('Include every property value (one request per object; default true)'),
      }),
    },
    async ({ class_name, start, limit, order, include_properties }) => {
      try {
        const { objects, pagination } = await client.listClassObjects(class_name, start, limit, order, include_properties);
        return {
          content: [{ type: 'text', text: JSON.stringify({ class_name, count: objects.length, objects, _pagination: pagination }) }],
        };
      } catch (e) {
        const msg =
          e instanceof XWikiError && e.status === 404 ? `Class not found: ${class_name}` : e instanceof Error ? e.message : String(e);
        return { content: [{ type: 'text', text: msg }], isError: true };
      }
    },
  );
}
