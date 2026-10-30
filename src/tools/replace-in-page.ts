import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/server';
import { XWikiError, staleVersionMessage } from '../client.js';
import type { XWikiClient } from '../client.js';
import { applyEdits, EditError } from '../edit.js';

export function register(server: McpServer, client: XWikiClient): void {
  server.registerTool(
    'xwiki_replace_in_page',
    {
      description:
        'Replace exact pieces of text in a page\'s content, or in one property of an object on the page ' +
        '(e.g. the code of a JavaScript / StyleSheet extension or a script stored in an object), without ' +
        'sending the whole text. Use this for targeted changes to long pages and code, such as Velocity or ' +
        'Groovy sheets; use xwiki_update_page or xwiki_update_object to replace a whole value.\n\n' +
        'Each old_text must occur exactly once in the current text (whitespace and line breaks included); ' +
        'edits apply in order and nothing is saved unless all of them match. With expected_version, the edit ' +
        'is refused if the page has changed since that version was read. The saved text is read back and ' +
        'checked. Saving content with scripts needs the rights the scripts need (see xwiki_get_required_rights).',
      inputSchema: z.object({
        space: z.string().describe('Space name. Use dot notation for nested spaces: "Space1.SubSpace"'),
        page: z.string().describe('Page name (e.g. "WebHome", "MyPage")'),
        edits: z
          .array(
            z.object({
              old_text: z.string().describe('Exact text to replace; must occur exactly once'),
              new_text: z.string().describe('Replacement text (empty string deletes old_text)'),
            }),
          )
          .min(1)
          .max(50)
          .describe('Replacements, applied in order, all or none'),
        class_name: z
          .string()
          .optional()
          .describe('Edit an object property instead of the page content: the object\'s class (e.g. "XWiki.JavaScriptExtension")'),
        object_number: z.number().int().min(0).default(0).describe('Object number within the class (default 0); with class_name'),
        property: z.string().optional().describe('Property to edit (e.g. "code"); required with class_name'),
        expected_version: z
          .string()
          .optional()
          .describe('Page version you read (e.g. "12.1"); the edit is refused if the page is now at another version'),
      }),
    },
    async ({ space, page, edits, class_name, object_number, property, expected_version }) => {
      const fail = (text: string) => ({ content: [{ type: 'text' as const, text }], isError: true });
      if (class_name && !property) return fail('Give "property" with "class_name".');
      if (property && !class_name) return fail('Give "class_name" with "property".');
      const target = class_name ? `${class_name}[${object_number}].${property}` : 'content';
      try {
        const current = await client.getPage(space, page);
        if (expected_version && current.version !== expected_version) {
          return fail(staleVersionMessage(space, page, current.version, expected_version));
        }
        const readTarget = async () => {
          if (!class_name) return (await client.getPage(space, page)).content ?? '';
          const p = await client.getObjectProperty(space, page, class_name, object_number, property!);
          return p.value == null ? '' : String(p.value);
        };
        const before = class_name ? await readTarget() : (current.content ?? '');
        const { text, changes } = applyEdits(before, edits);

        let version: string | undefined;
        if (class_name) {
          await client.updateObject(space, page, class_name, object_number, { [property!]: text });
        } else {
          version = (await client.updatePage(space, page, text)).version;
        }

        const saved = await readTarget();
        if (saved !== text) {
          return fail(
            `Saved ${target} of ${space}/${page}, but reading it back did not match the edited text ` +
              `(${saved.length} characters stored, ${text.length} expected). Check it with xwiki_get_page / xwiki_get_object_property.`,
          );
        }
        if (!version) version = (await client.getPage(space, page)).version;
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                status: 'updated',
                target,
                previous_version: current.version,
                version,
                verified: true,
                chars_before: before.length,
                chars_after: text.length,
                changes,
                url: current.url,
              }),
            },
          ],
        };
      } catch (e) {
        if (e instanceof EditError) return fail(`Nothing saved. ${e.message}`);
        if (e instanceof XWikiError && e.status === 404) {
          return fail(class_name ? `Not found: ${space}/${page} ${target}` : `Page not found: ${space}/${page}`);
        }
        return fail(e instanceof Error ? e.message : String(e));
      }
    },
  );
}
