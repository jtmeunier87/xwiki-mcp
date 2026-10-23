import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/server';
import { XWikiError } from '../client.js';
import type { XWikiClient } from '../client.js';
import { pagingShape, pageOf } from './paging.js';

export function register(server: McpServer, client: XWikiClient): void {
  server.registerTool(
    'xwiki_list_page_children',
    {
      description:
        'List the direct child pages of a wiki page, paged with start / limit. For every descendant in one call use xwiki_get_page_tree. ' +
        "Hidden pages (e.g. class, sheet and template pages) are listed only when the xWiki account's Display Hidden Pages preference is on; xWiki's REST API has no option to include them otherwise.",
      inputSchema: z.object({
        space: z.string().describe('Space name. Use dot notation for nested spaces: "Space1.SubSpace"'),
        page: z.string().describe('Parent page name'),
        ...pagingShape,
      }),
    },
    async ({ space, page, start, limit }) => {
      try {
        const { items, _pagination } = pageOf(await client.getPageChildren(space, page), start, limit);
        return { content: [{ type: 'text', text: JSON.stringify({ children: items, _pagination }) }] };
      } catch (e) {
        const msg =
          e instanceof XWikiError && e.status === 404 ? `Page not found: ${space}/${page}` : e instanceof Error ? e.message : String(e);
        return { content: [{ type: 'text', text: msg }], isError: true };
      }
    },
  );
}
