import { describe, it, expect } from 'vitest';
import { pageOf } from './paging.js';
import { fileContent } from './files.js';

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
