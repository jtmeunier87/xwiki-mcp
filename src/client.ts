import { config } from './config.js';
import type {
  XWikiSpacesResponse,
  XWikiPagesResponse,
  XWikiPageRaw,
  XWikiSearchResponse,
  XWikiAttachmentsResponse,
  XWikiCommentsResponse,
  XWikiCommentRaw,
  Space,
  PageSummary,
  Page,
  PageWriteResult,
  SearchResult,
  Attachment,
  Comment,
  Pagination,
} from './types.js';

export class XWikiError extends Error {
  constructor(message: string, public readonly status?: number) {
    super(message);
    this.name = 'XWikiError';
  }
}

export class XWikiClient {
  private readonly wikiBase: string;
  private csrfToken: string | null = null;

  constructor() {
    this.wikiBase = `${config.baseUrl}${config.restPath}/wikis/${config.wikiName}`;
  }

  private authHeaders(): Record<string, string> {
    if (config.authType === 'basic') {
      const b64 = Buffer.from(`${config.username}:${config.password}`).toString('base64');
      return { Authorization: `Basic ${b64}` };
    }
    if (config.authType === 'token') {
      return { Authorization: `Bearer ${config.token}` };
    }
    return {};
  }

  /**
   * Fetch or return a cached CSRF token required for write operations.
   * The token is obtained from the XWiki-Form-Token response header on any GET request.
   * It is stable per user until server restart (xWiki 15.2+).
   */
  private async getCsrfToken(): Promise<string> {
    if (this.csrfToken) return this.csrfToken;

    // Make a lightweight GET to obtain the CSRF token from response headers
    const url = new URL(`${this.wikiBase}`);
    url.searchParams.set('media', 'json');

    const response = await fetch(url.toString(), {
      headers: { Accept: 'application/json', ...this.authHeaders() },
      signal: AbortSignal.timeout(15_000),
    });

    const token = response.headers.get('XWiki-Form-Token');
    if (token) {
      this.csrfToken = token;
    }
    return this.csrfToken ?? '';
  }

  private async get<T>(path: string, params: Record<string, string | number> = {}): Promise<T> {
    const url = new URL(`${this.wikiBase}${path}`);
    for (const [k, v] of Object.entries(params)) {
      url.searchParams.set(k, String(v));
    }
    url.searchParams.set('media', 'json');

    const urlStr = url.toString();
    let response: Response;

    try {
      response = await fetch(urlStr, {
        headers: { Accept: 'application/json', ...this.authHeaders() },
        signal: AbortSignal.timeout(30_000),
      });
    } catch {
      throw new XWikiError(`Cannot connect to XWiki at ${config.baseUrl}. Check XWIKI_BASE_URL.`);
    }

    if (response.status === 404) {
      throw new XWikiError(`Not found: ${path}`, 404);
    }
    if (response.status === 401 || response.status === 403) {
      throw new XWikiError('Authentication failed. Check XWIKI_AUTH_TYPE and credentials.', response.status);
    }
    if (!response.ok) {
      throw new XWikiError(`XWiki server error: ${response.status}. URL: ${urlStr}`, response.status);
    }

    // Cache CSRF token from any GET response
    const token = response.headers.get('XWiki-Form-Token');
    if (token) this.csrfToken = token;

    return response.json() as Promise<T>;
  }

  /**
   * Send a mutating request (PUT, POST, DELETE) to the xWiki REST API.
   * Includes CSRF token handling and automatic retry on 403 (stale token).
   */
  private async mutate(method: 'PUT' | 'POST' | 'DELETE', path: string, body?: string, contentType?: string): Promise<Response> {
    const url = new URL(`${this.wikiBase}${path}`);
    url.searchParams.set('media', 'json');

    const csrfToken = await this.getCsrfToken();

    const headers: Record<string, string> = {
      Accept: 'application/json',
      ...this.authHeaders(),
    };
    if (csrfToken) headers['XWiki-Form-Token'] = csrfToken;
    if (contentType) headers['Content-Type'] = contentType;

    let response: Response;
    try {
      response = await fetch(url.toString(), {
        method,
        headers,
        body: body ?? undefined,
        signal: AbortSignal.timeout(30_000),
      });
    } catch {
      throw new XWikiError(`Cannot connect to XWiki at ${config.baseUrl}. Check XWIKI_BASE_URL.`);
    }

    // If 403, the CSRF token may be stale — refresh and retry once
    if (response.status === 403 && csrfToken) {
      this.csrfToken = null;
      const newToken = await this.getCsrfToken();
      if (newToken && newToken !== csrfToken) {
        headers['XWiki-Form-Token'] = newToken;
        try {
          response = await fetch(url.toString(), {
            method,
            headers,
            body: body ?? undefined,
            signal: AbortSignal.timeout(30_000),
          });
        } catch {
          throw new XWikiError(`Cannot connect to XWiki at ${config.baseUrl}. Check XWIKI_BASE_URL.`);
        }
      }
    }

    if (response.status === 401 || response.status === 403) {
      throw new XWikiError('Authentication or permission error. Check credentials and page access rights.', response.status);
    }
    if (response.status === 404) {
      throw new XWikiError(`Not found: ${path}`, 404);
    }
    if (!response.ok) {
      throw new XWikiError(`XWiki server error: ${response.status} ${response.statusText}`, response.status);
    }

    return response;
  }

  /** Convert "Space1.SubSpace.Child" → "/spaces/Space1/spaces/SubSpace/spaces/Child" */
  private spacePath(space: string): string {
    return '/' + space.split('.').map(s => `spaces/${encodeURIComponent(s)}`).join('/');
  }

  // ---------------------------------------------------------------------------
  // Public API methods
  // ---------------------------------------------------------------------------

  async listSpaces(): Promise<Space[]> {
    const data = await this.get<XWikiSpacesResponse>('/spaces');
    return (data.spaces ?? []).map(s => ({
      id: s.id,
      name: s.name,
      home_url: s.xwikiAbsoluteUrl ?? '',
    }));
  }

  async listPages(
    space: string,
    start: number,
    limit: number,
  ): Promise<{ pages: PageSummary[]; pagination: Pagination }> {
    const path = `${this.spacePath(space)}/pages`;
    const data = await this.get<XWikiPagesResponse>(path, { start, number: limit });
    const pages = (data.pageSummaries ?? []).map(p => ({
      id: p.id,
      title: p.title,
      parent: p.parent,
      url: p.xwikiAbsoluteUrl ?? '',
    }));
    const total = data.totalResults;
    return {
      pages,
      pagination: {
        total,
        start,
        limit,
        has_more: total != null ? start + pages.length < total : pages.length === limit,
      },
    };
  }

  async getPage(space: string, page: string): Promise<Page> {
    const path = `${this.spacePath(space)}/pages/${encodeURIComponent(page)}`;
    const data = await this.get<XWikiPageRaw>(path);
    return {
      title: data.title,
      content: data.content,
      syntax: data.syntax,
      author: data.contentAuthor ?? data.author,
      modified_date: data.modified,
      version: data.version,
      parent: data.parent,
      url: data.xwikiAbsoluteUrl ?? '',
    };
  }

  async search(
    query: string,
    scope: 'content' | 'title' | 'name',
    space: string | undefined,
    start: number,
    limit: number,
  ): Promise<{ results: SearchResult[]; pagination: Pagination }> {
    // XWiki Solr search supports field prefix syntax
    const q = scope === 'title' ? `title:${query}` : scope === 'name' ? `name:${query}` : query;
    const params: Record<string, string | number> = { q, start, number: limit };
    if (space) params.space = space;

    const data = await this.get<XWikiSearchResponse>('/search', params);
    const results = (data.searchResults ?? []).map(r => {
      const docItem = r.hierarchy?.items?.findLast(i => i.type === 'document');
      return {
        id: r.id,
        title: r.title ?? r.id,
        space: r.space,
        url: docItem?.url ?? '',
        score: r.score,
        modified_date: r.modified != null ? String(r.modified) : undefined,
      };
    });
    const total = data.totalResults;
    return {
      results,
      pagination: {
        total,
        start,
        limit,
        has_more: total != null ? start + results.length < total : results.length === limit,
      },
    };
  }

  async getAttachments(space: string, page: string): Promise<Attachment[]> {
    const path = `${this.spacePath(space)}/pages/${encodeURIComponent(page)}/attachments`;
    const data = await this.get<XWikiAttachmentsResponse>(path);
    return (data.attachments ?? []).map(a => ({
      name: a.name,
      size_bytes: a.longSize ?? a.size,
      mime_type: a.mimeType,
      author: a.author,
      date: a.date != null ? String(a.date) : undefined,
      download_url: a.xwikiAbsoluteUrl ?? '',
    }));
  }

  async getPageChildren(space: string, page: string): Promise<PageSummary[]> {
    const path = `${this.spacePath(space)}/pages/${encodeURIComponent(page)}/children`;
    const data = await this.get<XWikiPagesResponse>(path);
    return (data.pageSummaries ?? []).map(p => ({
      id: p.id,
      title: p.title,
      parent: p.parent,
      url: p.xwikiAbsoluteUrl ?? '',
    }));
  }

  // ---------------------------------------------------------------------------
  // Write operations (Phase 1)
  // ---------------------------------------------------------------------------

  /**
   * Create a new page. Uses PUT because the client specifies the page URI.
   * If the page already exists, this will overwrite it — use update_page
   * for intentional updates (same HTTP method, different tool semantics).
   */
  async createPage(
    space: string,
    page: string,
    title: string,
    content: string,
    syntax?: string,
    parent?: string,
  ): Promise<PageWriteResult> {
    const path = `${this.spacePath(space)}/pages/${encodeURIComponent(page)}`;

    // Build XML body — xWiki REST API primary format for PUT page
    const xmlParts: string[] = ['<?xml version="1.0" encoding="UTF-8"?>'];
    xmlParts.push('<page xmlns="http://www.xwiki.org">');
    xmlParts.push(`<title>${this.escapeXml(title)}</title>`);
    xmlParts.push(`<content>${this.escapeXml(content)}</content>`);
    if (syntax) xmlParts.push(`<syntax>${this.escapeXml(syntax)}</syntax>`);
    if (parent) xmlParts.push(`<parent>${this.escapeXml(parent)}</parent>`);
    xmlParts.push('</page>');

    const response = await this.mutate('PUT', path, xmlParts.join('\n'), 'application/xml');

    // Try to parse JSON response for version/URL info
    try {
      const data = await response.json() as XWikiPageRaw;
      return {
        title: data.title ?? title,
        version: data.version,
        url: data.xwikiAbsoluteUrl ?? '',
        status: 'created',
      };
    } catch {
      return { title, url: '', status: 'created' };
    }
  }

  /**
   * Update an existing page's content, title, or both.
   * Fetches the current page first to preserve fields not being updated.
   */
  async updatePage(
    space: string,
    page: string,
    content?: string,
    title?: string,
    syntax?: string,
  ): Promise<PageWriteResult> {
    // Fetch current page to preserve unchanged fields
    const current = await this.getPage(space, page);

    const path = `${this.spacePath(space)}/pages/${encodeURIComponent(page)}`;

    const xmlParts: string[] = ['<?xml version="1.0" encoding="UTF-8"?>'];
    xmlParts.push('<page xmlns="http://www.xwiki.org">');
    xmlParts.push(`<title>${this.escapeXml(title ?? current.title)}</title>`);
    xmlParts.push(`<content>${this.escapeXml(content ?? current.content)}</content>`);
    xmlParts.push(`<syntax>${this.escapeXml(syntax ?? current.syntax)}</syntax>`);
    xmlParts.push('</page>');

    const response = await this.mutate('PUT', path, xmlParts.join('\n'), 'application/xml');

    try {
      const data = await response.json() as XWikiPageRaw;
      return {
        title: data.title ?? title ?? current.title,
        version: data.version,
        url: data.xwikiAbsoluteUrl ?? '',
        status: 'updated',
      };
    } catch {
      return { title: title ?? current.title, url: '', status: 'updated' };
    }
  }

  /**
   * Delete a page.
   */
  async deletePage(space: string, page: string): Promise<{ status: string }> {
    const path = `${this.spacePath(space)}/pages/${encodeURIComponent(page)}`;
    await this.mutate('DELETE', path);
    return { status: 'deleted' };
  }

  /**
   * Add a comment to a page.
   */
  async addComment(
    space: string,
    page: string,
    text: string,
    replyTo?: number,
  ): Promise<Comment> {
    const path = `${this.spacePath(space)}/pages/${encodeURIComponent(page)}/comments`;

    const xmlParts: string[] = ['<?xml version="1.0" encoding="UTF-8"?>'];
    xmlParts.push('<comment xmlns="http://www.xwiki.org">');
    xmlParts.push(`<text>${this.escapeXml(text)}</text>`);
    if (replyTo != null) xmlParts.push(`<replyTo>${replyTo}</replyTo>`);
    xmlParts.push('</comment>');

    const response = await this.mutate('POST', path, xmlParts.join('\n'), 'application/xml');

    try {
      const data = await response.json() as XWikiCommentRaw;
      return {
        id: data.id,
        author: data.author,
        date: data.date != null ? String(data.date) : undefined,
        text: data.text ?? text,
        reply_to: data.replyTo,
      };
    } catch {
      return { text };
    }
  }

  /**
   * Get all comments on a page.
   */
  async getComments(space: string, page: string): Promise<Comment[]> {
    const path = `${this.spacePath(space)}/pages/${encodeURIComponent(page)}/comments`;
    const data = await this.get<XWikiCommentsResponse>(path);
    return (data.comments ?? []).map(c => ({
      id: c.id,
      author: c.author,
      date: c.date != null ? String(c.date) : undefined,
      text: c.text ?? '',
      reply_to: c.replyTo,
    }));
  }

  // ---------------------------------------------------------------------------
  // Utility
  // ---------------------------------------------------------------------------

  /** Escape special XML characters in content */
  private escapeXml(s: string): string {
    return s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }
}
