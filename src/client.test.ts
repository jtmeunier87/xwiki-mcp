import { describe, it, expect, vi, beforeEach } from 'vitest';
import { XWikiClient, XWikiError } from './client.js';

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

describe('listSpaces', () => {
  it('maps spaces to compact format', async () => {
    vi.stubGlobal('fetch', mockFetch({
      spaces: [
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

// ---------------------------------------------------------------------------
// search — scope prefix
// ---------------------------------------------------------------------------

describe('search scope prefix', () => {
  const emptyResponse = { searchResults: [], totalResults: 0 };

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

  it('adds space param when space is specified', async () => {
    const fetch = mockFetch(emptyResponse);
    vi.stubGlobal('fetch', fetch);

    await new XWikiClient().search('foo', 'content', 'MySpace', 0, 10);

    const url: string = fetch.mock.calls[0][0];
    expect(new URL(url).searchParams.get('space')).toBe('MySpace');
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

  it('defaults to xwql type when not specified', async () => {
    const fetch = vi.fn().mockResolvedValue({
      ok: true, status: 200, statusText: 'OK',
      json: () => Promise.resolve({ searchResults: [] }),
      headers: { get: () => null },
    });
    vi.stubGlobal('fetch', fetch);

    await new XWikiClient().advancedSearch("where doc.space = 'Sandbox'");
    const [url] = fetch.mock.calls[0];
    expect(url).toContain('type=xwql');
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
      text: () => Promise.resolve('This is the rendered plain text content of the page.'),
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
    expect(url).toContain('outputSyntax=plain');
    expect(url).toContain('xpage=plain');
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
    const decoded = Buffer.from(result.content_base64, 'base64').toString();
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

    const result = await new XWikiClient().rollbackPage('Tool Record.Some Tool.Process Step', 'My Step', '2.1');

    const [url, opts] = fetch.mock.calls[1];
    const u = new URL(url);
    expect(u.pathname).toBe('/bin/rollback/Tool%20Record/Some%20Tool/Process%20Step/My%20Step');
    expect(u.searchParams.get('rev')).toBe('2.1');
    expect(u.searchParams.get('confirm')).toBe('1');
    expect(u.searchParams.get('form_token')).toBe('test-csrf-token');
    expect(opts.method).toBe('POST');
    expect(result).toEqual({ space: 'Tool Record.Some Tool.Process Step', page: 'My Step', rolled_back_to: '2.1', new_version: '4.1', status: 'rolled_back' });
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
        : { objectSummaries: objects[path] ?? [] };
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body), headers: { get: () => null } });
    });
  }

  it('returns descendants depth-first with levels, child counts and classes', async () => {
    const fetch = treeFetch();
    vi.stubGlobal('fetch', fetch);

    const tree = await new XWikiClient().getPageTree('Docs.Guides', 'WebHome');

    expect(tree.root).toBe('Docs.Guides.WebHome');
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
    expect(tree.class_totals).toEqual({ 'XWiki.TagClass': 1, 'Sandbox.Code.ExampleClass': 2 });

    const url: string = fetch.mock.calls[0][0];
    expect(url).toContain('hierarchy=parentchild');
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

    expect(result).toMatchObject({ from: 'Docs.Guides.WebHome', to: 'Docs.Manuals.WebHome', url: 'https://wiki.example.com/bin/view/Docs/Manuals/', children_moved: true, links_updated: true, redirect_left: false, status: 'moved' });
    const post = fetch.mock.calls.find(c => c[1]?.method === 'POST')!;
    expect(post[0]).toBe('https://wiki.example.com/bin/view/Docs/Guides/WebHome');
    const form = new URLSearchParams(String(post[1].body));
    expect(Object.fromEntries(form)).toMatchObject({
      xpage: 'rename', step: '2', newSpaceName: 'Docs', newPageName: 'Manuals', terminal: 'false',
      deep: 'true', updateLinks: 'true', autoRedirect: 'false', form_token: 'test-csrf-token',
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
