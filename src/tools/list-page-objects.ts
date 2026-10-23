import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import type { XWikiClient } from '../client.js';
import { pagingShape, pageOf } from './paging.js';
import { XWikiError } from '../client.js';

export function register(server: McpServer, client: XWikiClient): void {
  server.registerTool(
    'xwiki_list_page_objects',
    {
      description:
        'List the XObjects on a page with their class, number and properties, optionally for one class only. Paged with start / limit. For the objects of one class across the wiki use xwiki_list_class_objects.',
      inputSchema: z.object({
        space: z.string().describe('Space name in dot notation (e.g. "Main" or "Docs.Guides")'),
        page: z.string().describe('Page name (e.g. "WebHome")'),
        class_name: z
          .string()
          .optional()
          .describe('Optional class name to filter by (e.g. "XWiki.XWikiComments"). If omitted, returns all objects on the page.'),
        ...pagingShape,
      }),
    },
    async ({ space, page, class_name, start, limit }) => {
      try {
        const { items, _pagination } = pageOf(await client.listObjects(space, page, class_name), start, limit);
        return { content: [{ type: 'text', text: JSON.stringify({ objects: items, _pagination }) }] };
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
