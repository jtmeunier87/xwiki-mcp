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

describe('xwiki_replace_in_page', () => {
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
    const { register } = await import('./replace-in-page.js');
    const c = fakeClient('{{velocity}}\n"layout":"grid-3x2"\n{{/velocity}}');
    const r = await handlerOf(register, c)({ space: 'Main', page: 'Sheet', object_number: 0, edits: [{ old_text: 'grid-3x2', new_text: 'grid-2' }] });
    expect(r.isError).toBeUndefined();
    expect(c.state.content).toBe('{{velocity}}\n"layout":"grid-2"\n{{/velocity}}');
    expect(JSON.parse(r.content[0].text)).toMatchObject({ status: 'updated', target: 'content', previous_version: '3.1', version: '4.1', verified: true, changes: [{ line: 2 }] });
  });

  it('edits one object property', async () => {
    const { register } = await import('./replace-in-page.js');
    const c = fakeClient('x');
    const r = await handlerOf(register, c)({
      space: 'Main', page: 'Style', class_name: 'XWiki.StyleSheetExtension', object_number: 0, property: 'code',
      edits: [{ old_text: 'red', new_text: 'blue' }],
    });
    expect(c.state.prop).toBe('body { color: blue; }');
    expect(JSON.parse(r.content[0].text).target).toBe('XWiki.StyleSheetExtension[0].code');
  });

  it('saves nothing when an edit does not match or the version moved on', async () => {
    const { register } = await import('./replace-in-page.js');
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
    const { register } = await import('./replace-in-page.js');
    const r = await handlerOf(register, fakeClient('a'))({ space: 'Main', page: 'P', object_number: 0, property: 'code', edits: [{ old_text: 'a', new_text: 'b' }] });
    expect(r.content[0].text).toMatch(/class_name/);
  });
});

describe('stale-write guard', () => {
  it('xwiki_update_page refuses an update based on an older version', async () => {
    const { register } = await import('./update-page.js');
    const { XWikiError } = await import('../client.js');
    const updatePage = vi.fn(async (...a: unknown[]) => {
      if (a[5] && a[5] !== '3.1') throw new XWikiError('Page Main/P is at version 3.1, not 2.1: it changed since you read it.', 409);
      return { title: 'T', version: '4.1', url: '', status: 'updated' };
    });
    const h = handlerOf(register, { updatePage });
    const stale = await h({ space: 'Main', page: 'P', content: 'x', expected_version: '2.1' });
    expect(stale.isError).toBe(true);
    expect(stale.content[0].text).toMatch(/at version 3\.1, not 2\.1/);
    expect(updatePage).toHaveBeenLastCalledWith('Main', 'P', 'x', undefined, undefined, '2.1');
    expect((await h({ space: 'Main', page: 'P', content: 'x', expected_version: '3.1' })).isError).toBeUndefined();
  });

  it('xwiki_update_object checks the page version before writing', async () => {
    const { register } = await import('./update-object.js');
    const updateObject = vi.fn(async () => ({ class_name: 'C', number: 0, status: 'updated' }));
    const h = handlerOf(register, { getPage: async () => ({ version: '3.1' }), updateObject });
    const args = { space: 'Main', page: 'P', class_name: 'C', object_number: 0, properties: { a: 'b' } };
    const stale = await h({ ...args, expected_version: '2.1' });
    expect(stale.content[0].text).toMatch(/at version 3\.1, not 2\.1.*Nothing saved/);
    expect(updateObject).not.toHaveBeenCalled();
    expect((await h({ ...args, expected_version: '3.1' })).isError).toBeUndefined();
    expect(updateObject).toHaveBeenCalledTimes(1);
  });
});

describe('xwiki_get_page outline and section', () => {
  const content = '= A =\none\n== B ==\ntwo\n= C =\nthree';
  const client = { getPage: async () => ({ title: 'T', content, syntax: 'xwiki/2.1', version: '1.1', url: '' }) };

  it('returns the outline instead of the content', async () => {
    const { register } = await import('./get-page.js');
    const r = JSON.parse((await handlerOf(register, client)({ space: 'Main', page: 'P', outline: true, offset: 0, max_chars: 40000 })).content[0].text);
    expect(r.content).toBeUndefined();
    expect(r.content_total_lines).toBe(6);
    expect(r.outline.map((h: { title: string }) => h.title)).toEqual(['A', 'B', 'C']);
  });

  it('returns one section, windowed, and names a missing one', async () => {
    const { register } = await import('./get-page.js');
    const h = handlerOf(register, client);
    const r = JSON.parse((await h({ space: 'Main', page: 'P', section: 1, offset: 0, max_chars: 40000 })).content[0].text);
    expect(r.content).toBe('= A =\none\n== B ==\ntwo');
    expect(r.section).toMatchObject({ n: 1, title: 'A', line: 1, end_line: 4 });
    const missing = await h({ space: 'Main', page: 'P', section: 7, offset: 0, max_chars: 40000 });
    expect(missing.content[0].text).toMatch(/has no section 7/);
  });
});

describe('htmlToText', () => {
  it('keeps block and list structure, drops scripts and decodes entities', async () => {
    const { htmlToText } = await import('../html-text.js');
    const html =
      '<div class="card"><script>var x = "<b>no</b>";</script><!--startmacro:code-->' +
      '<h4 class="td-field-label">Overview</h4><dd><p>Add a colour &amp; a theme&hellip;</p></dd>' +
      '<section hidden><ol><li>First <strong>step</strong></li><li>\n<span>Second</span></li></ol></section>' +
      '<div class="code">line&#160;1<br/>line 2</div></div>';
    expect(htmlToText(html)).toBe(
      'Overview\nAdd a colour & a theme…\n- First step\n- Second\nline 1\nline 2',
    );
  });

  it('returns an empty string for markup without text', async () => {
    const { htmlToText } = await import('../html-text.js');
    expect(htmlToText('<p><div class="wikimodel-emptyline"></div></p>')).toBe('');
  });
});

describe('xwiki_search_objects', () => {
  type Batch = import('../types.js').ClassObjectScanBatch;
  const values = ['{{code language="css"}}a{{/code}}', 'plain code here', 'x {{CODE}} y {{code}} z', ''];
  /** A fake scan over one object per page, a batch of 2 at a time; position 1 is skipped. */
  function fakeClient(props: Array<Record<string, unknown>>) {
    return {
      async *scanClassObjects(_c: string, start: number, count: number): AsyncGenerator<Batch> {
        for (let offset = start; offset < start + count; offset += 2) {
          const end = Math.min(offset + 2, start + count);
          const objects = [];
          for (let p = offset; p < Math.min(end, props.length); p++) {
            objects.push({ position: p, object: { page: `Docs.P${p}`, space: 'Docs', page_name: `P${p}`, number: 0, properties: props[p] } });
          }
          yield { start: offset, end, objects, skipped: offset === 0 ? [{ page: 'Docs.Bad', number: 3, error: 'XWiki server error: 500' }] : [], exhausted: objects.length === 0 };
          if (objects.length === 0) return;
        }
      },
    };
  }
  const client = fakeClient(values.map(v => ({ code: v, count: 3 })));
  const run = async (args: Record<string, unknown>) => {
    const { register } = await import('./search-objects.js');
    const r = await handlerOf(register, client)({
      class_name: 'XWiki.StyleSheetExtension', mode: 'contains', ignore_case: false, include_snippet: true, max_results: 100, start: 0, scan_limit: 500, ...args,
    });
    return r.isError ? r : JSON.parse(r.content[0].text);
  };

  it('finds a literal substring, case-sensitively by default, and reports skipped objects', async () => {
    const r = await run({ pattern: '{{code' });
    expect(r.matches).toEqual([
      { page: 'Docs.P0', number: 0, field: 'code', count: 1, snippet: values[0] },
      { page: 'Docs.P2', number: 0, field: 'code', count: 1, snippet: values[2] },
    ]);
    expect(r).toMatchObject({ match_count: 2, objects_matched: 2, objects_read: 4, has_more: false, skipped: [{ page: 'Docs.Bad', number: 3 }] });
    expect(r.next_start).toBeUndefined();
  });

  it('ignores case, matches regexes and searches only the named fields', async () => {
    expect((await run({ pattern: '{{code', ignore_case: true })).matches[1]).toMatchObject({ page: 'Docs.P2', count: 2 });
    expect((await run({ pattern: '\\{\\{/?code\\}\\}', mode: 'regex' })).matches.map((m: { count: number }) => m.count)).toEqual([1, 1]);
    expect((await run({ pattern: '3', fields: ['count'] })).match_count).toBe(4);
    expect((await run({ pattern: '3' })).match_count).toBe(0);
  });

  it('stops at max_results and scan_limit with next_start to continue', async () => {
    const byResults = await run({ pattern: 'code', max_results: 1 });
    expect(byResults).toMatchObject({ match_count: 1, has_more: true, next_start: 1, scanned: { start: 0, end: 1 } });
    const byScan = await run({ pattern: 'code', scan_limit: 2, include_snippet: false });
    expect(byScan).toMatchObject({ objects_read: 2, has_more: true, next_start: 2 });
    expect(byScan.matches[0].snippet).toBeUndefined();
  });

  it('cuts long values to a snippet around the first match', async () => {
    const long = `${'a'.repeat(300)}NEEDLE${'b'.repeat(300)}`;
    const { register } = await import('./search-objects.js');
    const r = await handlerOf(register, fakeClient([{ code: long }]))({
      class_name: 'C', pattern: 'NEEDLE', mode: 'contains', ignore_case: false, include_snippet: true, max_results: 100, start: 0, scan_limit: 10,
    });
    const snippet = JSON.parse(r.content[0].text).matches[0].snippet as string;
    expect(snippet).toBe(`…${'a'.repeat(50)}NEEDLE${'b'.repeat(104)}…`);
  });

  it('returns a clear error for an invalid regex', async () => {
    const r = await run({ pattern: '(', mode: 'regex' });
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toMatch(/^Invalid regex: /);
  });

  it('reports a missing class', async () => {
    const { register } = await import('./search-objects.js');
    const { XWikiError } = await import('../client.js');
    const missing = { async *scanClassObjects(): AsyncGenerator<Batch> { throw new XWikiError('Not found', 404); } };
    const r = await handlerOf(register, missing)({ class_name: 'No.Such', pattern: 'x', mode: 'contains', start: 0, scan_limit: 5, max_results: 5 });
    expect(r.content[0].text).toBe('Class not found: No.Such');
  });
});
