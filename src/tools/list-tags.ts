import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { XWikiClient } from '../client.js';
import { pagingShape, pageOf } from './paging.js';

export function register(server: McpServer, client: XWikiClient): void {
  server.tool(
    'xwiki_list_tags',
    'List the tags used anywhere in the wiki, paged with start / limit. Use it to find tags before calling xwiki_list_pages_by_tag.',
    { ...pagingShape },
    async ({ start, limit }) => {
      const { items, _pagination } = pageOf(await client.getAllWikiTags(), start, limit);
      return { content: [{ type: 'text', text: JSON.stringify({ tags: items, _pagination }) }] };
    },
  );
}
