// Integration tests against a real XWiki (npm run test:integration).
// Needs XWIKI_IT_URL, XWIKI_IT_USER and XWIKI_IT_PASSWORD for an admin account, and a built
// server (npm run build). Everything is written under a fresh space IT.Run<timestamp>.
// CI starts the official XWiki Docker image for this (.github/workflows/integration.yml).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { Client } from '@modelcontextprotocol/client';

const URL_ = process.env.XWIKI_IT_URL ?? '';
const RUN = `IT.Run${Date.now()}`;
// 1x1 PNG
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC';

let client: Client;

type Content = Array<{ type: string; text?: string }>;

/** Call a tool and return its JSON result; fail the test on a tool error. */
async function call(name: string, args: Record<string, unknown> = {}): Promise<any> {
  const r = (await client.callTool({ name, arguments: args })) as { content: Content; isError?: boolean };
  const text = r.content.find(c => c.type === 'text')?.text ?? '';
  if (r.isError) throw new Error(`${name} failed: ${text}`);
  try {
    return JSON.parse(text);
  } catch {
    return { text, content: r.content };
  }
}

/** Call a tool that is expected to fail; return its error text. */
async function callError(name: string, args: Record<string, unknown>): Promise<string> {
  const r = (await client.callTool({ name, arguments: args })) as { content: Content; isError?: boolean };
  expect(r.isError).toBe(true);
  return r.content[0]?.text ?? '';
}

/** Retry a read until check passes (search indexes lag behind writes); return its last value. */
async function eventually<T>(read: () => Promise<T>, check: (v: T) => boolean, ms = 60000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await read();
    if (check(v) || Date.now() > end) return v;
    await new Promise(r => setTimeout(r, 2000));
  }
}

const page = (space: string, name: string, content = name) =>
  call('xwiki_create_page', { space: `${RUN}.${space}`, page: name, title: name, content });

describe.skipIf(!URL_)('live XWiki', () => {
  beforeAll(async () => {
    const transport = new StdioClientTransport({
      command: 'node',
      args: ['dist/index.js'],
      env: {
        ...(process.env as Record<string, string>),
        XWIKI_BASE_URL: URL_,
        XWIKI_USERNAME: process.env.XWIKI_IT_USER ?? 'superadmin',
        XWIKI_PASSWORD: process.env.XWIKI_IT_PASSWORD ?? '',
        XWIKI_MCP_ALLOW_DELETE: 'true',
        XWIKI_MCP_RATE_LIMIT: '0',
        XWIKI_MCP_LOG_CALLS: 'false',
      },
      stderr: 'inherit',
    });
    client = new Client({ name: 'xwiki-mcp-integration', version: '1' });
    await client.connect(transport);
  });

  afterAll(async () => {
    await client?.close();
  });

  it('creates, reads and windows a page', async () => {
    await page('Pages', 'Long', 'x'.repeat(3000));
    const first = await call('xwiki_get_page', { space: `${RUN}.Pages`, page: 'Long', max_chars: 1000 });
    expect(first.content).toHaveLength(1000);
    expect(first).toMatchObject({ content_truncated: true, next_offset: 1000, content_total_chars: 3000 });
    expect(first.modified_date).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('copies and renames a terminal page', async () => {
    await page('Pages', 'Source');
    const copy = await call('xwiki_copy_page', {
      space: `${RUN}.Pages`,
      page: 'Source',
      target_space: `${RUN}.Pages`,
      target_page: 'SourceCopy',
    });
    expect(copy.status).toBe('copied');
    expect((await call('xwiki_get_page', { space: `${RUN}.Pages`, page: 'SourceCopy' })).content).toBe('Source');

    await call('xwiki_move_page', { space: `${RUN}.Pages`, page: 'Source', target_space: `${RUN}.Pages`, target_page: 'Renamed' });
    expect((await call('xwiki_get_page', { space: `${RUN}.Pages`, page: 'Renamed' })).content).toBe('Source');
    expect(await callError('xwiki_get_page', { space: `${RUN}.Pages`, page: 'Source' })).toContain('not found');
  });

  it('moves a nested page with its children', async () => {
    await call('xwiki_create_page', { space: `${RUN}.Nest`, page: 'WebHome', title: 'Nest', content: 'n' });
    await call('xwiki_create_page', { space: `${RUN}.Nest.Child`, page: 'WebHome', title: 'Child', content: 'c' });
    const moved = await call('xwiki_move_page', {
      space: `${RUN}.Nest`,
      page: 'WebHome',
      target_space: `${RUN}.Moved`,
      target_page: 'WebHome',
    });
    expect(moved.children_moved).toBe(true);
    expect((await call('xwiki_get_page', { space: `${RUN}.Moved.Child`, page: 'WebHome' })).content).toBe('c');
    const tree = await call('xwiki_get_page_tree', { space: `${RUN}.Moved`, page: 'WebHome', hierarchy: 'nestedpages' });
    expect(tree.pages.map((p: { reference: string }) => p.reference)).toEqual([`${RUN}.Moved.Child.WebHome`]);
    // The root page has its own row, with its own objects
    await call('xwiki_add_tags', { space: `${RUN}.Moved`, page: 'WebHome', tags: ['tree-root'] });
    const withRoot = await call('xwiki_get_page_tree', { space: `${RUN}.Moved`, page: 'WebHome', hierarchy: 'nestedpages' });
    expect(withRoot.root_page).toMatchObject({ reference: `${RUN}.Moved.WebHome`, level: 0, child_count: 1 });
    expect(withRoot.root_page.classes['XWiki.TagClass']).toBe(1);
  });

  it('deletes a page, lists it in the recycle bin and restores it', async () => {
    await page('Bin', 'Gone');
    await call('xwiki_delete_page', { space: `${RUN}.Bin`, page: 'Gone' });
    const bin = await call('xwiki_list_deleted_pages', { name: `${RUN}.Bin.Gone` });
    const entry = bin.pages.find((p: { page: string }) => p.page === `${RUN}.Bin.Gone`);
    expect(entry?.id).toBeGreaterThan(0);
    await call('xwiki_restore_deleted_page', { space: `${RUN}.Bin`, page: 'Gone', id: entry.id });
    expect((await call('xwiki_get_page', { space: `${RUN}.Bin`, page: 'Gone' })).content).toBe('Gone');
  });

  it('uploads, versions, downloads, moves and searches attachments', async () => {
    await page('Files', 'A');
    await page('Files', 'B');
    await call('xwiki_upload_attachment', {
      space: `${RUN}.Files`,
      page: 'A',
      filename: 'dot.png',
      content_base64: PNG,
      mime_type: 'image/png',
    });
    const listed = await call('xwiki_list_attachments', { space: `${RUN}.Files`, page: 'A' });
    expect(listed._pagination.total).toBe(1);
    const versions = await call('xwiki_list_attachment_versions', { space: `${RUN}.Files`, page: 'A', filename: 'dot.png' });
    expect(versions.versions.length).toBeGreaterThan(0);

    const download = (await client.callTool({
      name: 'xwiki_download_attachment',
      arguments: { space: `${RUN}.Files`, page: 'A', filename: 'dot.png' },
    })) as { content: Content };
    expect(download.content[0].type).toBe('image');

    const moved = await call('xwiki_move_attachment', {
      space: `${RUN}.Files`,
      page: 'A',
      filename: 'dot.png',
      target_space: `${RUN}.Files`,
      target_page: 'B',
      target_filename: 'moved.png',
    });
    expect(moved.status).toBe('moved');
    expect(
      (await call('xwiki_list_attachments', { space: `${RUN}.Files`, page: 'B' })).attachments.map((a: { name: string }) => a.name),
    ).toEqual(['moved.png']);
  });

  it('edits classes and objects', async () => {
    const cls = `${RUN}.Code.TestClass`;
    await call('xwiki_add_class_property', { class_name: cls, property: 'status', type: 'String', attributes: { prettyName: 'Status' } });
    expect((await call('xwiki_set_class_property_enabled', { class_name: cls, property: 'status', enabled: false })).confirmed).toBe(true);
    expect((await call('xwiki_set_class_property_enabled', { class_name: cls, property: 'status', enabled: true })).status).toBe('enabled');

    await page('Data', 'Record');
    await call('xwiki_create_object', { space: `${RUN}.Data`, page: 'Record', class_name: cls, properties: { status: 'open' } });
    await call('xwiki_update_object', {
      space: `${RUN}.Data`,
      page: 'Record',
      class_name: cls,
      object_number: 0,
      properties: { status: 'done' },
    });
    const all = await call('xwiki_list_class_objects', { class_name: cls });
    expect(all.objects).toHaveLength(1);
    expect(all.objects[0]).toMatchObject({ page: `${RUN}.Data.Record`, properties: { status: 'done' } });
    const onPage = await call('xwiki_list_page_objects', { space: `${RUN}.Data`, page: 'Record', class_name: cls });
    expect(onPage.objects).toEqual([expect.objectContaining({ class_name: cls, number: 0, properties: { status: 'done' } })]);
  });

  it('edits page content and an object property in place', async () => {
    const sp = `${RUN}.Edit`;
    await page('Edit', 'Sheet', '{{velocity}}\n#set($layout = "grid-3x2")\n$layout\n{{/velocity}}');
    const before = await call('xwiki_get_page', { space: sp, page: 'Sheet' });
    const r = await call('xwiki_replace_in_page', {
      space: sp, page: 'Sheet', expected_version: before.version,
      edits: [{ old_text: '"grid-3x2"', new_text: '"grid-2"' }],
    });
    expect(r).toMatchObject({ status: 'updated', verified: true, previous_version: before.version });
    expect((await call('xwiki_get_page', { space: sp, page: 'Sheet' })).content).toContain('#set($layout = "grid-2")');
    expect(await callError('xwiki_replace_in_page', {
      space: sp, page: 'Sheet', expected_version: before.version, edits: [{ old_text: 'grid-2', new_text: 'x' }],
    })).toMatch(/changed since you read it/);
    expect(await callError('xwiki_replace_in_page', { space: sp, page: 'Sheet', edits: [{ old_text: 'missing', new_text: 'x' }] })).toMatch(/Nothing saved/);

    await call('xwiki_create_object', { space: sp, page: 'Sheet', class_name: 'XWiki.StyleSheetExtension', properties: { code: '.a { color: red; }\n.b { color: red; }' } });
    const o = await call('xwiki_replace_in_page', {
      space: sp, page: 'Sheet', class_name: 'XWiki.StyleSheetExtension', object_number: 0, property: 'code',
      edits: [{ old_text: '.b { color: red; }', new_text: '.b { color: blue; }' }],
    });
    expect(o).toMatchObject({ verified: true, target: 'XWiki.StyleSheetExtension[0].code' });
    const code = await call('xwiki_get_object_property', { space: sp, page: 'Sheet', class_name: 'XWiki.StyleSheetExtension', property_name: 'code' });
    expect(code.property.value).toBe('.a { color: red; }\n.b { color: blue; }');
  });

  it('renders a record page through its class sheet', async () => {
    // A record page with no content of its own, displayed by the sheet bound to its class:
    // the plain render must show the sheet's output, as a reader sees the page.
    const cls = `${RUN}.Code.TestClass`;
    await call('xwiki_create_page', {
      space: `${RUN}.Code`, page: 'TestSheet', title: 'TestSheet',
      content: "{{velocity}}Sheet shows $doc.getValue('status'){{/velocity}}",
    });
    await call('xwiki_create_object', { space: `${RUN}.Code`, page: 'TestClass', class_name: 'XWiki.ClassSheetBinding', properties: { sheet: `${RUN}.Code.TestSheet` } });
    await call('xwiki_create_page', { space: `${RUN}.Data`, page: 'Shown', title: 'Shown', content: '' });
    await call('xwiki_create_object', { space: `${RUN}.Data`, page: 'Shown', class_name: cls, properties: { status: 'shown' } });
    const plain = await call('xwiki_render_page', { space: `${RUN}.Data`, page: 'Shown' });
    expect(plain.text).toContain('Sheet shows shown');
    const html = await call('xwiki_render_page', { space: `${RUN}.Data`, page: 'Shown', output: 'html' });
    expect(html.text).toContain('Sheet shows shown');
  });

  it('keeps tags and comments in step', async () => {
    await page('Social', 'Post');
    await call('xwiki_add_tags', { space: `${RUN}.Social`, page: 'Post', tags: ['a', 'b', 'c'] });
    expect((await call('xwiki_remove_tags', { space: `${RUN}.Social`, page: 'Post', tags: ['b'] })).tags).toEqual(['a', 'c']);
    const comment = await call('xwiki_add_comment', { space: `${RUN}.Social`, page: 'Post', text: 'first' });
    expect((await call('xwiki_update_comment', { space: `${RUN}.Social`, page: 'Post', id: comment.id, text: 'edited' })).text).toBe(
      'edited',
    );
  });

  it('compares and rolls back versions', async () => {
    await page('History', 'Doc', 'one');
    await call('xwiki_update_page', { space: `${RUN}.History`, page: 'Doc', content: 'one\ntwo' });
    // A save that changes no content: the current version's date must still be its own.
    await new Promise(r => setTimeout(r, 3000));
    await call('xwiki_add_tags', { space: `${RUN}.History`, page: 'Doc', tags: ['t'] });
    const versions = await call('xwiki_list_page_versions', { space: `${RUN}.History`, page: 'Doc' });
    const oldest = versions.history[versions.history.length - 1].version;
    const cmp = await call('xwiki_compare_page_versions', { space: `${RUN}.History`, page: 'Doc', from_version: oldest });
    expect(cmp).toMatchObject({ lines_added: 1, lines_removed: 0 });
    expect(cmp.to).toMatchObject({ version: versions.history[0].version, date: versions.history[0].modified_date });
    expect(cmp.to.date).not.toBe(versions.history[1].modified_date);
    expect(await callError('xwiki_list_page_versions', { space: `${RUN}.History`, page: 'Missing' })).toBe(
      `Page not found: ${RUN}.History/Missing`,
    );
    await call('xwiki_rollback_page', { space: `${RUN}.History`, page: 'Doc', version: oldest });
    expect((await call('xwiki_get_page', { space: `${RUN}.History`, page: 'Doc' })).content).toBe('one');
  });

  it('renders and exports', async () => {
    expect((await call('xwiki_render_page', { space: `${RUN}.Moved.Child`, page: 'WebHome' })).text ?? '').toContain('c');
    const xar = (await client.callTool({
      name: 'xwiki_export_page',
      arguments: { space: `${RUN}.Moved`, page: 'WebHome', format: 'xar', children: true },
    })) as { content: Content };
    expect(xar.content[0].type).toBe('resource');
    const html = await call('xwiki_export_page', { space: `${RUN}.Moved`, page: 'WebHome', format: 'html' });
    expect(html.pages).toHaveLength(1);
    expect(html.pages[0].html).toContain('n');
    expect(html.pages[0].html).not.toContain('<script');
    expect(html.pages[0].html.length).toBeLessThan(2000);
  });

  it('searches one space only', async () => {
    const word = `needle${Date.now()}`;
    await page('Find', 'Here', word);
    await page('Elsewhere', 'There', word);
    const found = await eventually(
      () => call('xwiki_search_pages', { query: word, space: `${RUN}.Find` }),
      r => r.results.length > 0,
    );
    expect(found.results.map((r: { id: string }) => r.id)).toEqual([`xwiki:${RUN}.Find.Here`]);
  });

  it('answers a solr query and reports a refused query type clearly', async () => {
    const solr = await call('xwiki_query', { query: 'type:DOCUMENT', limit: 5 });
    expect(Array.isArray(solr.results)).toBe(true);
    const r = (await client.callTool({ name: 'xwiki_query', arguments: { query: 'where 1=1', type: 'xwql' } })) as {
      content: Content;
      isError?: boolean;
    };
    if (r.isError) expect(r.content[0].text).toContain('Query type [xwql] is not allowed');
  });

  it('analyses required rights, or reports the known XWiki-side error', async () => {
    await page('Rights', 'Script', '{{velocity}}$xcontext.user{{/velocity}}');
    const r = (await client.callTool({ name: 'xwiki_get_required_rights', arguments: { space: `${RUN}.Rights`, page: 'Script' } })) as {
      content: Content;
      isError?: boolean;
    };
    const text = r.content[0]?.text ?? '';
    if (r.isError) {
      // Seen on the 17.10 and 18.8 Docker images: XWiki's own endpoint fails for every page.
      expect(text).toContain('Malformed URL: the spaces section is invalid');
      console.warn('xwiki_get_required_rights: XWiki answered "Malformed URL" (known XWiki-side issue)');
    } else {
      expect(JSON.parse(text)).toHaveProperty('declared');
    }
  });
});
