import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import type { XWikiClient } from '../client.js';
import { pagingShape, pageOf } from './paging.js';

export function register(server: McpServer, client: XWikiClient): void {
  server.registerTool(
    'xwiki_list_tags',
    {
      description:
        'List the tags used anywhere in the wiki, paged with start / limit. Use it to find tags before calling xwiki_list_pages_by_tag.',
      inputSchema: z.object({ ...pagingShape }),
    },
    async ({ start, limit }) => {
      const { items, _pagination } = pageOf(await client.getAllWikiTags(), start, limit);
      return { content: [{ type: 'text', text: JSON.stringify({ tags: items, _pagination }) }] };
    },
  );
}
