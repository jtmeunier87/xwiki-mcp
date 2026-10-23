import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/server';
import { XWikiError } from '../client.js';
import type { XWikiClient } from '../client.js';

export function register(server: McpServer, client: XWikiClient): void {
  server.registerTool(
    'xwiki_move_attachment',
    {
      description: `Move or rename an attachment, on the same page or to another page, as the wiki's attachment Move action does. The attachment keeps its history. update_references (default true) rewrites links and images that point to it; auto_redirect (default false) leaves a redirect at the old name. Fails if the target name is taken. Needs edit right on both pages. Waits for the move to finish, then reads the target back.`,
      inputSchema: z.object({
        space: z.string().describe('Space name. Use dot notation for nested spaces: "Docs.Guides"'),
        page: z.string().describe('Page name (e.g. "WebHome")'),
        filename: z.string().describe('Current attachment file name (e.g. "diagram.png")'),
        target_space: z.string().describe('Space of the target page (same as space to keep it on this page)'),
        target_page: z.string().describe('Target page name (same as page to keep it on this page)'),
        target_filename: z.string().describe('New file name (same as filename to only change page)'),
        update_references: z.boolean().default(true).describe('Update links and images that point to it (default true)'),
        auto_redirect: z.boolean().default(false).describe('Leave a redirect at the old name (default false)'),
      }),
    },
    async ({ space, page, filename, target_space, target_page, target_filename, update_references, auto_redirect }) => {
      try {
        const result = await client.moveAttachment(space, page, filename, target_space, target_page, target_filename, {
          updateReferences: update_references,
          autoRedirect: auto_redirect,
        });
        return { content: [{ type: 'text', text: JSON.stringify(result) }] };
      } catch (e) {
        const msg =
          e instanceof XWikiError && e.status === 404
            ? `Attachment not found: ${space}/${page}@${filename}`
            : e instanceof Error
              ? e.message
              : String(e);
        return { content: [{ type: 'text', text: msg }], isError: true };
      }
    },
  );
}
