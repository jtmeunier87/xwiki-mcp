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
    expect(opts.headers['Content-Type']).toBe('application/xml');
    expect(opts.body).toContain('<className>MyApp.MyClass</className>');
    expect(opts.body).toContain('<name>name</name>');
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
    expect(opts.body).toContain('<number>1</number>');
    expect(opts.body).toContain('inactive');
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
