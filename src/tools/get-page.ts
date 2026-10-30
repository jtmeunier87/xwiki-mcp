import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/server';
import { XWikiError } from '../client.js';
import type { XWikiClient } from '../client.js';
import { outline as headings, section as sectionOf } from '../outline.js';

export function register(server: McpServer, client: XWikiClient): void {
  server.registerTool(
    'xwiki_get_page',
    {
      description:
        'Get the content and metadata of a wiki page. Content is raw wiki markup (e.g. xwiki/2.1). Long content is returned in windows of max_chars characters: when content_truncated is true, call again with offset = next_offset for the rest.\n\n' +
        'For a long page, read its map first: outline: true returns the headings instead of the content, each with its number n, level, title, line, end_line and chars (the section\'s size, subsections included). Then section: n returns only that section (its heading and subsections included), windowed the same way. Headings inside code blocks are not counted.',
      inputSchema: z.object({
        space: z.string().describe('Space name. Use dot notation for nested spaces: "Space1.SubSpace"'),
        page: z.string().describe('Page name (e.g. "WebHome", "MyPage")'),
        outline: z.boolean().default(false).describe('Return the heading outline instead of the content (default false)'),
        section: z.number().int().min(1).optional().describe('Return only this section: its n from the outline'),
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
    async ({ space, page, outline, section, offset, max_chars }) => {
      const fail = (text: string) => ({ content: [{ type: 'text' as const, text }], isError: true });
      if (outline && section) return fail('Give either "outline" or "section", not both.');
      try {
        const result = await client.getPage(space, page);
        if (outline) {
          const { content, ...meta } = result;
          const out = { ...meta, content_total_chars: content.length, content_total_lines: content.split('\n').length, outline: headings(content, result.syntax) };
          return { content: [{ type: 'text', text: JSON.stringify(out) }] };
        }
        let text = result.content;
        let picked: object = {};
        if (section) {
          const s = sectionOf(result.content, result.syntax, section);
          if (!s) return fail(`Page ${space}/${page} has no section ${section}. Call with outline: true to list its sections.`);
          text = s.content;
          picked = { section: s.heading };
        }
        const total = text.length;
        const end = Math.min(total, offset + max_chars);
        const windowed = {
          ...result,
          ...picked,
          content: text.slice(offset, end),
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
