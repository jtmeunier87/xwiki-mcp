import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/server';
import { XWikiError } from '../client.js';
import type { XWikiClient } from '../client.js';
import { pagingShape, pageOf } from './paging.js';

export function register(server: McpServer, client: XWikiClient): void {
  server.registerTool(
    'xwiki_list_attachments',
    {
      description:
        'List the files attached to a wiki page with name, size, media type, author, date and download URL. Paged with start / limit.',
      inputSchema: z.object({
        space: z.string().describe('Space name. Use dot notation for nested spaces: "Space1.SubSpace"'),
        page: z.string().describe('Page name'),
        ...pagingShape,
      }),
    },
    async ({ space, page, start, limit }) => {
      try {
        const { items, _pagination } = pageOf(await client.getAttachments(space, page), start, limit);
        return { content: [{ type: 'text', text: JSON.stringify({ attachments: items, _pagination }) }] };
      } catch (e) {
        const msg =
          e instanceof XWikiError && e.status === 404 ? `Page not found: ${space}/${page}` : e instanceof Error ? e.message : String(e);
        return { content: [{ type: 'text', text: msg }], isError: true };
      }
    },
  );
}
