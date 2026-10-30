import { describe, it, expect, vi, beforeEach } from 'vitest';
import { XWikiClient, XWikiError, splitSpace } from './client.js';

// Mock config so tests don't need real env vars
vi.mock('./config.js', () => ({
  config: {
    baseUrl: 'https://wiki.example.com',
    authType: 'basic',
    username: 'user',
    password: 'pass',
    token: '',
    wikiName: 'xwiki',
    restPath: '/rest',
    pageLimit: 50,
    timeoutMs: 30000,
    maxFileBytes: 1024,
  },
}));

function mockFetch(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : String(status),
    json: () => Promise.resolve(body),
    arrayBuffer: () => Promise.resolve(new TextEncoder().encode(JSON.stringify(body)).buffer),
    headers: {
      get: (key: string) => {
        const all: Record<string, string> = { 'XWiki-Form-Token': 'test-csrf-token', ...headers };
        return all[key] ?? null;
      },
    },
  });
}

beforeEach(() => {
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// listSpaces
// ---------------------------------------------------------------------------

/** A wiki-level list endpoint that answers by start: batches[start / 1000], then nothing. */
function pagedFetch(key: string, batches: Record<string, unknown[]>) {
  return vi.fn().mockImplementation((url: string) => {
    const u = new URL(url);
    const path = u.pathname.replace('/rest/wikis/xwiki', '');
    const start = Number(u.searchParams.get('start') ?? 0);
    const body = path === key ? { [key.slice(1) === 'pages' ? 'pageSummaries' : 'spaces']: batches[start] ?? [] } : { searchResults: [] };
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body), headers: { get: () => null } });
  });
}

const spaceRows = (from: number, n: number, top = 'Docs') =>
  Array.from({ length: n }, (_, i) => ({ id: `xwiki:${top}.S${from + i}`, name: `S${from + i}` }));

describe('listSpaces', () => {
  it('maps spaces to compact format', async () => {
    vi.stubGlobal('fetch', pagedFetch('/spaces', {
      0: [
        { id: 'xwiki:Main', name: 'Main', xwikiAbsoluteUrl: 'https://wiki.example.com/Main' },
        { id: 'xwiki:Sandbox', name: 'Sandbox', xwikiAbsoluteUrl: 'https://wiki.example.com/Sandbox' },
      ],
    }));

    const client = new XWikiClient();
    const spaces = await client.listSpaces();

    expect(spaces).toEqual([
      { id: 'xwiki:Main', name: 'Main', home_url: 'https://wiki.example.com/Main' },
      { id: 'xwiki:Sandbox', name: 'Sandbox', home_url: 'https://wiki.example.com/Sandbox' },
    ]);
  });

  it('returns empty array when spaces is missing', async () => {
    vi.stubGlobal('fetch', mockFetch({}));
    const client = new XWikiClient();
    expect(await client.listSpaces()).toEqual([]);
  });

  it('pages past a short batch until an empty one', async () => {
    // XWiki filters after paging: the first batch of 1000 holds 999, more follow.
    const fetch = pagedFetch('/spaces', { 0: spaceRows(0, 999), 1000: spaceRows(1000, 5, 'Sandbox') });
    vi.stubGlobal('fetch', fetch);
    const spaces = await new XWikiClient().listSpaces();
    expect(spaces).toHaveLength(1004);
    expect(spaces.at(-1)?.id).toBe('xwiki:Sandbox.S1004');
    expect(fetch).toHaveBeenCalledTimes(3);
  });
});

describe('getWikiOverview', () => {
  it('reads every space and page although the first batches are short', async () => {
    const pages = (top: string, from: number, n: number) =>
      Array.from({ length: n }, (_, i) => ({ id: `xwiki:${top}.P${from + i}`, fullName: `${top}.P${from + i}`, space: top, name: `P${from + i}` }));
    const spacesFetch = pagedFetch('/spaces', { 0: [...spaceRows(0, 998), { id: 'xwiki:Docs', name: 'Docs' }], 1000: [{ id: 'xwiki:Sandbox', name: 'Sandbox' }] });
    const pagesFetch = pagedFetch('/pages', { 0: pages('Docs', 0, 1000), 1000: pages('Docs', 1000, 966), 2000: pages('Sandbox', 0, 3) });
    vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) =>
      new URL(url).pathname.endsWith('/pages') ? pagesFetch(url) : spacesFetch(url)));
    const o = await new XWikiClient().getWikiOverview();
    expect(o.truncated).toBe(false);
    expect(o.total_pages).toBe(1969);
    expect(o.spaces.map(s => [s.space, s.pages, s.nested_spaces])).toEqual([['Docs', 1966, 998], ['Sandbox', 3, 0]]);
  });

  it('marks the overview truncated at the page cap', async () => {
    const pages = Array.from({ length: 1000 }, (_, i) => ({ id: `xwiki:Docs.P${i}`, fullName: `Docs.P${i}`, space: 'Docs', name: `P${i}` }));
    const pagesFetch = pagedFetch('/pages', { 0: pages, 1000: pages });
    const spacesFetch = pagedFetch('/spaces', { 0: [{ id: 'xwiki:Docs', name: 'Docs' }] });
    vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) =>
      new URL(url).pathname.endsWith('/pages') ? pagesFetch(url) : spacesFetch(url)));
    const o = await new XWikiClient().getWikiOverview(1500);
    expect(o).toMatchObject({ total_pages: 1500, truncated: true, truncated_reason: 'max_pages' });
  });

  it('returns a partial overview when the time budget runs out', async () => {
    const pages = Array.from({ length: 1000 }, (_, i) => ({ id: `xwiki:Docs.P${i}`, fullName: `Docs.P${i}`, space: 'Docs', name: `P${i}` }));
    const spacesFetch = pagedFetch('/spaces', { 0: [{ id: 'xwiki:Docs', name: 'Docs' }] });
    // The second /pages batch hangs until its request is aborted.
    vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string, init: RequestInit) => {
      const u = new URL(url);
      if (!u.pathname.endsWith('/pages')) return spacesFetch(url);
      if (u.searchParams.get('start') === '0') {
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ pageSummaries: pages }), headers: { get: () => null } });
      }
      return new Promise((_, reject) => init.signal?.addEventListener('abort', () => reject(new Error('aborted'))));
    }));
    const began = Date.now();
    const o = await new XWikiClient().getWikiOverview(20000, 200);
    expect(Date.now() - began).toBeLessThan(2000);
    expect(o).toMatchObject({ total_pages: 1000, truncated: true, truncated_reason: 'time', last_modified_skipped: 1 });
    expect(o.spaces).toEqual([{ space: 'Docs', pages: 1000, nested_spaces: 0 }]);
  });
});

// ---------------------------------------------------------------------------
// spacePath — tested indirectly via URL fetch is called with
// ---------------------------------------------------------------------------

describe('spacePath (nested spaces)', () => {
  it('builds simple space URL', async () => {
    const fetch = mockFetch({ pageSummaries: [], totalResults: 0 });
    vi.stubGlobal('fetch', fetch);

    await new XWikiClient().listPages('MySpace', 0, 10);

    const url: string = fetch.mock.calls[0][0];
    expect(url).toContain('/spaces/MySpace/pages');
  });

  it('builds nested space URL with dot notation', async () => {
    const fetch = mockFetch({ pageSummaries: [], totalResults: 0 });
    vi.stubGlobal('fetch', fetch);

    await new XWikiClient().listPages('Space1.SubSpace', 0, 10);

    const url: string = fetch.mock.calls[0][0];
    expect(url).toContain('/spaces/Space1/spaces/SubSpace/pages');
  });

  it('encodes special characters in space name', async () => {
    const fetch = mockFetch({ pageSummaries: [], totalResults: 0 });
    vi.stubGlobal('fetch', fetch);

    await new XWikiClient().listPages('Тест', 0, 10);

    const url: string = fetch.mock.calls[0][0];
    expect(url).toContain(encodeURIComponent('Тест'));
  });

  it('keeps an escaped dot inside a space name', async () => {
    const fetch = mockFetch({ pageSummaries: [], totalResults: 0 });
    vi.stubGlobal('fetch', fetch);

    await new XWikiClient().listPages('Docs.1\\.2 Notes', 0, 10);

    const url: string = fetch.mock.calls[0][0];
    expect(url).toContain('/spaces/Docs/spaces/1.2%20Notes/pages');
  });

  it('splits on unescaped dots only', () => {
    expect(splitSpace('Main')).toEqual(['Main']);
    expect(splitSpace('Docs.Guides')).toEqual(['Docs', 'Guides']);
    expect(splitSpace('Docs.1\\.2 Notes.Sub')).toEqual(['Docs', '1.2 Notes', 'Sub']);
    expect(splitSpace('Docs.a\\\\.b')).toEqual(['Docs', 'a\\', 'b']);
  });
});

// ---------------------------------------------------------------------------
// listPages — pagination
// ---------------------------------------------------------------------------

describe('listPages pagination', () => {
  it('has_more=true when more results exist', async () => {
    vi.stubGlobal('fetch', mockFetch({
      pageSummaries: [{ id: 'p1', title: 'Page 1', xwikiAbsoluteUrl: '' }],
      totalResults: 5,
    }));

    const { pagination } = await new XWikiClient().listPages('Space', 0, 1);
    expect(pagination.has_more).toBe(true);
    expect(pagination.total).toBe(5);
  });

  it('has_more=false when all results fetched', async () => {
    vi.stubGlobal('fetch', mockFetch({
      pageSummaries: [{ id: 'p1', title: 'Page 1', xwikiAbsoluteUrl: '' }],
      totalResults: 1,
    }));

    const { pagination } = await new XWikiClient().listPages('Space', 0, 10);
    expect(pagination.has_more).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// getPage
// ---------------------------------------------------------------------------

describe('getPage', () => {
  it('maps page fields to compact format', async () => {
    vi.stubGlobal('fetch', mockFetch({
      title: 'My Page',
      content: '= Hello =',
      syntax: 'xwiki/2.1',
      contentAuthor: 'XWiki.Admin',
      modified: 1700000000000,
      version: '3.1',
      parent: 'Main.WebHome',
      xwikiAbsoluteUrl: 'https://wiki.example.com/MyPage',
    }));

    const page = await new XWikiClient().getPage('Main', 'MyPage');

    expect(page.title).toBe('My Page');
    expect(page.content).toBe('= Hello =');
    expect(page.author).toBe('XWiki.Admin');
    expect(page.url).toBe('https://wiki.example.com/MyPage');
  });
});

describe('updatePage', () => {
  // A sheet's stored title is Velocity; REST returns it rendered in `title` and as-is in `rawTitle`.
  const sheet = {
    title: 'Example Sheet',
    rawTitle: "#if($doc.documentReference.name == 'ExampleSheet')Example Sheet#{else}$doc.name#end",
    content: '{{velocity}}old{{/velocity}}',
    syntax: 'xwiki/2.1',
    version: '4.1',
  };

  it('keeps the stored (raw) title when only the content changes', async () => {
    const fetch = mockFetch(sheet);
    vi.stubGlobal('fetch', fetch);

    await new XWikiClient().updatePage('Sandbox.Code', 'ExampleSheet', '{{velocity}}new{{/velocity}}');

    const put = fetch.mock.calls.find(([, o]) => o?.method === 'PUT');
    expect(put![1].body).toContain(
      '<title>#if($doc.documentReference.name == &apos;ExampleSheet&apos;)Example Sheet#{else}$doc.name#end</title>',
    );
    expect(put![1].body).not.toContain('<title>Example Sheet</title>');
  });

  it('writes a title it is given', async () => {
    const fetch = mockFetch(sheet);
    vi.stubGlobal('fetch', fetch);

    await new XWikiClient().updatePage('Sandbox.Code', 'ExampleSheet', undefined, 'Renamed');

    const put = fetch.mock.calls.find(([, o]) => o?.method === 'PUT');
    expect(put![1].body).toContain('<title>Renamed</title>');
  });

  it('getPage reports raw_title only when it differs from the rendered title', async () => {
    vi.stubGlobal('fetch', mockFetch(sheet));
    expect((await new XWikiClient().getPage('Sandbox.Code', 'ExampleSheet')).raw_title).toBe(sheet.rawTitle);
    vi.stubGlobal('fetch', mockFetch({ ...sheet, rawTitle: 'Example Sheet' }));
    expect((await new XWikiClient().getPage('Sandbox.Code', 'ExampleSheet')).raw_title).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// search — scope prefix
// ---------------------------------------------------------------------------

describe('search scope prefix', () => {
  const emptyResponse = { searchResults: [], totalResults: 0 };

  it('searches a space through its own search resource, not a space parameter', async () => {
    const fetch = mockFetch(emptyResponse);
    vi.stubGlobal('fetch', fetch);

    await new XWikiClient().search('foo', 'content', 'Docs.Guides', 0, 10);

    const url = new URL(fetch.mock.calls[0][0]);
    expect(url.pathname).toBe('/rest/wikis/xwiki/spaces/Docs/spaces/Guides/search');
    expect(url.searchParams.get('space')).toBeNull();
  });

  it('passes raw query for content scope', async () => {
    const fetch = mockFetch(emptyResponse);
    vi.stubGlobal('fetch', fetch);

    await new XWikiClient().search('foo bar', 'content', undefined, 0, 10);

    const url: string = fetch.mock.calls[0][0];
    expect(new URL(url).searchParams.get('q')).toBe('foo bar');
  });

  it('adds title: prefix for title scope', async () => {
    const fetch = mockFetch(emptyResponse);
    vi.stubGlobal('fetch', fetch);

    await new XWikiClient().search('foo bar', 'title', undefined, 0, 10);

    const url: string = fetch.mock.calls[0][0];
    expect(new URL(url).searchParams.get('q')).toBe('title:foo bar');
  });

  it('adds name: prefix for name scope', async () => {
    const fetch = mockFetch(emptyResponse);
    vi.stubGlobal('fetch', fetch);

    await new XWikiClient().search('foo', 'name', undefined, 0, 10);

    const url: string = fetch.mock.calls[0][0];
    expect(new URL(url).searchParams.get('q')).toBe('name:foo');
  });

});

// ---------------------------------------------------------------------------
// Error handling
// ---------------------------------------------------------------------------

describe('error handling', () => {
  it('throws XWikiError with status 404 on not found', async () => {
    vi.stubGlobal('fetch', mockFetch({}, 404));

    await expect(new XWikiClient().getPage('Main', 'Missing')).rejects.toMatchObject({
      name: 'XWikiError',
      status: 404,
    });
  });

  it('throws XWikiError on 401', async () => {
    vi.stubGlobal('fetch', mockFetch({}, 401));

    await expect(new XWikiClient().listSpaces()).rejects.toMatchObject({
      name: 'XWikiError',
      status: 401,
      message: 'Authentication failed. Check XWIKI_AUTH_TYPE and credentials.',
    });
  });

  it('throws XWikiError on network failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));

    await expect(new XWikiClient().listSpaces()).rejects.toMatchObject({
      name: 'XWikiError',
      message: expect.stringContaining('Cannot connect to XWiki'),
    });
  });
});

// ---------------------------------------------------------------------------
// Phase 2: uploadAttachment
// ---------------------------------------------------------------------------

describe('uploadAttachment', () => {
  it('sends PUT to correct attachment URL with binary body', async () => {
    const fetch = mockFetch({
      name: 'test.png',
      longSize: 128,
      mimeType: 'image/png',
      xwikiAbsoluteUrl: 'https://wiki.example.com/download/Main/WebHome/test.png',
    }, 201);
    vi.stubGlobal('fetch', fetch);

    const client = new XWikiClient();
    const result = await client.uploadAttachment('Main', 'WebHome', 'test.png', 'aGVsbG8=', 'image/png');

    expect(result.name).toBe('test.png');
    expect(result.status).toBe('uploaded');
    expect(result.mime_type).toBe('image/png');

    // Verify PUT was called on the attachments URL (call[0] is CSRF GET, call[1] is the PUT)
    const [url, opts] = fetch.mock.calls[1];
    expect(url).toContain('/attachments/test.png');
    expect(opts.method).toBe('PUT');
    expect(opts.headers['Content-Type']).toBe('image/png');
  });
});

// ---------------------------------------------------------------------------
// Phase 2: deleteAttachment
// ---------------------------------------------------------------------------

describe('deleteAttachment', () => {
  it('sends DELETE to correct attachment URL', async () => {
    const fetch = mockFetch('', 204);
    vi.stubGlobal('fetch', fetch);

    const client = new XWikiClient();
    // Override ok check — 204 is ok
    fetch.mockResolvedValue({ ok: true, status: 204, statusText: 'No Content', json: () => Promise.resolve(''), headers: { get: () => 'test-token' } });

    const result = await client.deleteAttachment('Main', 'WebHome', 'old.pdf');
    expect(result.status).toBe('deleted');

    // call[0] is CSRF GET, call[1] is the DELETE
    const [url, opts] = fetch.mock.calls[1];
    expect(url).toContain('/attachments/old.pdf');
    expect(opts.method).toBe('DELETE');
  });
});

// ---------------------------------------------------------------------------
// Phase 2: getTags
// ---------------------------------------------------------------------------

describe('getTags', () => {
  it('returns empty array when no tags', async () => {
    vi.stubGlobal('fetch', mockFetch({ tags: [] }));
    const tags = await new XWikiClient().getTags('Main', 'WebHome');
    expect(tags).toEqual([]);
  });

  it('maps tag names correctly', async () => {
    vi.stubGlobal('fetch', mockFetch({
      tags: [{ name: 'architecture' }, { name: 'reviewed' }],
    }));
    const tags = await new XWikiClient().getTags('Main', 'WebHome');
    expect(tags).toEqual([{ name: 'architecture' }, { name: 'reviewed' }]);
  });
});

// ---------------------------------------------------------------------------
// Phase 2: addTags (merges with existing)
// ---------------------------------------------------------------------------

describe('addTags', () => {
  it('merges new tags with existing, sends PUT', async () => {
    const fetchMock = vi.fn()
      // First call: GET tags (existing)
      .mockResolvedValueOnce({
        ok: true, status: 200,
        json: () => Promise.resolve({ tags: [{ name: 'existing' }] }),
        headers: { get: () => 'test-csrf' },
      })
      // Second call: GET for CSRF token (getCsrfToken)
      .mockResolvedValueOnce({
        ok: true, status: 200,
        json: () => Promise.resolve({}),
        headers: { get: (k: string) => k === 'XWiki-Form-Token' ? 'test-csrf' : null },
      })
      // Third call: PUT tags
      .mockResolvedValueOnce({
        ok: true, status: 202,
        json: () => Promise.resolve({ tags: [{ name: 'existing' }, { name: 'new' }] }),
        headers: { get: () => null },
      });

    vi.stubGlobal('fetch', fetchMock);

    const result = await new XWikiClient().addTags('Main', 'WebHome', ['new']);
    // Verify the PUT used attribute syntax <tag name="..."/>
    // [0]=GET tags (also seeds CSRF), [1]=PUT tags (CSRF cached from [0])
    const putCall = fetchMock.mock.calls[1];
    expect(putCall[1].body).toContain('name="existing"');
    expect(putCall[1].body).toContain('name="new"');
    expect(result.map(t => t.name)).toContain('existing');
    expect(result.map(t => t.name)).toContain('new');
  });

  it('does not duplicate tags that already exist', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true, status: 200,
        json: () => Promise.resolve({ tags: [{ name: 'existing' }] }),
        headers: { get: () => 'test-csrf' },
      })
      .mockResolvedValueOnce({
        ok: true, status: 200,
        json: () => Promise.resolve({}),
        headers: { get: (k: string) => k === 'XWiki-Form-Token' ? 'test-csrf' : null },
      })
      .mockResolvedValueOnce({
        ok: true, status: 202,
        json: () => Promise.resolve({}),
        headers: { get: () => null },
      });

    vi.stubGlobal('fetch', fetchMock);

    const result = await new XWikiClient().addTags('Main', 'WebHome', ['existing']);
    expect(result.filter(t => t.name === 'existing').length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Phase 3: listClasses
// ---------------------------------------------------------------------------

describe('listClasses', () => {
  it('maps clazzs array (xWiki typo) to classes', async () => {
    vi.stubGlobal('fetch', mockFetch({
      clazzs: [
        { id: 'XWiki.XWikiUsers', name: 'XWiki.XWikiUsers', properties: [{ name: 'email', type: 'Email' }] },
        { id: 'MyApp.MyClass', name: 'MyApp.MyClass', properties: [] },
      ],
    }));

    const { classes, pagination } = await new XWikiClient().listClasses(0, 20);
    expect(classes).toHaveLength(2);
    expect(classes[0].id).toBe('XWiki.XWikiUsers');
    expect(classes[0].property_count).toBe(1);
    expect(classes[0].properties[0]).toEqual({ name: 'email', type: 'Email' });
    expect(pagination.start).toBe(0);
  });

  it('returns empty array when clazzs is missing', async () => {
    vi.stubGlobal('fetch', mockFetch({}));
    const { classes } = await new XWikiClient().listClasses(0, 20);
    expect(classes).toEqual([]);
  });

  it('cuts the page itself, as XWiki returns every class', async () => {
    const clazzs = Array.from({ length: 7 }, (_, i) => ({ id: `Sandbox.C${i}`, name: `Sandbox.C${i}`, properties: [] }));
    vi.stubGlobal('fetch', mockFetch({ clazzs }));
    const first = await new XWikiClient().listClasses(0, 5);
    expect(first.classes.map(c => c.id)).toEqual(['Sandbox.C0', 'Sandbox.C1', 'Sandbox.C2', 'Sandbox.C3', 'Sandbox.C4']);
    expect(first.pagination).toEqual({ total: 7, start: 0, limit: 5, has_more: true });
    const second = await new XWikiClient().listClasses(5, 5);
    expect(second.classes.map(c => c.id)).toEqual(['Sandbox.C5', 'Sandbox.C6']);
    expect(second.pagination.has_more).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Phase 3: getClass
// ---------------------------------------------------------------------------

describe('getClass', () => {
  it('returns class with properties', async () => {
    vi.stubGlobal('fetch', mockFetch({
      id: 'XWiki.XWikiComments',
      name: 'XWiki.XWikiComments',
      properties: [
        { name: 'comment', type: 'TextArea' },
        { name: 'author', type: 'String' },
        { name: 'date', type: 'Date' },
      ],
    }));

    const cls = await new XWikiClient().getClass('XWiki.XWikiComments');
    expect(cls.id).toBe('XWiki.XWikiComments');
    expect(cls.property_count).toBe(3);
    expect(cls.properties.map(p => p.name)).toEqual(['comment', 'author', 'date']);
  });

  it('returns non-empty property attributes such as StaticList values', async () => {
    vi.stubGlobal('fetch', mockFetch({
      id: 'Sandbox.Code.ExampleClass',
      name: 'Sandbox.Code.ExampleClass',
      properties: [{
        name: 'status',
        type: 'StaticList',
        attributes: [
          { name: 'prettyName', value: 'Status' },
          { name: 'values', value: 'draft|review|published' },
          { name: 'multiSelect', value: '0' },
          { name: 'validationMessage', value: '' },
        ],
      }],
    }));

    const cls = await new XWikiClient().getClass('Sandbox.Code.ExampleClass');
    expect(cls.properties[0].attributes).toEqual({
      prettyName: 'Status',
      values: 'draft|review|published',
      multiSelect: '0',
    });
  });
});

// ---------------------------------------------------------------------------
// Phase 3: listObjects
// ---------------------------------------------------------------------------

describe('listObjects', () => {
  it('returns objects with flattened properties', async () => {
    vi.stubGlobal('fetch', mockFetch({
      objectSummaries: [
        {
          className: 'XWiki.XWikiComments',
          number: 0,
          pageId: 'xwiki:Main.WebHome',
          properties: [{ name: 'comment', value: 'Hello world' }],
        },
      ],
    }));

    const objects = await new XWikiClient().listObjects('Main', 'WebHome');
    expect(objects).toHaveLength(1);
    expect(objects[0].class_name).toBe('XWiki.XWikiComments');
    expect(objects[0].number).toBe(0);
  });

  it('uses class-filtered endpoint when class_name provided', async () => {
    const fetch = mockFetch({ objectSummaries: [] });
    vi.stubGlobal('fetch', fetch);

    await new XWikiClient().listObjects('Main', 'WebHome', 'XWiki.XWikiComments');

    const url: string = fetch.mock.calls[0][0];
    expect(url).toContain('/objects/XWiki.XWikiComments');
  });
});

// ---------------------------------------------------------------------------
// Phase 3: getObject
// ---------------------------------------------------------------------------

describe('getObject', () => {
  it('returns object with all properties', async () => {
    vi.stubGlobal('fetch', mockFetch({
      className: 'MyApp.MyClass',
      number: 2,
      pageId: 'xwiki:Main.WebHome',
      xwikiAbsoluteUrl: 'https://wiki.example.com/obj/2',
      properties: [
        { name: 'title', value: 'Test Object' },
        { name: 'status', value: 'active' },
      ],
    }));

    const obj = await new XWikiClient().getObject('Main', 'WebHome', 'MyApp.MyClass', 2);
    expect(obj.class_name).toBe('MyApp.MyClass');
    expect(obj.number).toBe(2);
    expect(obj.properties['title']).toBe('Test Object');
    expect(obj.properties['status']).toBe('active');
  });
});

// ---------------------------------------------------------------------------
// Phase 3: createObject
// ---------------------------------------------------------------------------

describe('createObject', () => {
  it('sends POST with XML body and returns created result', async () => {
    const fetch = mockFetch({
      className: 'MyApp.MyClass',
      number: 0,
      xwikiAbsoluteUrl: 'https://wiki.example.com/obj/0',
    }, 201);
    vi.stubGlobal('fetch', fetch);

    const result = await new XWikiClient().createObject('Main', 'WebHome', 'MyApp.MyClass', { name: 'Test' });

    expect(result.class_name).toBe('MyApp.MyClass');
    expect(result.status).toBe('created');

    // call[0] is CSRF GET, call[1] is the POST
    const [url, opts] = fetch.mock.calls[1];
    expect(url).toContain('/objects');
    expect(opts.method).toBe('POST');
    expect(opts.headers['Content-Type']).toBe('application/x-www-form-urlencoded');
    const form = new URLSearchParams(opts.body);
    expect(form.get('className')).toBe('MyApp.MyClass');
    expect(form.get('property#name')).toBe('Test');
  });
});

// ---------------------------------------------------------------------------
// Phase 3: updateObject
// ---------------------------------------------------------------------------

describe('updateObject', () => {
  it('sends PUT to object URL with correct number', async () => {
    const fetch = mockFetch({
      className: 'MyApp.MyClass',
      number: 1,
    }, 202);
    vi.stubGlobal('fetch', fetch);

    const result = await new XWikiClient().updateObject('Main', 'WebHome', 'MyApp.MyClass', 1, { status: 'inactive' });

    expect(result.number).toBe(1);
    expect(result.status).toBe('updated');

    // call[0] is CSRF GET, call[1] is the PUT
    const [url, opts] = fetch.mock.calls[1];
    expect(url).toContain('/objects/MyApp.MyClass/1');
    expect(opts.method).toBe('PUT');
    expect(opts.headers['Content-Type']).toBe('application/x-www-form-urlencoded');
    expect(new URLSearchParams(opts.body).get('property#status')).toBe('inactive');
  });

  it('encodes multi-line and special-character values', async () => {
    const fetch = mockFetch({ className: 'MyApp.MyClass', number: 0 }, 202);
    vi.stubGlobal('fetch', fetch);

    const value = '* line 1\n* x < y & z = 100%\n{{code}}a#b{{/code}}';
    await new XWikiClient().updateObject('Main', 'WebHome', 'MyApp.MyClass', 0, { steps: value });

    const [, opts] = fetch.mock.calls[1];
    expect(new URLSearchParams(opts.body).get('property#steps')).toBe(value);
  });
});

// ---------------------------------------------------------------------------
// Phase 3: deleteObject
// ---------------------------------------------------------------------------

describe('deleteObject', () => {
  it('sends DELETE to object URL', async () => {
    const fetch = vi.fn().mockResolvedValue({
      ok: true, status: 204, statusText: 'No Content',
      json: () => Promise.resolve(''),
      headers: { get: () => 'test-csrf' },
    });
    vi.stubGlobal('fetch', fetch);

    const result = await new XWikiClient().deleteObject('Main', 'WebHome', 'MyApp.MyClass', 3);
    expect(result.status).toBe('deleted');

    // call[0] is CSRF GET, call[1] is the DELETE
    const [url, opts] = fetch.mock.calls[1];
    expect(url).toContain('/objects/MyApp.MyClass/3');
    expect(opts.method).toBe('DELETE');
  });
});

// ---------------------------------------------------------------------------
// Phase 4: getPageHistory
// ---------------------------------------------------------------------------

describe('getPageHistory', () => {
  it('returns formatted history with parsed timestamps and stripped modifier prefix', async () => {
    vi.stubGlobal('fetch', mockFetch({
      historySummaries: [
        { version: '19.1', modified: 1712000000000, modifier: 'xwiki:XWiki.JaneDoe', comment: 'Updated intro' },
        { version: '18.1', modified: 1711900000000, modifier: 'xwiki:XWiki.Admin', comment: '' },
      ],
    }));

    const client = new XWikiClient();
    const history = await client.getPageHistory('Main', 'WebHome', 10);

    expect(history).toHaveLength(2);
    expect(history[0].version).toBe('19.1');
    expect(history[0].modifier).toBe('JaneDoe');
    expect(history[0].modified_date).toBe(new Date(1712000000000).toISOString());
    expect(history[0].comment).toBe('Updated intro');
    // Empty comment should be undefined
    expect(history[1].comment).toBeUndefined();
    expect(history[1].modifier).toBe('Admin');
  });

  it('calls the correct history endpoint URL with limit', async () => {
    const fetch = vi.fn().mockResolvedValue({
      ok: true, status: 200, statusText: 'OK',
      json: () => Promise.resolve({ historySummaries: [] }),
      headers: { get: () => null },
    });
    vi.stubGlobal('fetch', fetch);

    await new XWikiClient().getPageHistory('Sandbox', 'TestPage', 5);
    const [url] = fetch.mock.calls[0];
    expect(url).toContain('/spaces/Sandbox/pages/TestPage/history');
    expect(url).toContain('number=5');
    expect(url).toContain('media=json');
  });

  it('throws XWikiError on non-OK response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false, status: 404, statusText: 'Not Found',
      headers: { get: () => null },
    }));

    await expect(new XWikiClient().getPageHistory('Missing', 'Page')).rejects.toThrow(XWikiError);
  });

  it('returns empty array when historySummaries is missing', async () => {
    vi.stubGlobal('fetch', mockFetch({}));
    const history = await new XWikiClient().getPageHistory('Main', 'WebHome');
    expect(history).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Phase 4: getPageVersion
// ---------------------------------------------------------------------------

describe('getPageVersion', () => {
  it('returns page content at a specific version', async () => {
    vi.stubGlobal('fetch', mockFetch({
      title: 'Docs',
      content: 'Initial content',
      syntax: 'xwiki/2.1',
      author: 'XWiki.JaneDoe',
      modified: 1711500000000,
      version: '1.1',
      xwikiAbsoluteUrl: 'https://wiki.example.com/Main/Docs',
    }));

    const client = new XWikiClient();
    const page = await client.getPageVersion('Main', 'Docs', '1.1');

    expect(page.title).toBe('Docs');
    expect(page.version).toBe('1.1');
    expect(page.content).toBe('Initial content');
    expect(page.modified_date).toBe(new Date(1711500000000).toISOString());
    expect(page.url).toBe('https://wiki.example.com/Main/Docs');
  });

  it('calls the correct versioned URL', async () => {
    const fetch = vi.fn().mockResolvedValue({
      ok: true, status: 200, statusText: 'OK',
      json: () => Promise.resolve({ title: 'T', content: '', syntax: 'xwiki/2.1' }),
      headers: { get: () => null },
    });
    vi.stubGlobal('fetch', fetch);

    await new XWikiClient().getPageVersion('Sandbox', 'MyPage', '3.2');
    const [url] = fetch.mock.calls[0];
    expect(url).toContain('/spaces/Sandbox/pages/MyPage/history/3.2');
    expect(url).toContain('media=json');
  });

  it('throws XWikiError on 404', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false, status: 404, statusText: 'Not Found',
      headers: { get: () => null },
    }));

    await expect(new XWikiClient().getPageVersion('Main', 'Page', '99.1')).rejects.toThrow(XWikiError);
  });
});

// ---------------------------------------------------------------------------
// Phase 4: advancedSearch
// ---------------------------------------------------------------------------

describe('advancedSearch', () => {
  it('returns query results mapped to QueryResult shape', async () => {
    vi.stubGlobal('fetch', mockFetch({
      searchResults: [
        { id: 'xwiki:Main.WebHome', pageFullName: 'Main.WebHome', title: 'Home', space: 'Main' },
        { id: 'xwiki:Sandbox.TestPage', pageFullName: 'Sandbox.TestPage', title: 'Test', space: 'Sandbox' },
      ],
    }));

    const client = new XWikiClient();
    const results = await client.advancedSearch("where doc.space = 'Main'", 'hql', 10);

    expect(results).toHaveLength(2);
    expect(results[0].page_full_name).toBe('Main.WebHome');
    expect(results[0].title).toBe('Home');
    expect(results[0].space).toBe('Main');
  });

  it('builds the correct query URL for xwql type', async () => {
    const fetch = vi.fn().mockResolvedValue({
      ok: true, status: 200, statusText: 'OK',
      json: () => Promise.resolve({ searchResults: [] }),
      headers: { get: () => null },
    });
    vi.stubGlobal('fetch', fetch);

    await new XWikiClient().advancedSearch("where doc.author = 'XWiki.Admin'", 'xwql', 20, 0);
    const [url] = fetch.mock.calls[0];
    expect(url).toContain('/wikis/xwiki/query');
    expect(url).toContain('type=xwql');
    expect(url).toContain('number=20');
    expect(url).toContain('media=json');
  });

  it('defaults to solr type when not specified (XWiki allows only solr by default)', async () => {
    const fetch = vi.fn().mockResolvedValue({
      ok: true, status: 200, statusText: 'OK',
      json: () => Promise.resolve({ searchResults: [] }),
      headers: { get: () => null },
    });
    vi.stubGlobal('fetch', fetch);

    await new XWikiClient().advancedSearch("space:Sandbox");
    const [url] = fetch.mock.calls[0];
    expect(url).toContain('type=solr');
  });

  it('supports solr query type', async () => {
    const fetch = vi.fn().mockResolvedValue({
      ok: true, status: 200, statusText: 'OK',
      json: () => Promise.resolve({ searchResults: [] }),
      headers: { get: () => null },
    });
    vi.stubGlobal('fetch', fetch);

    await new XWikiClient().advancedSearch('type:DOCUMENT AND space:Main', 'solr');
    const [url] = fetch.mock.calls[0];
    expect(url).toContain('type=solr');
  });

  it('returns empty array when searchResults is missing', async () => {
    vi.stubGlobal('fetch', mockFetch({}));
    const results = await new XWikiClient().advancedSearch("where 1=1");
    expect(results).toEqual([]);
  });

  it('throws XWikiError on error response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false, status: 400, statusText: 'Bad Request',
      headers: { get: () => null },
    }));

    await expect(new XWikiClient().advancedSearch('bad query', 'hql')).rejects.toThrow(XWikiError);
  });
});

// ---------------------------------------------------------------------------
// Phase 4: renderPage
// ---------------------------------------------------------------------------

describe('renderPage', () => {
  it('returns plain text content with correct metadata', async () => {
    const fetch = vi.fn().mockResolvedValue({
      ok: true, status: 200, statusText: 'OK',
      text: () => Promise.resolve('<p>This is the rendered plain text content of the page.</p>'),
      headers: { get: () => null },
    });
    vi.stubGlobal('fetch', fetch);

    const client = new XWikiClient();
    const result = await client.renderPage('Main', 'WebHome', 'plain');

    expect(result.space).toBe('Main');
    expect(result.page).toBe('WebHome');
    expect(result.syntax).toBe('plain');
    expect(result.content).toBe('This is the rendered plain text content of the page.');
  });

  it('builds the action URL from nested spaces', async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true, status: 200, statusText: 'OK', text: () => Promise.resolve(''), headers: { get: () => null } });
    vi.stubGlobal('fetch', fetch);
    await new XWikiClient().renderPage('Docs.Guides', 'Setup', 'plain');
    expect(fetch.mock.calls[0][0]).toContain('/bin/get/Docs/Guides/Setup?');
  });

  it('uses the action URL (not REST path) for plain text', async () => {
    const fetch = vi.fn().mockResolvedValue({
      ok: true, status: 200, statusText: 'OK',
      text: () => Promise.resolve('content'),
      headers: { get: () => null },
    });
    vi.stubGlobal('fetch', fetch);

    await new XWikiClient().renderPage('Sandbox', 'TestPage', 'plain');
    const [url] = fetch.mock.calls[0];
    expect(url).toContain('/bin/get/Sandbox/TestPage');
    // Rendered as a reader sees it (sheets included), never content-only xpage=plain
    expect(url).toContain('outputSyntax=annotatedhtmlmacros');
    expect(url).not.toContain('xpage=plain');
    // Must NOT use the REST path
    expect(url).not.toContain('/rest/wikis');
  });

  it('uses annotatedhtmlmacros outputSyntax for html render', async () => {
    const fetch = vi.fn().mockResolvedValue({
      ok: true, status: 200, statusText: 'OK',
      text: () => Promise.resolve('<html>content</html>'),
      headers: { get: () => null },
    });
    vi.stubGlobal('fetch', fetch);

    await new XWikiClient().renderPage('Main', 'WebHome', 'html');
    const [url] = fetch.mock.calls[0];
    expect(url).toContain('outputSyntax=annotatedhtmlmacros');
    expect(url).not.toContain('xpage=plain');
  });

  it('defaults to plain syntax', async () => {
    const fetch = vi.fn().mockResolvedValue({
      ok: true, status: 200, statusText: 'OK',
      text: () => Promise.resolve('text'),
      headers: { get: () => null },
    });
    vi.stubGlobal('fetch', fetch);

    const result = await new XWikiClient().renderPage('Main', 'WebHome');
    expect(result.syntax).toBe('plain');
  });

  it('throws XWikiError on render failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false, status: 403, statusText: 'Forbidden',
      headers: { get: () => null },
    }));

    await expect(new XWikiClient().renderPage('Main', 'WebHome')).rejects.toThrow(XWikiError);
  });
});

// ---------------------------------------------------------------------------
// Phase 4: getRecentChanges
// ---------------------------------------------------------------------------

describe('getRecentChanges', () => {
  it('returns recent changes with parsed timestamps', async () => {
    vi.stubGlobal('fetch', mockFetch({
      historySummaries: [
        { version: 'Main.WebHome/5.1', modified: 1712100000000, modifier: 'xwiki:XWiki.JaneDoe', comment: 'Updated docs' },
        { version: 'Sandbox.Test/2.1', modified: 1712050000000, modifier: 'xwiki:XWiki.Admin', comment: 'Added section' },
      ],
    }));

    const client = new XWikiClient();
    const changes = await client.getRecentChanges(10);

    expect(changes).toHaveLength(2);
    expect(changes[0].version).toBe('Main.WebHome/5.1');
    expect(changes[0].modifier).toBe('JaneDoe');
    expect(changes[0].modified_date).toBe(new Date(1712100000000).toISOString());
    expect(changes[0].comment).toBe('Updated docs');
  });

  it('names the page of each change', async () => {
    vi.stubGlobal('fetch', mockFetch({
      historySummaries: [
        { pageId: 'xwiki:Docs.Guides.Setup', space: 'Docs.Guides', name: 'Setup', version: '3.1', modified: 1712100000000 },
        { pageId: 'xwiki:Main.WebHome', version: '1.1', modified: 1712100000000 },
      ],
    }));
    const changes = await new XWikiClient().getRecentChanges();
    expect(changes[0].page).toBe('Docs.Guides.Setup');
    expect(changes[1].page).toBe('Main.WebHome');
  });

  it('calls the modifications endpoint with limit', async () => {
    const fetch = vi.fn().mockResolvedValue({
      ok: true, status: 200, statusText: 'OK',
      json: () => Promise.resolve({ historySummaries: [] }),
      headers: { get: () => null },
    });
    vi.stubGlobal('fetch', fetch);

    await new XWikiClient().getRecentChanges(15);
    const [url] = fetch.mock.calls[0];
    expect(url).toContain('/wikis/xwiki/modifications');
    expect(url).toContain('number=15');
    expect(url).toContain('media=json');
  });

  it('defaults to 20 results when no limit provided', async () => {
    const fetch = vi.fn().mockResolvedValue({
      ok: true, status: 200, statusText: 'OK',
      json: () => Promise.resolve({ historySummaries: [] }),
      headers: { get: () => null },
    });
    vi.stubGlobal('fetch', fetch);

    await new XWikiClient().getRecentChanges();
    const [url] = fetch.mock.calls[0];
    expect(url).toContain('number=20');
  });

  it('returns empty array when historySummaries is missing', async () => {
    vi.stubGlobal('fetch', mockFetch({}));
    const changes = await new XWikiClient().getRecentChanges();
    expect(changes).toEqual([]);
  });

  it('throws XWikiError on error response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false, status: 403, statusText: 'Forbidden',
      headers: { get: () => null },
    }));

    await expect(new XWikiClient().getRecentChanges()).rejects.toThrow(XWikiError);
  });
});

// ---------------------------------------------------------------------------
// Phase 5: getAllWikiTags
// ---------------------------------------------------------------------------

describe('getAllWikiTags', () => {
  it('returns list of wiki tags', async () => {
    vi.stubGlobal('fetch', mockFetch({
      tags: [{ name: 'howto' }, { name: 'release' }, { name: 'draft' }],
    }));

    const client = new XWikiClient();
    const tags = await client.getAllWikiTags();

    expect(tags).toHaveLength(3);
    expect(tags[0].name).toBe('howto');
    expect(tags[2].name).toBe('draft');
  });

  it('calls the /tags endpoint at wiki level', async () => {
    const fetch = vi.fn().mockResolvedValue({
      ok: true, status: 200, statusText: 'OK',
      json: () => Promise.resolve({ tags: [] }),
      headers: { get: () => null },
    });
    vi.stubGlobal('fetch', fetch);

    await new XWikiClient().getAllWikiTags();
    const [url] = fetch.mock.calls[0];
    expect(url).toContain('/wikis/xwiki/tags');
    expect(url).toContain('media=json');
    // Must not contain /spaces/ — this is wiki-level
    expect(url).not.toContain('/spaces/');
  });

  it('returns empty array when tags key is missing', async () => {
    vi.stubGlobal('fetch', mockFetch({}));
    const tags = await new XWikiClient().getAllWikiTags();
    expect(tags).toEqual([]);
  });

  it('throws XWikiError on 401', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false, status: 401, statusText: 'Unauthorized',
      headers: { get: () => null },
    }));
    await expect(new XWikiClient().getAllWikiTags()).rejects.toThrow(XWikiError);
  });
});

// ---------------------------------------------------------------------------
// Phase 5: getPagesByTag
// ---------------------------------------------------------------------------

describe('getPagesByTag', () => {
  it('returns pages for a tag mapped to PageSummary shape', async () => {
    vi.stubGlobal('fetch', mockFetch({
      pageSummaries: [
        { id: 'xwiki:Handbook.WebHome', fullName: 'Handbook.WebHome', title: 'Handbook', xwikiAbsoluteUrl: 'https://wiki.example.com/Handbook/WebHome' },
        { id: 'xwiki:Main.Docs', fullName: 'Main.Docs', title: 'Docs', xwikiAbsoluteUrl: 'https://wiki.example.com/Main/Docs' },
      ],
    }));

    const pages = await new XWikiClient().getPagesByTag('howto', 50);

    expect(pages).toHaveLength(2);
    expect(pages[0].title).toBe('Handbook');
    expect(pages[0].url).toBe('https://wiki.example.com/Handbook/WebHome');
    expect(pages[1].title).toBe('Docs');
  });

  it('URL-encodes the tag name', async () => {
    const fetch = vi.fn().mockResolvedValue({
      ok: true, status: 200, statusText: 'OK',
      json: () => Promise.resolve({ pageSummaries: [] }),
      headers: { get: () => null },
    });
    vi.stubGlobal('fetch', fetch);

    await new XWikiClient().getPagesByTag('Project Management', 10);
    const [url] = fetch.mock.calls[0];
    expect(url).toContain('/tags/Project%20Management');
    expect(url).toContain('number=10');
  });

  it('returns empty array when no pages have the tag', async () => {
    vi.stubGlobal('fetch', mockFetch({ pageSummaries: [] }));
    const pages = await new XWikiClient().getPagesByTag('NonExistentTag');
    expect(pages).toEqual([]);
  });

  it('throws XWikiError on non-OK response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false, status: 404, statusText: 'Not Found',
      headers: { get: () => null },
    }));
    await expect(new XWikiClient().getPagesByTag('MissingTag')).rejects.toThrow(XWikiError);
  });
});

// ---------------------------------------------------------------------------
// Phase 5: findPages
// ---------------------------------------------------------------------------

describe('findPages', () => {
  it('returns pages filtered by space', async () => {
    vi.stubGlobal('fetch', mockFetch({
      pageSummaries: [
        { id: 'xwiki:Sandbox.WebHome', fullName: 'Sandbox.WebHome', title: 'Sandbox Home', xwikiAbsoluteUrl: 'https://wiki.example.com/Sandbox/WebHome' },
        { id: 'xwiki:Sandbox.TestPage1', fullName: 'Sandbox.TestPage1', title: 'Test Page 1', xwikiAbsoluteUrl: '' },
      ],
    }));

    const pages = await new XWikiClient().findPages({ space: 'Sandbox' }, 50);
    expect(pages).toHaveLength(2);
    expect(pages[0].title).toBe('Sandbox Home');
  });

  it('deduplicates pages with the same fullName', async () => {
    vi.stubGlobal('fetch', mockFetch({
      pageSummaries: [
        { id: 'xwiki:Sandbox.WebHome', fullName: 'Sandbox.WebHome', title: 'Home' },
        { id: 'xwiki:Sandbox.WebHome', fullName: 'Sandbox.WebHome', title: 'Home' },
        { id: 'xwiki:Sandbox.Other', fullName: 'Sandbox.Other', title: 'Other' },
      ],
    }));

    const pages = await new XWikiClient().findPages({ space: 'Sandbox' });
    expect(pages).toHaveLength(2);
  });

  it('passes name, space, and author params to the URL', async () => {
    const fetch = vi.fn().mockResolvedValue({
      ok: true, status: 200, statusText: 'OK',
      json: () => Promise.resolve({ pageSummaries: [] }),
      headers: { get: () => null },
    });
    vi.stubGlobal('fetch', fetch);

    await new XWikiClient().findPages({ name: 'WebHome', space: 'Main', author: 'XWiki.Admin' }, 25);
    const [url] = fetch.mock.calls[0];
    expect(url).toContain('/wikis/xwiki/pages');
    expect(url).toContain('name=WebHome');
    expect(url).toContain('space=Main');
    expect(url).toContain('author=XWiki.Admin');
    expect(url).toContain('number=25');
  });

  it('omits undefined filter params', async () => {
    const fetch = vi.fn().mockResolvedValue({
      ok: true, status: 200, statusText: 'OK',
      json: () => Promise.resolve({ pageSummaries: [] }),
      headers: { get: () => null },
    });
    vi.stubGlobal('fetch', fetch);

    await new XWikiClient().findPages({ space: 'Sandbox' });
    const [url] = fetch.mock.calls[0];
    expect(url).toContain('space=Sandbox');
    expect(url).not.toContain('name=');
    expect(url).not.toContain('author=');
  });

  it('throws XWikiError on error response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false, status: 500, statusText: 'Internal Server Error',
      headers: { get: () => null },
    }));
    await expect(new XWikiClient().findPages({ space: 'Sandbox' })).rejects.toThrow(XWikiError);
  });
});

// ---------------------------------------------------------------------------
// Phase 5: exportPage
// ---------------------------------------------------------------------------

describe('exportPage', () => {
  it('returns ExportResult with base64 content and metadata', async () => {
    const pdfBytes = new TextEncoder().encode('%PDF-1.4 fake content');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true, status: 200, statusText: 'OK',
      arrayBuffer: () => Promise.resolve(pdfBytes.buffer),
      headers: {
        get: (key: string) => key === 'content-type' ? 'application/pdf;charset=UTF-8' : null,
      },
    }));

    const result = await new XWikiClient().exportPage('Main', 'WebHome');

    expect(result.space).toBe('Main');
    expect(result.page).toBe('WebHome');
    expect(result.format).toBe('pdf');
    expect(result.content_type).toContain('application/pdf');
    expect(result.size_bytes).toBeGreaterThan(0);
    expect(result.content_base64).toBeTruthy();
    // Verify base64 decode round-trips correctly
    const decoded = Buffer.from(result.content_base64!, 'base64').toString();
    expect(decoded).toContain('%PDF');
  });

  it('calls the /bin/export/ action URL with format=pdf', async () => {
    const fetch = vi.fn().mockResolvedValue({
      ok: true, status: 200, statusText: 'OK',
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(10)),
      headers: { get: () => 'application/pdf' },
    });
    vi.stubGlobal('fetch', fetch);

    await new XWikiClient().exportPage('Sandbox', 'TestPage');
    const [url] = fetch.mock.calls[0];
    expect(url).toContain('/bin/export/Sandbox/TestPage');
    expect(url).toContain('format=pdf');
    // Must NOT use REST path
    expect(url).not.toContain('/rest/wikis');
  });

  it('throws XWikiError on non-OK response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false, status: 500, statusText: 'Internal Server Error',
      headers: { get: () => null },
    }));
    await expect(new XWikiClient().exportPage('Main', 'WebHome')).rejects.toThrow(XWikiError);
  });
});

// ---------------------------------------------------------------------------
// Phase 5: getObjectProperty
// ---------------------------------------------------------------------------

describe('getObjectProperty', () => {
  // NOTE: single-property endpoint returns property at root level (name, value, type)
  // NOT wrapped in a properties array — confirmed against xWiki 18.x live API.

  it('returns the named property value from root-level response', async () => {
    vi.stubGlobal('fetch', mockFetch({
      name: 'priority',
      value: 'high',
      type: 'String',
      attributes: [],
    }));

    const prop = await new XWikiClient().getObjectProperty('Main', 'WebHome', 'Sandbox.Code.ExampleClass', 0, 'priority');
    expect(prop.name).toBe('priority');
    expect(prop.value).toBe('high');
    expect(prop.type).toBe('String');
  });

  it('calls the correct single-property endpoint URL', async () => {
    const fetch = vi.fn().mockResolvedValue({
      ok: true, status: 200, statusText: 'OK',
      json: () => Promise.resolve({ name: 'status', value: 'active', type: 'String' }),
      headers: { get: () => null },
    });
    vi.stubGlobal('fetch', fetch);

    await new XWikiClient().getObjectProperty('Sandbox', 'MyPage', 'MyApp.MyClass', 2, 'status');
    const [url] = fetch.mock.calls[0];
    expect(url).toContain('/spaces/Sandbox/pages/MyPage/objects/MyApp.MyClass/2/properties/status');
    expect(url).toContain('media=json');
  });

  it('throws XWikiError when response has no name or value (property not found)', async () => {
    vi.stubGlobal('fetch', mockFetch({ links: [] }));
    await expect(
      new XWikiClient().getObjectProperty('Main', 'WebHome', 'MyClass', 0, 'nonexistent'),
    ).rejects.toThrow(XWikiError);
  });

  it('throws XWikiError on 404 from server', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false, status: 404, statusText: 'Not Found',
      headers: { get: () => null },
    }));
    await expect(
      new XWikiClient().getObjectProperty('Main', 'WebHome', 'MyClass', 0, 'status'),
    ).rejects.toThrow(XWikiError);
  });

  it('handles null property value gracefully', async () => {
    vi.stubGlobal('fetch', mockFetch({ name: 'comment', value: null, type: 'TextArea' }));
    const prop = await new XWikiClient().getObjectProperty('Main', 'WebHome', 'MyClass', 0, 'comment');
    expect(prop.value).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// rollbackPage
// ---------------------------------------------------------------------------

describe('rollbackPage', () => {
  const history = (versions: string[]) => ({
    historySummaries: versions.map(v => ({ version: v, modified: 1791907981000, modifier: 'xwiki:XWiki.Someone' })),
  });

  it('POSTs the rollback action with rev, confirm and form_token, then reports the new version', async () => {
    const reply = (body: unknown, status = 200) => ({
      ok: status >= 200 && status < 300, status, statusText: String(status),
      json: () => Promise.resolve(body),
      headers: { get: (k: string) => (k === 'XWiki-Form-Token' ? 'test-csrf-token' : null) },
    });
    const fetch = vi.fn()
      .mockResolvedValueOnce(reply(history(['3.1', '2.1', '1.1'])))  // history check (also caches the CSRF token)
      .mockResolvedValueOnce(reply({}, 302))                          // rollback action
      .mockResolvedValueOnce(reply(history(['4.1'])));                // new latest version
    vi.stubGlobal('fetch', fetch);

    const result = await new XWikiClient().rollbackPage('Docs.User Guides.Setup', 'My Page', '2.1');

    const [url, opts] = fetch.mock.calls[1];
    const u = new URL(url);
    expect(u.pathname).toBe('/bin/rollback/Docs/User%20Guides/Setup/My%20Page');
    expect(u.searchParams.get('rev')).toBe('2.1');
    expect(u.searchParams.get('confirm')).toBe('1');
    expect(u.searchParams.get('form_token')).toBe('test-csrf-token');
    expect(opts.method).toBe('POST');
    expect(result).toEqual({ space: 'Docs.User Guides.Setup', page: 'My Page', rolled_back_to: '2.1', new_version: '4.1', status: 'rolled_back' });
  });

  it('refuses a version that is not in the page history', async () => {
    vi.stubGlobal('fetch', mockFetch(history(['2.1', '1.1'])));
    await expect(new XWikiClient().rollbackPage('Main', 'WebHome', '9.9')).rejects.toThrow('Version 9.9 not found');
  });
});

// ---------------------------------------------------------------------------
// updateClassProperties / addClassProperty
// ---------------------------------------------------------------------------

describe('class editing', () => {
  const reply = (body: unknown, status = 200) => ({
    ok: status >= 200 && status < 300, status, statusText: String(status),
    json: () => Promise.resolve(body),
    headers: { get: (k: string) => (k === 'XWiki-Form-Token' ? 'test-csrf-token' : null) },
  });
  const cls = (props: Array<[string, string, Record<string, string>]>) => ({
    id: 'xwiki:Sandbox.Code.ExampleClass',
    name: 'Sandbox.Code.ExampleClass',
    properties: props.map(([name, type, attrs]) => ({
      name, type, attributes: Object.entries(attrs).map(([n, v]) => ({ name: n, value: v })),
    })),
  });

  it('POSTs propupdate with {property}_{attribute} fields and form_token, then confirms by reading back', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(reply(cls([['status', 'StaticList', { hint: 'Old hint' }]])))
      .mockResolvedValueOnce(reply({}, 302))
      .mockResolvedValueOnce(reply(cls([['status', 'StaticList', { hint: 'Current state' }]])));
    vi.stubGlobal('fetch', fetch);

    const result = await new XWikiClient().updateClassProperties('Sandbox.Code.ExampleClass', { status: { hint: 'Current state' } });

    const [url, opts] = fetch.mock.calls[1];
    expect(new URL(url).pathname).toBe('/bin/propupdate/Sandbox/Code/ExampleClass');
    expect(opts.method).toBe('POST');
    const form = new URLSearchParams(opts.body);
    expect(form.get('status_hint')).toBe('Current state');
    expect(form.get('form_token')).toBe('test-csrf-token');
    expect(result).toEqual({
      class_name: 'Sandbox.Code.ExampleClass',
      changes: [{ property: 'status', attribute: 'hint', value: 'Current state' }],
      status: 'updated',
    });
  });

  it('reports an error when the read-back does not show the change', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(reply(cls([['status', 'StaticList', {}]])))
      .mockResolvedValueOnce(reply({}, 302))
      .mockResolvedValueOnce(reply(cls([['status', 'StaticList', {}]]))));
    await expect(new XWikiClient().updateClassProperties('Sandbox.Code.ExampleClass', { status: { hint: 'x' } }))
      .rejects.toThrow('not changed as asked: status.hint');
  });

  it('refuses unknown properties and renames without posting', async () => {
    const fetch = vi.fn().mockResolvedValue(reply(cls([['status', 'StaticList', {}]])));
    vi.stubGlobal('fetch', fetch);
    const client = new XWikiClient();
    await expect(client.updateClassProperties('Sandbox.Code.ExampleClass', { missing: { hint: 'x' } })).rejects.toThrow('Property not found');
    await expect(client.updateClassProperties('Sandbox.Code.ExampleClass', { status: { name: 'state' } })).rejects.toThrow('Renaming');
    expect(fetch.mock.calls.every(([, o]) => !o || o.method !== 'POST')).toBe(true);
  });

  it('POSTs propadd with propname and proptype, then sets attributes', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(reply(cls([])))                                           // exists check
      .mockResolvedValueOnce(reply({}, 302))                                           // propadd
      .mockResolvedValueOnce(reply(cls([['dueDate', 'Date', {}]])))                    // confirm added
      .mockResolvedValueOnce(reply(cls([['dueDate', 'Date', {}]])))                    // update: before
      .mockResolvedValueOnce(reply({}, 302))                                           // propupdate
      .mockResolvedValueOnce(reply(cls([['dueDate', 'Date', { hint: 'Due' }]])));      // update: after
    vi.stubGlobal('fetch', fetch);

    const result = await new XWikiClient().addClassProperty('Sandbox.Code.ExampleClass', 'dueDate', 'Date', { hint: 'Due' });

    const [url, opts] = fetch.mock.calls[1];
    expect(new URL(url).pathname).toBe('/bin/propadd/Sandbox/Code/ExampleClass');
    const form = new URLSearchParams(opts.body);
    expect(form.get('propname')).toBe('dueDate');
    expect(form.get('proptype')).toBe('Date');
    expect(new URL(fetch.mock.calls[4][0]).pathname).toBe('/bin/propupdate/Sandbox/Code/ExampleClass');
    expect(result).toEqual({ class_name: 'Sandbox.Code.ExampleClass', property: 'dueDate', type: 'Date', attributes: { hint: 'Due' }, status: 'added' });
  });

  it('refuses to add a property that already exists', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reply(cls([['dueDate', 'Date', {}]]))));
    await expect(new XWikiClient().addClassProperty('Sandbox.Code.ExampleClass', 'dueDate', 'Date')).rejects.toThrow('already exists');
  });
});

// ---------------------------------------------------------------------------
// getPageTree
// ---------------------------------------------------------------------------

describe('getPageTree', () => {
  // Docs.Guides.WebHome -> Setup (-> Install), Usage
  const children: Record<string, unknown[]> = {
    '/spaces/Docs/spaces/Guides/pages/WebHome/children': [
      { id: 'xwiki:Docs.Guides.Setup', fullName: 'Docs.Guides.Setup', space: 'Docs.Guides', name: 'Setup', title: 'Setup', xwikiAbsoluteUrl: 'https://wiki.example.com/Setup' },
      { id: 'xwiki:Docs.Guides.Usage', fullName: 'Docs.Guides.Usage', space: 'Docs.Guides', name: 'Usage', title: '', xwikiAbsoluteUrl: 'https://wiki.example.com/Usage' },
    ],
    '/spaces/Docs/spaces/Guides/pages/Setup/children': [
      { id: 'xwiki:Docs.Guides.Install', fullName: 'Docs.Guides.Install', space: 'Docs.Guides', name: 'Install', title: 'Install' },
      // A cycle back to the root is ignored
      { id: 'xwiki:Docs.Guides.WebHome', fullName: 'Docs.Guides.WebHome', space: 'Docs.Guides', name: 'WebHome', title: 'Guides' },
    ],
  };
  const objects: Record<string, unknown[]> = {
    // The root page's own object must be reported too
    '/spaces/Docs/spaces/Guides/pages/WebHome/objects': [{ className: 'Sandbox.Code.ExampleClass', number: 0 }],
    '/spaces/Docs/spaces/Guides/pages/Setup/objects': [
      { className: 'XWiki.TagClass', number: 0 },
      { className: 'Sandbox.Code.ExampleClass', number: 0 },
      { className: 'Sandbox.Code.ExampleClass', number: 1 },
    ],
    '/spaces/Docs/spaces/Guides/pages/Install/objects': [
      { className: 'Sandbox.Code.ExampleClass', number: 0 },
    ],
  };

  function treeFetch() {
    return vi.fn().mockImplementation((url: string) => {
      const path = new URL(url).pathname.replace('/rest/wikis/xwiki', '');
      const body = path.endsWith('/children')
        ? { pageSummaries: children[path] ?? [] }
        : path.endsWith('/objects')
          ? { objectSummaries: objects[path] ?? [] }
          : { title: 'Guides', content: '', syntax: 'xwiki/2.1', parent: 'Docs.WebHome', xwikiAbsoluteUrl: 'https://wiki.example.com/Guides' };
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body), headers: { get: () => null } });
    });
  }

  it('returns descendants depth-first with levels, child counts and classes', async () => {
    const fetch = treeFetch();
    vi.stubGlobal('fetch', fetch);

    const tree = await new XWikiClient().getPageTree('Docs.Guides', 'WebHome');

    expect(tree.root).toBe('Docs.Guides.WebHome');
    expect(tree.root_page).toEqual({
      reference: 'Docs.Guides.WebHome',
      title: 'Guides',
      level: 0,
      parent: 'Docs.WebHome',
      child_count: 2,
      url: 'https://wiki.example.com/Guides',
      classes: { 'Sandbox.Code.ExampleClass': 1 },
    });
    expect(tree.total_pages).toBe(3);
    expect(tree.truncated).toBe(false);
    expect(tree.pages.map(p => [p.reference, p.level, p.child_count])).toEqual([
      ['Docs.Guides.Setup', 1, 2],
      ['Docs.Guides.Install', 2, 0],
      ['Docs.Guides.Usage', 1, 0],
    ]);
    expect(tree.pages[0].classes).toEqual({ 'XWiki.TagClass': 1, 'Sandbox.Code.ExampleClass': 2 });
    expect(tree.pages[2].title).toBe('Usage');
    expect(tree.pages[2].classes).toEqual({});
    expect(tree.class_totals).toEqual({ 'XWiki.TagClass': 1, 'Sandbox.Code.ExampleClass': 3 });

    expect(fetch.mock.calls.some(c => String(c[0]).includes('/children') && String(c[0]).includes('hierarchy=parentchild'))).toBe(true);
  });

  it('honours max_depth, max_pages, hierarchy and include_objects', async () => {
    const fetch = treeFetch();
    vi.stubGlobal('fetch', fetch);
    const client = new XWikiClient();

    const shallow = await client.getPageTree('Docs.Guides', 'WebHome', { maxDepth: 1, includeObjects: false });
    expect(shallow.pages.map(p => p.reference)).toEqual(['Docs.Guides.Setup', 'Docs.Guides.Usage']);
    expect(shallow.pages[0].child_count).toBe(2);
    expect(shallow.class_totals).toBeUndefined();
    expect(fetch.mock.calls.some(c => String(c[0]).includes('/objects'))).toBe(false);

    const capped = await client.getPageTree('Docs.Guides', 'WebHome', { maxPages: 1, hierarchy: 'nestedpages' });
    expect(capped.total_pages).toBe(1);
    expect(capped.truncated).toBe(true);
    expect(fetch.mock.calls.some(c => String(c[0]).includes('hierarchy=nestedpages'))).toBe(true);
  });

  it('throws 404 when the root page does not exist', async () => {
    vi.stubGlobal('fetch', mockFetch({}, 404));
    await expect(new XWikiClient().getPageTree('Docs', 'Missing')).rejects.toMatchObject({ status: 404 });
  });
});

// ---------------------------------------------------------------------------
// v0.13 tools
// ---------------------------------------------------------------------------

/** Route mocked responses by method + REST path (or full action URL). */
function routeFetch(routes: Record<string, { status?: number; body?: unknown; headers?: Record<string, string> }>) {
  return vi.fn().mockImplementation((url: string, init?: RequestInit) => {
    const u = new URL(url);
    const key = `${init?.method ?? 'GET'} ${u.pathname.replace('/rest/wikis/xwiki', '')}`;
    const r = routes[key] ?? { status: 404, body: {} };
    const status = r.status ?? 200;
    const headers: Record<string, string> = { 'XWiki-Form-Token': 'test-csrf-token', ...(r.headers ?? {}) };
    return Promise.resolve({
      ok: status >= 200 && status < 300,
      status,
      statusText: String(status),
      json: () => Promise.resolve(r.body ?? {}),
      headers: { get: (k: string) => headers[k] ?? headers[k.toLowerCase()] ?? null },
    });
  });
}

describe('listClassObjects', () => {
  const summaries = {
    objectSummaries: [
      { className: 'Sandbox.Code.ExampleClass', number: 0, pageId: 'xwiki:Docs.Guides.Setup', space: 'Docs.Guides', pageName: 'Setup', pageVersion: '3.1', pageAuthor: 'xwiki:XWiki.JaneDoe', headline: 'First' },
      { className: 'Sandbox.Code.ExampleClass', number: 1, pageId: 'xwiki:Docs.Guides.Setup', space: 'Docs.Guides', pageName: 'Setup', headline: 'Second' },
    ],
  };

  it('maps summaries and reads each object in full', async () => {
    const fetch = routeFetch({
      'GET /classes/Sandbox.Code.ExampleClass/objects': { body: summaries },
      'GET /spaces/Docs/spaces/Guides/pages/Setup/objects/Sandbox.Code.ExampleClass/0': { body: { className: 'Sandbox.Code.ExampleClass', number: 0, properties: [{ name: 'status', value: 'open' }] } },
      'GET /spaces/Docs/spaces/Guides/pages/Setup/objects/Sandbox.Code.ExampleClass/1': { body: { className: 'Sandbox.Code.ExampleClass', number: 1, properties: [{ name: 'status', value: 'done' }] } },
    });
    vi.stubGlobal('fetch', fetch);

    const { objects, pagination } = await new XWikiClient().listClassObjects('Sandbox.Code.ExampleClass', 0, 2);

    expect(objects[0]).toMatchObject({ page: 'Docs.Guides.Setup', space: 'Docs.Guides', page_name: 'Setup', number: 0, page_author: 'JaneDoe', headline: 'First', properties: { status: 'open' } });
    expect(objects[1].properties).toEqual({ status: 'done' });
    expect(pagination).toEqual({ start: 0, limit: 2, has_more: true });
    expect(String(fetch.mock.calls[0][0])).toContain('number=2');
  });

  it('skips the per-object reads without include_properties and passes order=date', async () => {
    const fetch = routeFetch({ 'GET /classes/Sandbox.Code.ExampleClass/objects': { body: summaries } });
    vi.stubGlobal('fetch', fetch);

    const { objects, pagination } = await new XWikiClient().listClassObjects('Sandbox.Code.ExampleClass', 0, 50, 'date', false);

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(String(fetch.mock.calls[0][0])).toContain('order=date');
    expect(objects[0].properties).toBeUndefined();
    expect(pagination.has_more).toBe(false);
  });

  it('reads objects on pages whose space name has an escaped dot', async () => {
    const fetch = routeFetch({
      'GET /classes/Sandbox.Code.ExampleClass/objects': { body: { objectSummaries: [
        { className: 'Sandbox.Code.ExampleClass', number: 0, space: 'Docs.1\\.2 Notes', pageName: 'WebHome' },
      ] } },
      'GET /spaces/Docs/spaces/1.2%20Notes/pages/WebHome/objects/Sandbox.Code.ExampleClass/0': { body: { className: 'Sandbox.Code.ExampleClass', number: 0, properties: [{ name: 'status', value: 'open' }] } },
    });
    vi.stubGlobal('fetch', fetch);

    const { objects } = await new XWikiClient().listClassObjects('Sandbox.Code.ExampleClass', 0, 10);

    expect(objects[0]).toMatchObject({ space: 'Docs.1\\.2 Notes', page_name: 'WebHome', properties: { status: 'open' } });
  });
});

describe('scanClassObjects', () => {
  const cls = 'Sandbox.Code.ExampleClass';

  /** A wiki with `count` objects of the class, one per page Docs.P{i}; listing a range with a bad position fails. */
  function classFetch(count: number, opts: { badList?: number[]; badRead?: number[]; noClass?: boolean } = {}) {
    return vi.fn().mockImplementation((url: string) => {
      const u = new URL(url);
      const path = u.pathname.replace('/rest/wikis/xwiki', '');
      const reply = (status: number, body: unknown = {}) =>
        Promise.resolve({
          ok: status < 300, status, statusText: String(status),
          json: () => Promise.resolve(body), text: () => Promise.resolve(status < 300 ? '' : 'Class not found'),
          headers: { get: () => null },
        });
      if (path === `/classes/${cls}`) return reply(opts.noClass ? 404 : 200, { id: cls, name: cls, properties: [] });
      if (path === `/classes/${cls}/objects`) {
        if (opts.noClass) return reply(404);
        const start = Number(u.searchParams.get('start'));
        const n = Number(u.searchParams.get('number'));
        const range = Array.from({ length: Math.max(0, Math.min(n, count - start)) }, (_, i) => start + i);
        if (range.some(i => opts.badList?.includes(i))) return reply(500);
        return reply(200, { objectSummaries: range.map(i => ({ className: cls, number: 0, space: 'Docs', pageName: `P${i}` })) });
      }
      const m = path.match(/^\/spaces\/Docs\/pages\/P(\d+)\/objects\/[^/]+\/0$/);
      if (m) {
        const i = Number(m[1]);
        if (opts.badRead?.includes(i)) return reply(500);
        return reply(200, { className: cls, number: 0, properties: [{ name: 'code', value: `value ${i}` }] });
      }
      return reply(404);
    });
  }

  async function collect(gen: AsyncGenerator<import('./types.js').ClassObjectScanBatch>) {
    const batches = [];
    for await (const b of gen) batches.push(b);
    return batches;
  }

  it('reads the objects in batches with their positions and stops at the end of the list', async () => {
    const fetch = classFetch(5);
    vi.stubGlobal('fetch', fetch);
    const batches = await collect(new XWikiClient().scanClassObjects(cls, 0, 100, 2));
    expect(batches.map(b => [b.start, b.end, b.objects.length, b.exhausted])).toEqual([[0, 2, 2, false], [2, 4, 2, false], [4, 6, 1, false], [6, 8, 0, true]]);
    expect(batches[2].objects[0]).toMatchObject({ position: 4, object: { page: 'Docs.P4', properties: { code: 'value 4' } } });
  });

  it('stops at count', async () => {
    vi.stubGlobal('fetch', classFetch(50));
    const batches = await collect(new XWikiClient().scanClassObjects(cls, 10, 5, 100));
    expect(batches).toHaveLength(1);
    expect(batches[0]).toMatchObject({ start: 10, end: 15, exhausted: false });
    expect(batches[0].objects.map(o => o.position)).toEqual([10, 11, 12, 13, 14]);
  });

  it('splits a failing batch and skips the positions and objects that cannot be read', async () => {
    vi.stubGlobal('fetch', classFetch(8, { badList: [5], badRead: [2] }));
    const [batch] = await collect(new XWikiClient().scanClassObjects(cls, 0, 8, 8));
    expect(batch.objects.map(o => o.position)).toEqual([0, 1, 3, 4, 6, 7]);
    expect(batch.skipped).toEqual(expect.arrayContaining([
      { position: 5, error: expect.stringContaining('500') },
      { page: 'Docs.P2', number: 0, error: expect.stringContaining('500') },
    ]));
    expect(batch.skipped).toHaveLength(2);
  });

  it('throws for a class that does not exist and for refused credentials', async () => {
    vi.stubGlobal('fetch', classFetch(0, { noClass: true }));
    await expect(collect(new XWikiClient().scanClassObjects(cls, 0, 10))).rejects.toMatchObject({ status: 404 });
    vi.stubGlobal('fetch', mockFetch({}, 401));
    await expect(collect(new XWikiClient().scanClassObjects(cls, 0, 10))).rejects.toMatchObject({ status: 401 });
  });
});

describe('removeTags', () => {
  it('PUTs the remaining tags and reports what was removed', async () => {
    const fetch = routeFetch({
      'GET /spaces/Main/pages/WebHome/tags': { body: { tags: [{ name: 'draft' }, { name: 'guide' }, { name: 'review' }] } },
      'GET ': { body: {} },
      'PUT /spaces/Main/pages/WebHome/tags': { body: {} },
    });
    vi.stubGlobal('fetch', fetch);

    const result = await new XWikiClient().removeTags('Main', 'WebHome', ['draft', 'review', 'missing']);

    expect(result).toEqual({ removed: ['draft', 'review'], not_found: ['missing'], tags: ['guide'] });
    const put = fetch.mock.calls.find(c => c[1]?.method === 'PUT')!;
    expect(put[1].body).toContain('<tag name="guide"/>');
    expect(put[1].body).not.toContain('draft');
  });

  it('does not write when none of the tags are on the page', async () => {
    const fetch = routeFetch({ 'GET /spaces/Main/pages/WebHome/tags': { body: { tags: [{ name: 'guide' }] } } });
    vi.stubGlobal('fetch', fetch);

    const result = await new XWikiClient().removeTags('Main', 'WebHome', ['draft']);

    expect(result).toEqual({ removed: [], not_found: ['draft'], tags: ['guide'] });
    expect(fetch.mock.calls.some(c => c[1]?.method === 'PUT')).toBe(false);
  });
});

describe('searchAttachments', () => {
  const body = {
    attachments: [{ name: 'diagram.png', pageId: 'xwiki:Docs.Guides.Setup', longSize: 2048, mimeType: 'image/png', author: 'xwiki:XWiki.JaneDoe', date: 1700000000000, version: '1.2', xwikiAbsoluteUrl: 'https://wiki.example.com/download/diagram.png' }],
  };

  it('searches the whole wiki with filters', async () => {
    const fetch = routeFetch({ 'GET /attachments': { body } });
    vi.stubGlobal('fetch', fetch);

    const { attachments, pagination } = await new XWikiClient().searchAttachments({ name: 'diagram', types: 'image' }, 0, 25);

    expect(attachments[0]).toMatchObject({ name: 'diagram.png', page: 'Docs.Guides.Setup', size_bytes: 2048, mime_type: 'image/png', author: 'JaneDoe', version: '1.2' });
    expect(attachments[0].date).toMatch(/^2023-/);
    expect(pagination.has_more).toBe(false);
    const url = String(fetch.mock.calls[0][0]);
    expect(url).toContain('name=diagram');
    expect(url).toContain('types=image');
  });

  it('uses the space endpoint when a space is given', async () => {
    const fetch = routeFetch({ 'GET /spaces/Docs/spaces/Guides/attachments': { body } });
    vi.stubGlobal('fetch', fetch);

    await new XWikiClient().searchAttachments({ space: 'Docs.Guides' });

    expect(String(fetch.mock.calls[0][0])).toContain('/spaces/Docs/spaces/Guides/attachments');
  });
});

describe('movePage', () => {
  const page = (url: string) => ({ body: { id: 'x', fullName: 'x', title: 'T', content: '', syntax: 'xwiki/2.1', xwikiAbsoluteUrl: url } });
  const renameOk = { headers: { location: 'https://wiki.example.com/bin/view/Docs/Guides/?xpage=rename&renameId=123' } };

  it('posts the rename form for a nested page and confirms the target', async () => {
    let moved = false;
    const rest = routeFetch({
      'GET /spaces/Docs/spaces/Guides/pages/WebHome': page('https://wiki.example.com/bin/view/Docs/Guides/'),
      'GET /query': { body: { searchResults: [] } },
      'GET ': { body: {} },
    });
    const fetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url.startsWith('https://wiki.example.com/bin/view/')) {
        moved = true;
        return Promise.resolve({ ok: false, status: 302, statusText: '302', json: () => Promise.resolve({}),
          headers: { get: (k: string) => (k === 'location' ? renameOk.headers.location : null) } });
      }
      // The target exists only after the rename form was posted.
      if (url.includes('/spaces/Docs/spaces/Manuals/pages/WebHome')) {
        return moved
          ? Promise.resolve({ ok: true, status: 200, statusText: 'OK', json: () => Promise.resolve(page('https://wiki.example.com/bin/view/Docs/Manuals/').body), headers: { get: () => null } })
          : Promise.resolve({ ok: false, status: 404, statusText: '404', json: () => Promise.resolve({}), headers: { get: () => null } });
      }
      return rest(url, init);
    });
    vi.stubGlobal('fetch', fetch);

    const result = await new XWikiClient().movePage('Docs.Guides', 'WebHome', 'Docs.Manuals', 'WebHome');

    expect(result).toMatchObject({ from: 'Docs.Guides.WebHome', to: 'Docs.Manuals.WebHome', url: 'https://wiki.example.com/bin/view/Docs/Manuals/', children_moved: true, links_updated: true, backlinks_found: 0, redirect_left: false, status: 'moved' });
    const post = fetch.mock.calls.find(c => c[1]?.method === 'POST')!;
    expect(post[0]).toBe('https://wiki.example.com/bin/view/Docs/Guides/WebHome');
    const form = new URLSearchParams(String(post[1].body));
    expect(Object.fromEntries(form)).toMatchObject({
      xpage: 'rename', step: '2', newSpaceName: 'Docs', newPageName: 'Manuals', terminal: 'false',
      deep: 'true', updateLinks: 'true', autoRedirect: 'false', newPageTitle: 'T', form_token: 'test-csrf-token',
    });
  });

  it('maps a terminal target and refuses an existing target', async () => {
    const fetch = routeFetch({
      'GET /spaces/Docs/spaces/Guides/pages/Setup': page('u'),
      'GET /spaces/Docs/spaces/Guides/pages/Install': page('u'),
    });
    vi.stubGlobal('fetch', fetch);

    await expect(new XWikiClient().movePage('Docs.Guides', 'Setup', 'Docs.Guides', 'Install'))
      .rejects.toMatchObject({ status: 409 });
    expect(fetch.mock.calls.some(c => c[1]?.method === 'POST')).toBe(false);
  });

  it('reports a move that was not started when XWiki does not redirect to the status page', async () => {
    const fetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url.startsWith('https://wiki.example.com/bin/view/')) {
        return Promise.resolve({ ok: true, status: 200, statusText: 'OK', json: () => Promise.resolve({}), headers: { get: () => null } });
      }
      return routeFetch({ 'GET /spaces/Docs/spaces/Guides/pages/Setup': page('u'), 'GET ': { body: {} } })(url, init);
    });
    vi.stubGlobal('fetch', fetch);

    await expect(new XWikiClient().movePage('Docs.Guides', 'Setup', 'Docs.Guides', 'Install'))
      .rejects.toThrow('Move was not started');
    const post = fetch.mock.calls.find(c => c[1]?.method === 'POST')!;
    const form = new URLSearchParams(String(post[1].body));
    expect(form.get('newSpaceName')).toBe('Docs.Guides');
    expect(form.get('newPageName')).toBe('Install');
    expect(form.get('terminal')).toBe('true');
  });
});

describe('getRequiredRights', () => {
  it('summarises declared rights, needed rights and findings as plain text', async () => {
    vi.stubGlobal('fetch', routeFetch({
      'GET /spaces/Main/pages/WebHome/requiredRights': {
        body: {
          analysisResults: [{
            entityReference: 'xwiki:Main.WebHome',
            summaryMessageHTML: '<p>The <strong>groovy</strong> macro needs &quot;programming&quot; right.</p>',
            requiredRights: [{ right: 'programming', entityType: 'DOCUMENT', manualReviewNeeded: false }],
          }],
          currentRights: { enforce: true, rights: [{ right: 'script', scope: 'DOCUMENT' }] },
          availableRights: [
            { right: 'script', scope: 'DOCUMENT', hasRight: true, definitelyRequiredRight: false, maybeRequiredRight: false },
            { right: 'programming', scope: '', hasRight: false, definitelyRequiredRight: true, maybeRequiredRight: false },
          ],
        },
      },
    }));

    const report = await new XWikiClient().getRequiredRights('Main', 'WebHome');

    expect(report).toEqual({
      page: 'Main.WebHome',
      declared: { enforce: true, rights: [{ right: 'script', scope: 'DOCUMENT' }] },
      needed: [{ right: 'programming', scope: undefined, definitely: true, current_user_has: false }],
      findings: [{
        entity: 'xwiki:Main.WebHome',
        summary: 'The groovy macro needs "programming" right.',
        rights: [{ right: 'programming', entity_type: 'DOCUMENT', manual_review: false }],
      }],
    });
  });
});

// ---------------------------------------------------------------------------
// v0.14 tools
// ---------------------------------------------------------------------------

/** Stateful mock: each route is a body, or a function of (url, init) returning { status, body, headers }. */
type Reply = { status?: number; body?: unknown; headers?: Record<string, string> };
function statefulFetch(routes: Record<string, Reply | ((u: URL, init?: RequestInit) => Reply)>) {
  return vi.fn().mockImplementation((url: string, init?: RequestInit) => {
    const u = new URL(url);
    const key = `${init?.method ?? 'GET'} ${u.pathname.replace('/rest/wikis/xwiki', '')}`;
    const route = routes[key];
    const r: Reply = typeof route === 'function' ? route(u, init) : route ?? { status: 404 };
    const status = r.status ?? 200;
    const headers: Record<string, string> = { 'XWiki-Form-Token': 'test-csrf-token', ...(r.headers ?? {}) };
    return Promise.resolve({
      ok: status >= 200 && status < 300,
      status,
      statusText: String(status),
      json: () => Promise.resolve(r.body ?? {}),
      arrayBuffer: () => Promise.resolve(r.body instanceof Uint8Array
        ? r.body.buffer.slice(r.body.byteOffset, r.body.byteOffset + r.body.byteLength)
        : new TextEncoder().encode(String(r.body ?? '')).buffer),
      text: () => Promise.resolve(typeof r.body === 'string' ? r.body : JSON.stringify(r.body ?? {})),
      headers: { get: (k: string) => headers[k] ?? headers[k.toLowerCase()] ?? null },
    });
  });
}
const pageBody = (url: string) => ({ body: { id: 'x', fullName: 'x', title: 'T', content: '', syntax: 'xwiki/2.1', xwikiAbsoluteUrl: url } });
const formOf = (fetch: ReturnType<typeof vi.fn>, method = 'POST') =>
  Object.fromEntries(new URLSearchParams(String(fetch.mock.calls.find(c => c[1]?.method === method)![1].body)));

describe('copyPage', () => {
  it('posts the copy form and confirms the copy', async () => {
    let copied = false;
    const fetch = statefulFetch({
      'GET ': { body: {} },
      'GET /spaces/Docs/spaces/Guides/pages/WebHome': pageBody('src'),
      'GET /spaces/Docs/spaces/Manuals/pages/WebHome': () => (copied ? pageBody('https://wiki.example.com/bin/view/Docs/Manuals/') : { status: 404 }),
      'POST /bin/view/Docs/Guides/WebHome': () => { copied = true; return { status: 302, headers: { location: '/bin/view/Docs/Guides/?xpage=copy&copyId=42' } }; },
    });
    vi.stubGlobal('fetch', fetch);

    const result = await new XWikiClient().copyPage('Docs.Guides', 'WebHome', 'Docs.Manuals', 'WebHome', { newTitle: 'Manuals' });

    expect(result).toEqual({ from: 'Docs.Guides.WebHome', to: 'Docs.Manuals.WebHome', children_copied: true, url: 'https://wiki.example.com/bin/view/Docs/Manuals/', status: 'copied' });
    expect(formOf(fetch)).toMatchObject({
      xpage: 'copy', sourceSpaceName: 'Docs.Guides', sourcePageName: 'WebHome', targetSpaceName: 'Docs',
      targetPageName: 'Manuals', terminal: 'false', deep: 'true', targetPageTitle: 'Manuals', form_token: 'test-csrf-token',
    });
  });

  it('refuses an existing target without posting', async () => {
    const fetch = statefulFetch({
      'GET /spaces/Docs/spaces/Guides/pages/Setup': pageBody('a'),
      'GET /spaces/Docs/spaces/Guides/pages/Install': pageBody('b'),
    });
    vi.stubGlobal('fetch', fetch);
    await expect(new XWikiClient().copyPage('Docs.Guides', 'Setup', 'Docs.Guides', 'Install')).rejects.toMatchObject({ status: 409 });
    expect(fetch.mock.calls.some(c => c[1]?.method === 'POST')).toBe(false);
  });
});

describe('recycle bin', () => {
  it('lists deleted pages with their recycle-bin ids', async () => {
    const fetch = statefulFetch({
      'GET /bin/get/XWiki/DeletedDocumentsJSON': {
        body: {
          totalrows: 3,
          rows: [{
            fullname: 'Docs.Guides.Setup', title: 'Setup', restoreUrl: '/bin/undelete/Docs/Guides/Setup?id=17&form_token=t',
            canRestore: true, alreadyExists: false, date: '2026/10/20 10:00', deleter: 'XWiki.JaneDoe', language: '', batchId: 'b-1',
          }],
        },
      },
    });
    vi.stubGlobal('fetch', fetch);

    const { pages, pagination } = await new XWikiClient().listDeletedPages('Guides', 0, 1);

    expect(pages).toEqual([{ id: 17, page: 'Docs.Guides.Setup', title: 'Setup', language: undefined, deleted_by: 'JaneDoe', deleted_date: '2026/10/20 10:00', batch_id: 'b-1', can_restore: true, page_exists_again: false }]);
    expect(pagination).toEqual({ total: 3, start: 0, limit: 1, has_more: true });
    const url = new URL(fetch.mock.calls[0][0]);
    expect(url.searchParams.get('ddoc.fullName')).toBe('Guides');
    expect(url.searchParams.get('offset')).toBe('1');
    expect(url.searchParams.get('reqNo')).toBe('1');
  });

  it('falls back to the core template when DeletedDocumentsJSON is missing, filtering by name here', async () => {
    const fetch = statefulFetch({
      'GET /bin/get/XWiki/DeletedDocumentsJSON': { body: '' },
      'GET /bin/get/Main/WebHome': {
        body: {
          totalrows: 2,
          rows: [
            { doc_viewable: true, doc_fullName: 'Docs.Guides.Setup', doc_name: 'Setup', doc_deleter: 'Jane Doe', doc_date: '2026/10/20', doc_hasrestore: true, doc_restore_url: '/bin/undelete/Docs/Guides/Setup?id=17&form_token=t' },
            { doc_viewable: true, doc_fullName: 'Main.Other', doc_name: 'Other', doc_hasrestore: true, doc_restore_url: '/bin/undelete/Main/Other?id=18' },
          ],
        },
      },
    });
    vi.stubGlobal('fetch', fetch);

    const { pages, pagination } = await new XWikiClient().listDeletedPages('guides', 0, 10);

    expect(pages).toEqual([{ id: 17, page: 'Docs.Guides.Setup', title: 'Setup', language: undefined, deleted_by: 'Jane Doe', deleted_date: '2026/10/20', can_restore: true }]);
    expect(pagination).toEqual({ total: 1, start: 0, limit: 10, has_more: false });
    expect(new URL(fetch.mock.calls[1][0]).searchParams.get('xpage')).toBe('getdeleteddocuments');
  });

  it('restores a page by id and confirms it exists', async () => {
    let restored = false;
    const fetch = statefulFetch({
      'GET ': { body: {} },
      'GET /spaces/Docs/spaces/Guides/pages/Setup': () => (restored ? pageBody('https://wiki.example.com/bin/view/Docs/Guides/Setup') : { status: 404 }),
      'POST /bin/undelete/Docs/Guides/Setup': () => { restored = true; return { status: 302, headers: { location: '/bin/view/Docs/Guides/Setup' } }; },
    });
    vi.stubGlobal('fetch', fetch);

    const result = await new XWikiClient().restorePage('Docs.Guides', 'Setup', 17);

    expect(result).toEqual({ page: 'Docs.Guides.Setup', id: 17, url: 'https://wiki.example.com/bin/view/Docs/Guides/Setup', status: 'restored' });
    expect(formOf(fetch)).toEqual({ id: '17', form_token: 'test-csrf-token' });
  });

  it('refuses to restore over an existing page', async () => {
    vi.stubGlobal('fetch', statefulFetch({ 'GET /spaces/Docs/spaces/Guides/pages/Setup': pageBody('a') }));
    await expect(new XWikiClient().restorePage('Docs.Guides', 'Setup', 17)).rejects.toMatchObject({ status: 409 });
  });
});

describe('setClassPropertyEnabled', () => {
  it('posts propdisable and checks the disabled flag', async () => {
    let disabled = '0';
    const fetch = statefulFetch({
      'GET ': { body: {} },
      'GET /classes/Sandbox.Code.ExampleClass': () => ({ body: { id: 'Sandbox.Code.ExampleClass', name: 'Sandbox.Code.ExampleClass', properties: [{ name: 'status', type: 'String', attributes: [{ name: 'disabled', value: disabled }] }] } }),
      'POST /bin/propdisable/Sandbox/Code/ExampleClass': () => { disabled = '1'; return { status: 302 }; },
    });
    vi.stubGlobal('fetch', fetch);

    const result = await new XWikiClient().setClassPropertyEnabled('Sandbox.Code.ExampleClass', 'status', false);

    expect(result).toEqual({ class_name: 'Sandbox.Code.ExampleClass', property: 'status', enabled: false, confirmed: true, status: 'disabled' });
    expect(formOf(fetch)).toEqual({ propname: 'status', form_token: 'test-csrf-token' });
  });

  it('rejects an unknown property without posting', async () => {
    const fetch = statefulFetch({ 'GET /classes/Sandbox.Code.ExampleClass': { body: { properties: [] } } });
    vi.stubGlobal('fetch', fetch);
    await expect(new XWikiClient().setClassPropertyEnabled('Sandbox.Code.ExampleClass', 'nope', true)).rejects.toMatchObject({ status: 404 });
    expect(fetch.mock.calls.some(c => c[1]?.method === 'POST')).toBe(false);
  });
});

describe('moveAttachment', () => {
  it('posts the move form, polls the job and confirms the target', async () => {
    let moved = false;
    let polls = 0;
    const fetch = statefulFetch({
      'GET ': { body: {} },
      'GET /spaces/Docs/spaces/Guides/pages/Setup/attachments': () => ({ body: { attachments: moved ? [] : [{ name: 'old.png' }] } }),
      'GET /spaces/Docs/spaces/Guides/pages/Install/attachments': () => ({ body: { attachments: moved ? [{ name: 'new.png', xwikiAbsoluteUrl: 'https://wiki.example.com/download/new.png' }] : [] } }),
      'POST /bin/view/Docs/Guides/Setup': () => ({ status: 302, headers: { location: '/bin/view/Docs/Guides/Setup?xpage=attachment%2Fmove&moveId=99' } }),
      'GET /bin/get/Docs/Guides/Setup': (u) => {
        expect(u.searchParams.get('moveId')).toBe('99');
        polls++;
        if (polls === 2) moved = true;
        return { body: { state: polls < 2 ? 'RUNNING' : 'FINISHED', log: { items: [] } } };
      },
    });
    vi.stubGlobal('fetch', fetch);
    const client = new XWikiClient();
    client.pollIntervalMs = 0;

    const result = await client.moveAttachment('Docs.Guides', 'Setup', 'old.png', 'Docs.Guides', 'Install', 'new.png');

    expect(result).toEqual({ from: 'Docs.Guides.Setup@old.png', to: 'Docs.Guides.Install@new.png', references_updated: true, redirect_left: false, download_url: 'https://wiki.example.com/download/new.png', status: 'moved' });
    expect(polls).toBe(2);
    expect(formOf(fetch)).toMatchObject({
      xpage: 'attachment/move', step: '2', sourceLocation: 'Docs.Guides.Setup', sourceAttachmentName: 'old.png',
      targetLocation: 'Docs.Guides.Install', targetAttachmentName: 'new.png', updateReferences: 'true', autoRedirect: 'false',
    });
  });

  it('reports an error logged by the move job', async () => {
    const fetch = statefulFetch({
      'GET ': { body: {} },
      'GET /spaces/Main/pages/WebHome/attachments': { body: { attachments: [{ name: 'a.png' }] } },
      'POST /bin/view/Main/WebHome': { status: 302, headers: { location: '?moveId=1' } },
      'GET /bin/get/Main/WebHome': { body: { state: 'FINISHED', log: { items: [{ level: 'error', renderedMessage: '<p>Disk full</p>' }] } } },
    });
    vi.stubGlobal('fetch', fetch);
    await expect(new XWikiClient().moveAttachment('Main', 'WebHome', 'a.png', 'Main', 'WebHome', 'b.png'))
      .rejects.toThrow('Attachment move failed: Disk full');
  });
});

describe('getAttachmentHistory / getClassPropertyValues', () => {
  it('maps attachment versions', async () => {
    vi.stubGlobal('fetch', statefulFetch({
      'GET /spaces/Main/pages/WebHome/attachments/a.png/history': { body: { attachments: [{ name: 'a.png', version: '1.2', longSize: 10, mimeType: 'image/png', author: 'xwiki:XWiki.JaneDoe', date: 1700000000000, xwikiAbsoluteUrl: 'u' }] } },
    }));
    const versions = await new XWikiClient().getAttachmentHistory('Main', 'WebHome', 'a.png');
    expect(versions[0]).toMatchObject({ version: '1.2', size_bytes: 10, mime_type: 'image/png', author: 'JaneDoe', download_url: 'u' });
  });

  it('maps property values with labels and passes the filter', async () => {
    const fetch = statefulFetch({
      'GET /classes/Sandbox.Code.ExampleClass/properties/owner/values': { body: { propertyValues: [{ value: 'XWiki.JaneDoe', metaData: { label: 'Jane Doe' } }, { value: 'red', metaData: { label: 'red' } }] } },
    });
    vi.stubGlobal('fetch', fetch);
    const values = await new XWikiClient().getClassPropertyValues('Sandbox.Code.ExampleClass', 'owner', 'Jan', 10);
    expect(values).toEqual([{ value: 'XWiki.JaneDoe', label: 'Jane Doe' }, { value: 'red' }]);
    const url = new URL(fetch.mock.calls[0][0]);
    expect(url.searchParams.get('fp')).toBe('Jan');
    expect(url.searchParams.get('limit')).toBe('10');
  });
});

describe('comparePageVersions', () => {
  it('diffs two versions and reports title changes', async () => {
    const version = (v: string, title: string, content: string) => ({ body: { title, content, syntax: 'xwiki/2.1', version: v, author: 'XWiki.JaneDoe' } });
    vi.stubGlobal('fetch', statefulFetch({
      'GET /spaces/Main/pages/WebHome/history/1.1': version('1.1', 'Old', 'a\nb\nc\nd'),
      'GET /spaces/Main/pages/WebHome/history/2.1': version('2.1', 'New', 'a\nB\nc\nd\ne'),
      'GET /spaces/Main/pages/WebHome/history': { body: { historySummaries: [{ version: '2.1' }, { version: '1.1' }] } },
    }));

    const cmp = await new XWikiClient().comparePageVersions('Main', 'WebHome', '1.1', '2.1', 1);

    expect(cmp.title_change).toEqual({ from: 'Old', to: 'New' });
    expect(cmp.syntax_change).toBeUndefined();
    expect(cmp.lines_added).toBe(2);
    expect(cmp.lines_removed).toBe(1);
    expect(cmp.diff).toBe('@@ -1,4 +1,5 @@\n a\n-b\n+B\n c\n d\n+e');
  });

  it('gives the current version its own date, not the page\'s last content change', async () => {
    vi.stubGlobal('fetch', statefulFetch({
      // Page and version reads are dated by the last content change (2.1), even after object-only saves.
      'GET /spaces/Main/pages/WebHome': { body: { title: 'T', content: 'a\nb', version: '9.1', modified: 2000, author: 'XWiki.JaneDoe' } },
      'GET /spaces/Main/pages/WebHome/history/1.1': { body: { title: 'T', content: 'a', version: '1.1', modified: 1000 } },
      'GET /spaces/Main/pages/WebHome/history': { body: { historySummaries: [
        { version: '9.1', modified: 9000 }, { version: '2.1', modified: 2000 }, { version: '1.1', modified: 1000 },
      ] } },
    }));

    const cmp = await new XWikiClient().comparePageVersions('Main', 'WebHome', '1.1');

    expect(cmp.to).toEqual({ version: '9.1', author: 'XWiki.JaneDoe', date: new Date(9000).toISOString() });
    expect(cmp.from.date).toBe(new Date(1000).toISOString());
    expect(cmp.lines_added).toBe(1);
  });
});

describe('pageContentHtml', () => {
  it('keeps the content area of a skin page, nested elements included', async () => {
    const { pageContentHtml } = await import('./client.js');
    const html = '<html><script>x()</script><nav><div>menu</div></nav><div class="row"><div id="xwikicontent" class="col">'
      + '<div class="box"><p>Hi</p></div><p>There</p></div></div><footer><div>f</div></footer></html>';
    expect(pageContentHtml(html)).toBe('<div class="box"><p>Hi</p></div><p>There</p>');
  });

  it('drops scripts when there is no content area', async () => {
    const { pageContentHtml } = await import('./client.js');
    expect(pageContentHtml('<p>a</p><script>b()</script><p>c</p>')).toBe('<p>a</p><p>c</p>');
  });
});

describe('unifiedDiff', () => {
  it('returns nothing for identical text and splits distant changes into hunks', async () => {
    const { unifiedDiff } = await import('./diff.js');
    expect(unifiedDiff('x', 'x')).toEqual({ diff: '', added: 0, removed: 0 });
    const before = Array.from({ length: 20 }, (_, i) => `l${i}`).join('\n');
    const after = before.replace('l2', 'L2').replace('l17', 'L17');
    const { diff } = unifiedDiff(before, after, 1);
    expect(diff.split('\n').filter(l => l.startsWith('@@'))).toEqual(['@@ -2,3 +2,3 @@', '@@ -17,3 +17,3 @@']);
  });
});

describe('comments', () => {
  it('updates a comment through its XWikiComments object and reads it back', async () => {
    let text = 'old';
    const fetch = statefulFetch({
      'GET ': { body: {} },
      'GET /spaces/Main/pages/WebHome/objects/XWiki.XWikiComments/2': { body: { className: 'XWiki.XWikiComments', number: 2, properties: [] } },
      'PUT /spaces/Main/pages/WebHome/objects/XWiki.XWikiComments/2': (_u, init) => { text = new URLSearchParams(String(init?.body)).get('property#comment') ?? ''; return { body: { className: 'XWiki.XWikiComments', number: 2, properties: [] } }; },
      'GET /spaces/Main/pages/WebHome/comments': () => ({ body: { comments: [{ id: 2, text, author: 'XWiki.JaneDoe' }] } }),
    });
    vi.stubGlobal('fetch', fetch);

    const comment = await new XWikiClient().updateComment('Main', 'WebHome', 2, 'new');

    expect(comment).toMatchObject({ id: 2, text: 'new' });
  });

  it('deletes a comment object after checking it exists', async () => {
    const fetch = statefulFetch({
      'GET ': { body: {} },
      'GET /spaces/Main/pages/WebHome/objects/XWiki.XWikiComments/2': { body: { className: 'XWiki.XWikiComments', number: 2 } },
      'DELETE /spaces/Main/pages/WebHome/objects/XWiki.XWikiComments/2': { status: 204 },
    });
    vi.stubGlobal('fetch', fetch);
    expect(await new XWikiClient().deleteComment('Main', 'WebHome', 2)).toEqual({ id: 2, status: 'deleted' });
    expect(fetch.mock.calls.some(c => c[1]?.method === 'DELETE')).toBe(true);
  });
});

describe('exportPage formats', () => {
  it('POSTs a XAR export with the page and its children', async () => {
    const fetch = statefulFetch({
      'GET ': { body: {} },
      'POST /bin/export/Docs/Guides/WebHome': { body: 'PK', headers: { 'content-type': 'application/zip' } },
    });
    vi.stubGlobal('fetch', fetch);

    const result = await new XWikiClient().exportPage('Docs.Guides', 'WebHome', 'xar', { children: true, history: true });

    expect(result).toMatchObject({ format: 'xar', content_type: 'application/zip', size_bytes: 2 });
    const post = fetch.mock.calls.find(c => c[1]?.method === 'POST')!;
    const form = new URLSearchParams(String(post[1].body));
    expect(form.getAll('pages')).toEqual(['Docs.Guides.WebHome', 'Docs.Guides.%']);
    expect(form.get('history')).toBe('true');
    expect(new URL(post[0]).searchParams.get('format')).toBe('xar');
  });

  it('treats an HTML answer to a XAR export as refused', async () => {
    vi.stubGlobal('fetch', statefulFetch({
      'GET ': { body: {} },
      'POST /bin/export/Main/WebHome': { body: '<html>', headers: { 'content-type': 'text/html;charset=UTF-8' } },
    }));
    await expect(new XWikiClient().exportPage('Main', 'WebHome', 'xar')).rejects.toThrow('needs wiki admin rights');
  });
});


describe('file size limit', () => {
  it('refuses a download over XWIKI_MCP_MAX_FILE_BYTES with the URL to open instead', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true, status: 200, statusText: 'OK',
      arrayBuffer: () => Promise.resolve(new Uint8Array(2048).buffer),
      headers: { get: (k: string) => (k === 'content-length' ? '2048' : 'application/pdf') },
    }));
    await expect(new XWikiClient().downloadAttachment('Docs.Guides', 'Setup', 'big.pdf'))
      .rejects.toThrow('File is 2 KB, over the 1 KB limit (XWIKI_MCP_MAX_FILE_BYTES). Open it in the wiki instead: https://wiki.example.com/bin/download/Docs/Guides/Setup/big.pdf');
  });

  it('returns the download URL with the file', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true, status: 200, statusText: 'OK',
      arrayBuffer: () => Promise.resolve(new Uint8Array(10).buffer),
      headers: { get: (k: string) => (k === 'content-type' ? 'application/pdf' : null) },
    }));
    const file = await new XWikiClient().downloadAttachment('Main', 'WebHome', 'a.pdf');
    expect(file).toMatchObject({ size_bytes: 10, download_url: 'https://wiki.example.com/bin/download/Main/WebHome/a.pdf' });
  });
});
describe('0.16 fixes', () => {
  const query = (refs: string[]) => ({ body: { searchResults: refs.map(r => ({ pageFullName: r })) } });
  const versioned = (version: string, title = 'T') => ({ body: { title, content: '', syntax: 'xwiki/2.1', version, xwikiAbsoluteUrl: 'u' } });

  function moveFetch(versionAfter: string, lateRefs: string[] = []) {
    let moved = false;
    return statefulFetch({
      'GET /spaces/Docs/spaces/Guides/pages/Setup': () => (moved ? { status: 404 } : versioned('1.1', 'Setup')),
      'GET /spaces/Docs/spaces/Guides/pages/Install': () => (moved ? versioned('2.1', 'Setup') : { status: 404 }),
      'GET /spaces/Docs/pages/Index': () => versioned(moved ? versionAfter : '4.1'),
      'GET /query': () => query(moved ? ['Docs.Index', ...lateRefs] : ['Docs.Index', 'Docs.Guides.Setup']),
      'GET ': { body: {} },
      'POST /bin/view/Docs/Guides/Setup': () => {
        moved = true;
        return { status: 302, headers: { location: '/bin/view/Docs/Guides/Setup?xpage=rename&renameId=1' } };
      },
    });
  }

  it('move_page reports links as updated when each linking page got a new version', async () => {
    const fetch = moveFetch('5.1');
    vi.stubGlobal('fetch', fetch);
    const result = await new XWikiClient().movePage('Docs.Guides', 'Setup', 'Docs.Guides', 'Install');
    expect(result).toMatchObject({ links_updated: true, backlinks_found: 1 });
    expect(result.links_not_updated).toBeUndefined();
    const q = new URL(fetch.mock.calls.find(c => String(c[0]).includes('/query'))![0]).searchParams;
    expect(q.get('type')).toBe('solr');
    expect(q.get('q')).toBe('links_extended:"entity:document:xwiki:Docs.Guides.Setup"');
  });

  it('move_page names linking pages the wiki did not rewrite, and ones indexed late', async () => {
    vi.stubGlobal('fetch', moveFetch('4.1', ['Docs.Late']));
    const result = await new XWikiClient().movePage('Docs.Guides', 'Setup', 'Docs.Guides', 'Install');
    expect(result).toMatchObject({ links_updated: false, backlinks_found: 1, links_not_updated: ['Docs.Index', 'Docs.Late'] });
  });

  it('move_page with update_links false checks nothing', async () => {
    const fetch = moveFetch('4.1');
    vi.stubGlobal('fetch', fetch);
    const result = await new XWikiClient().movePage('Docs.Guides', 'Setup', 'Docs.Guides', 'Install', { updateLinks: false });
    expect(result.links_updated).toBe(false);
    expect(result.backlinks_found).toBeUndefined();
    expect(fetch.mock.calls.some(c => String(c[0]).includes('/query'))).toBe(false);
  });

  it('copy_page sends the source title when no new title is given', async () => {
    let copied = false;
    const fetch = statefulFetch({
      'GET ': { body: {} },
      'GET /spaces/Docs/spaces/Guides/pages/WebHome': versioned('1.1', 'Guides'),
      'GET /spaces/Docs/spaces/Manuals/pages/WebHome': () => (copied ? versioned('1.1', 'Guides') : { status: 404 }),
      'POST /bin/view/Docs/Guides/WebHome': () => { copied = true; return { status: 302, headers: { location: '/bin/view/Docs/Guides/?xpage=copy&copyId=1' } }; },
    });
    vi.stubGlobal('fetch', fetch);
    await new XWikiClient().copyPage('Docs.Guides', 'WebHome', 'Docs.Manuals', 'WebHome');
    expect(formOf(fetch).targetPageTitle).toBe('Guides');
  });

  it('export_page html returns the page HTML and leaves out the skin files', async () => {
    const { deflateRawSync } = await import('node:zlib');
    const zip = makeZip([
      { name: 'pages/xwiki/Main/WebHome.html', data: Buffer.from('<p>Hello</p>'), deflate: true },
      { name: 'skins/flamingo/style.css', data: Buffer.from('body{}') },
      { name: 'webjars/lib.js', data: Buffer.from('x') },
    ], deflateRawSync);
    vi.stubGlobal('fetch', statefulFetch({
      'GET ': { body: {} },
      'POST /bin/export/Main/WebHome': { body: zip, headers: { 'content-type': 'application/zip' } },
    }));
    const result = await new XWikiClient().exportPage('Main', 'WebHome', 'html');
    expect(result.pages).toEqual([{ path: 'pages/xwiki/Main/WebHome.html', html: '<p>Hello</p>' }]);
    expect(result.files_omitted).toBe(2);
    expect(result.content_base64).toBeUndefined();
  });

  it('lists attachment versions newest first', async () => {
    vi.stubGlobal('fetch', statefulFetch({
      'GET /spaces/Main/pages/WebHome/attachments/a.png/history': { body: { attachments: [{ version: '1.2' }, { version: '1.10' }, { version: '1.1' }] } },
    }));
    const versions = await new XWikiClient().getAttachmentHistory('Main', 'WebHome', 'a.png');
    expect(versions.map(v => v.version)).toEqual(['1.10', '1.2', '1.1']);
  });

  it('reports the history of a missing page as not found', async () => {
    vi.stubGlobal('fetch', statefulFetch({ 'GET /spaces/Main/pages/Nope/history': { body: { historySummaries: [] } } }));
    await expect(new XWikiClient().getPageHistory('Main', 'Nope')).rejects.toMatchObject({ status: 404 });
  });

  it('leaves the empty "no right" entry out of required rights', async () => {
    vi.stubGlobal('fetch', statefulFetch({
      'GET /spaces/Main/pages/WebHome/requiredRights': { body: { availableRights: [{ right: '', scope: 'DOCUMENT', definitelyRequiredRight: true, hasRight: true }] } },
    }));
    const report = await new XWikiClient().getRequiredRights('Main', 'WebHome');
    expect(report.needed).toEqual([]);
  });

  it('omits an empty headline', async () => {
    vi.stubGlobal('fetch', statefulFetch({
      'GET /classes/Sandbox.Code.ExampleClass/objects': { body: { objectSummaries: [{ number: 0, space: 'Main', pageName: 'WebHome', headline: null }] } },
    }));
    const { objects } = await new XWikiClient().listClassObjects('Sandbox.Code.ExampleClass', 0, 1, 'page', false);
    expect('headline' in objects[0] && objects[0].headline !== undefined).toBe(false);
  });

  it('returns ISO dates for comments, attachments and pages', async () => {
    vi.stubGlobal('fetch', statefulFetch({
      'GET /spaces/Main/pages/WebHome/comments': { body: { comments: [{ id: 0, date: '1700000000000', text: 'x' }] } },
      'GET /spaces/Main/pages/WebHome/attachments': { body: { attachments: [{ name: 'a', date: '1700000000000' }] } },
      'GET /spaces/Main/pages/WebHome': { body: { title: 'T', modified: 1700000000000 } },
    }));
    const client = new XWikiClient();
    const iso = new Date(1700000000000).toISOString();
    expect((await client.getComments('Main', 'WebHome'))[0].date).toBe(iso);
    expect((await client.getAttachments('Main', 'WebHome'))[0].date).toBe(iso);
    expect((await client.getPage('Main', 'WebHome')).modified_date).toBe(iso);
  });

  it('passes XWiki\'s reason for a rejected query through', async () => {
    vi.stubGlobal('fetch', statefulFetch({
      'GET /query': { status: 400, body: 'Query type [xwql] is not allowed. Allowed query types are: [solr].' },
    }));
    await expect(new XWikiClient().advancedSearch("where doc.space = 'Main'", 'xwql'))
      .rejects.toThrow('Query type [xwql] is not allowed');
  });
});

/** Build a zip (stored or deflated entries) for export tests. */
function makeZip(entries: Array<{ name: string; data: Buffer; deflate?: boolean }>, deflate: (b: Buffer) => Buffer): Uint8Array {
  const local: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const e of entries) {
    const body = e.deflate ? deflate(e.data) : e.data;
    const name = Buffer.from(e.name);
    const head = Buffer.alloc(30);
    head.writeUInt32LE(0x04034b50, 0);
    head.writeUInt16LE(e.deflate ? 8 : 0, 8);
    head.writeUInt32LE(body.length, 18);
    head.writeUInt32LE(e.data.length, 22);
    head.writeUInt16LE(name.length, 26);
    local.push(head, name, body);
    const dir = Buffer.alloc(46);
    dir.writeUInt32LE(0x02014b50, 0);
    dir.writeUInt16LE(e.deflate ? 8 : 0, 10);
    dir.writeUInt32LE(body.length, 20);
    dir.writeUInt32LE(e.data.length, 24);
    dir.writeUInt16LE(name.length, 28);
    dir.writeUInt32LE(offset, 42);
    central.push(dir, name);
    offset += 30 + name.length + body.length;
  }
  const dirBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(dirBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...local, dirBuf, end]));
}
