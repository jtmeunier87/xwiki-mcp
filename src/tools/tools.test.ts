import { describe, it, expect, vi } from 'vitest';
import { pageOf } from './paging.js';
import { fileContent } from './files.js';

// The tool modules load the client, which reads its config at import; don't need real env vars.
vi.mock('../config.js', () => ({ config: { baseUrl: 'https://wiki.example.com', pageLimit: 50, maxFileBytes: 1024 } }));

describe('pageOf', () => {
  it('slices a list and reports the exact total', () => {
    const items = Array.from({ length: 7 }, (_, i) => i);
    expect(pageOf(items, 0, 3)).toEqual({ items: [0, 1, 2], _pagination: { total: 7, start: 0, limit: 3, has_more: true } });
    expect(pageOf(items, 6, 3)).toEqual({ items: [6], _pagination: { total: 7, start: 6, limit: 3, has_more: false } });
  });
});

describe('fileContent', () => {
  const base = { name: 'f', uri: 'https://wiki.example.com/f', content_base64: 'AAAA', size_bytes: 3 };

  it('returns a small image as image content', () => {
    expect(fileContent({ ...base, mime_type: 'image/png;charset=x' })[0]).toEqual({ type: 'image', data: 'AAAA', mimeType: 'image/png' });
  });

  it('returns other files as an embedded resource blob, never base64 text', () => {
    const [blob, meta] = fileContent({ ...base, mime_type: 'application/pdf' });
    expect(blob).toEqual({ type: 'resource', resource: { uri: 'https://wiki.example.com/f', mimeType: 'application/pdf', blob: 'AAAA' } });
    expect(JSON.parse((meta as { text: string }).text)).toEqual({ name: 'f', mime_type: 'application/pdf', size_bytes: 3, url: 'https://wiki.example.com/f' });
  });
});

/** Register one tool on a fake server and return its handler. */
function handlerOf(register: (server: never, client: never) => void, client: unknown) {
  let cb: ((args: Record<string, unknown>) => Promise<{ content: Array<{ text: string }>; isError?: boolean }>) | undefined;
  register({ registerTool: (_n: string, _c: unknown, f: typeof cb) => { cb = f; } } as never, client as never);
  return cb!;
}

describe('xwiki_list_page_objects', () => {
  const summaries = [
    { class_name: 'Sandbox.Code.ExampleClass', number: 0, properties: {} },
    { class_name: 'XWiki.TagClass', number: 0, properties: {} },
  ];
  const client = {
    listObjects: async () => summaries,
    withObjectProperties: async (_s: string, _p: string, objs: typeof summaries) =>
      objs.map(o => ({ ...o, properties: { name: `${o.class_name}#${o.number}` } })),
  };

  it('reads the property values of the listed objects', async () => {
    const { register } = await import('./list-page-objects.js');
    const r = await handlerOf(register, client)({ space: 'Main', page: 'WebHome', include_properties: true, start: 1, limit: 1 });
    expect(JSON.parse(r.content[0].text).objects).toEqual([{ class_name: 'XWiki.TagClass', number: 0, properties: { name: 'XWiki.TagClass#0' } }]);
  });

  it('leaves the empty properties out without include_properties', async () => {
    const { register } = await import('./list-page-objects.js');
    const r = await handlerOf(register, client)({ space: 'Main', page: 'WebHome', include_properties: false, start: 0, limit: 50 });
    expect(JSON.parse(r.content[0].text).objects[0]).toEqual({ class_name: 'Sandbox.Code.ExampleClass', number: 0 });
  });
});

describe('xwiki_list_page_versions', () => {
  it('reports a missing page as "Page not found"', async () => {
    const { register } = await import('./list-page-versions.js');
    const { XWikiError } = await import('../client.js');
    const client = { getPageHistory: async () => { throw new XWikiError('Not found: /spaces/Main/pages/Missing', 404); } };
    const r = await handlerOf(register, client)({ space: 'Main', page: 'Missing', limit: 20 });
    expect(r).toEqual({ content: [{ type: 'text', text: 'Page not found: Main/Missing' }], isError: true });
  });
});

describe('applyEdits', () => {
  it('applies edits in order and reports the line of each', async () => {
    const { applyEdits } = await import('../edit.js');
    const r = applyEdits('a\nb grid-3\nc', [
      { old_text: 'grid-3', new_text: 'grid-2' },
      { old_text: 'c', new_text: 'd' },
    ]);
    expect(r.text).toBe('a\nb grid-2\nd');
    expect(r.changes.map(c => c.line)).toEqual([2, 3]);
  });

  it('refuses a missing, repeated or empty old_text', async () => {
    const { applyEdits } = await import('../edit.js');
    expect(() => applyEdits('abc', [{ old_text: 'x', new_text: 'y' }])).toThrow(/not found/);
    expect(() => applyEdits('a a', [{ old_text: 'a', new_text: 'b' }])).toThrow(/occurs 2 times/);
    expect(() => applyEdits('abc', [{ old_text: '', new_text: 'y' }])).toThrow(/empty/);
    expect(() => applyEdits('abc', [])).toThrow(/at least one/);
  });
});

describe('xwiki_edit_page', () => {
  function fakeClient(content: string, version = '3.1') {
    const state = { content, version, prop: 'body { color: red; }', writes: 0 };
    return {
      state,
      getPage: async () => ({ title: 'T', content: state.content, syntax: 'xwiki/2.1', version: state.version, url: 'https://wiki.example.com/p' }),
      updatePage: async (_s: string, _p: string, c: string) => {
        state.content = c;
        state.writes++;
        state.version = '4.1';
        return { title: 'T', version: '4.1', url: '', status: 'updated' };
      },
      getObjectProperty: async () => ({ name: 'code', value: state.prop }),
      updateObject: async (_s: string, _p: string, cls: string, n: number, props: Record<string, string>) => {
        state.prop = props.code;
        state.writes++;
        state.version = '4.1';
        return { class_name: cls, number: n, status: 'updated' };
      },
    };
  }

  it('edits page content and reads it back', async () => {
    const { register } = await import('./edit-page.js');
    const c = fakeClient('{{velocity}}\n"layout":"grid-3x2"\n{{/velocity}}');
    const r = await handlerOf(register, c)({ space: 'Main', page: 'Sheet', object_number: 0, edits: [{ old_text: 'grid-3x2', new_text: 'grid-2' }] });
    expect(r.isError).toBeUndefined();
    expect(c.state.content).toBe('{{velocity}}\n"layout":"grid-2"\n{{/velocity}}');
    expect(JSON.parse(r.content[0].text)).toMatchObject({ status: 'updated', target: 'content', previous_version: '3.1', version: '4.1', verified: true, changes: [{ line: 2 }] });
  });

  it('edits one object property', async () => {
    const { register } = await import('./edit-page.js');
    const c = fakeClient('x');
    const r = await handlerOf(register, c)({
      space: 'Main', page: 'Style', class_name: 'XWiki.StyleSheetExtension', object_number: 0, property: 'code',
      edits: [{ old_text: 'red', new_text: 'blue' }],
    });
    expect(c.state.prop).toBe('body { color: blue; }');
    expect(JSON.parse(r.content[0].text).target).toBe('XWiki.StyleSheetExtension[0].code');
  });

  it('saves nothing when an edit does not match or the version moved on', async () => {
    const { register } = await import('./edit-page.js');
    const c = fakeClient('a b');
    const h = handlerOf(register, c);
    const miss = await h({ space: 'Main', page: 'P', object_number: 0, edits: [{ old_text: 'b', new_text: 'c' }, { old_text: 'zz', new_text: 'y' }] });
    expect(miss.isError).toBe(true);
    expect(miss.content[0].text).toMatch(/^Nothing saved\. Edit 2: old_text was not found/);
    const stale = await h({ space: 'Main', page: 'P', object_number: 0, expected_version: '2.1', edits: [{ old_text: 'b', new_text: 'c' }] });
    expect(stale.content[0].text).toMatch(/at version 3\.1, not 2\.1/);
    expect(c.state.writes).toBe(0);
  });

  it('needs class_name and property together', async () => {
    const { register } = await import('./edit-page.js');
    const r = await handlerOf(register, fakeClient('a'))({ space: 'Main', page: 'P', object_number: 0, property: 'code', edits: [{ old_text: 'a', new_text: 'b' }] });
    expect(r.content[0].text).toMatch(/class_name/);
  });
});
