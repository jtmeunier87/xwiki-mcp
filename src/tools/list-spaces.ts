import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { XWikiClient } from '../client.js';
import { pagingShape, pageOf } from './paging.js';

export function register(server: McpServer, client: XWikiClient): void {
  server.registerTool(
    'xwiki_list_spaces',
    { description: 'List the spaces in the wiki (nested spaces in dot notation), paged with start / limit.', inputSchema: { ...pagingShape } },
    async ({ start, limit }) => {
      try {
        const { items, _pagination } = pageOf(await client.listSpaces(), start, limit);
        return { content: [{ type: 'text', text: JSON.stringify({ spaces: items, _pagination }) }] };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return { content: [{ type: 'text', text: msg }], isError: true };
      }
    },
  );
}
