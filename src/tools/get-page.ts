import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/server';
import { XWikiError } from '../client.js';
import type { XWikiClient } from '../client.js';
import { pagingShape, pageOf } from './paging.js';

export function register(server: McpServer, client: XWikiClient): void {
  server.registerTool(
    'xwiki_get_page',
    {
      description:
        'Get the content and metadata of a wiki page. Content is raw wiki markup (e.g. xwiki/2.1). Long content is returned in windows of max_chars characters: when content_truncated is true, call again with offset = next_offset for the rest.',
      inputSchema: z.object({
        space: z.string().describe('Space name. Use dot notation for nested spaces: "Space1.SubSpace"'),
        page: z.string().describe('Page name (e.g. "WebHome", "MyPage")'),
        offset: z.number().int().min(0).default(0).describe('First character of content to return (default 0)'),
        max_chars: z
          .number()
          .int()
          .min(1000)
          .max(200000)
          .default(40000)
          .describe('Most content characters to return (default 40000, about 10k tokens)'),
      }),
    },
    async ({ space, page, offset, max_chars }) => {
      try {
        const result = await client.getPage(space, page);
        const total = result.content.length;
        const end = Math.min(total, offset + max_chars);
        const windowed = {
          ...result,
          content: result.content.slice(offset, end),
          ...(offset > 0 || end < total
            ? {
                content_truncated: end < total,
                content_offset: offset,
                content_total_chars: total,
                ...(end < total ? { next_offset: end } : {}),
              }
            : {}),
        };
        return { content: [{ type: 'text', text: JSON.stringify(windowed) }] };
      } catch (e) {
        const msg =
          e instanceof XWikiError && e.status === 404 ? `Page not found: ${space}/${page}` : e instanceof Error ? e.message : String(e);
        return { content: [{ type: 'text', text: msg }], isError: true };
      }
    },
  );
}
