import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/server';
import { XWikiError } from '../client.js';
import type { XWikiClient } from '../client.js';

export function register(server: McpServer, client: XWikiClient): void {
  server.registerTool(
    'xwiki_update_page',
    {
      description:
        'Update an existing wiki page by replacing its whole content, its title, or both. ' +
        'Fields not provided will be preserved from the current version. ' +
        'At least one of content or title must be provided. ' +
        'Pass expected_version (the version you read) so the update is refused if someone changed the page since. ' +
        'To change only part of the content (e.g. a few lines of a long page or script), use xwiki_replace_in_page instead.',
      inputSchema: z.object({
        space: z.string().describe('Space name. Use dot notation for nested spaces: "Space1.SubSpace"'),
        page: z.string().describe('Page name (e.g. "WebHome", "MyPage")'),
        content: z.string().optional().describe('New page content in wiki markup. If omitted, current content is preserved.'),
        title: z.string().optional().describe('New display title. If omitted, current title is preserved.'),
        syntax: z.string().optional().describe('Content syntax override (e.g. "xwiki/2.1", "markdown/1.2")'),
        expected_version: z
          .string()
          .optional()
          .describe('Page version you read (e.g. "12.1"); the update is refused if the page is now at another version'),
      }),
    },
    async ({ space, page, content, title, syntax, expected_version }) => {
      if (!content && !title) {
        return {
          content: [{ type: 'text', text: 'At least one of "content" or "title" must be provided.' }],
          isError: true,
        };
      }
      try {
        const result = await client.updatePage(space, page, content, title, syntax, expected_version);
        return { content: [{ type: 'text', text: JSON.stringify(result) }] };
      } catch (e) {
        const msg =
          e instanceof XWikiError && e.status === 404
            ? `Page not found: ${space}/${page}. Use create_page to create it.`
            : e instanceof Error
              ? e.message
              : String(e);
        return { content: [{ type: 'text', text: msg }], isError: true };
      }
    },
  );
}
