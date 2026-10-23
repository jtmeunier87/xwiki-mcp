import { inflateRawSync } from 'node:zlib';
import { config } from './config.js';
import type { XWikiSpacesResponse, XWikiPagesResponse, XWikiPageRaw, XWikiSearchResponse, XWikiAttachmentsResponse, XWikiAttachmentRaw, XWikiCommentsResponse, XWikiCommentRaw, XWikiTagsResponse, XWikiClassesResponse, XWikiClassRaw, XWikiObjectsResponse, XWikiObjectRaw, XWikiHistoryResponse, XWikiPageVersionRaw, XWikiQueryResponse, Space, PageSummary, Page, PageWriteResult, AttachmentWriteResult, SearchResult, Attachment, Comment, Pagination, Tag, XWikiClass, XWikiObject, XWikiObjectWriteResult, HistorySummary, QueryResult, RenderResult, RecentChange, XWikiWikiTagsResponse, XWikiTaggedPagesResponse, XWikiWikiPagesResponse, XWikiObjectPropertyResponse, WikiTag, ObjectProperty, ExportResult, RollbackResult, ClassUpdateResult, ClassAddResult, XWikiPageSummaryRaw, PageTree, PageTreeNode, XWikiClassObjectSummaryRaw, ClassObject, AttachmentSearchResult, TagRemoveResult, MovePageResult, XWikiRequiredRightsResponse, RequiredRightsReport, CopyPageResult, DeletedPage, XWikiDeletedDocumentsResponse, XWikiDeletedDocumentsTemplateResponse, RestorePageResult, ClassPropertyStateResult, AttachmentMoveResult, AttachmentVersion, ClassPropertyValue, VersionComparison } from './types.js';
import { unifiedDiff } from './diff.js';
import { htmlToText } from './html-text.js';

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
      signal: AbortSignal.timeout(config.timeoutMs),
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
        signal: AbortSignal.timeout(config.timeoutMs),
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
    if (response.status === 400) {
      // XWiki explains a rejected request in a short text body (e.g. a query type not allowed).
      const reason = (await Promise.resolve().then(() => response.text()).catch(() => '')).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
      const detail = reason && reason.length <= 500 ? `: ${reason}` : '';
      throw new XWikiError(`XWiki rejected the request (400)${detail}. URL: ${urlStr}`, 400);
    }
    if (!response.ok) {
      throw new XWikiError(`XWiki server error: ${response.status}${await this.errorDetail(response)}. URL: ${urlStr}`, response.status);
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
  private async mutate(method: 'PUT' | 'POST' | 'DELETE', path: string, body?: string | Buffer, contentType?: string): Promise<Response> {
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
        body: body as BodyInit ?? undefined,
        signal: AbortSignal.timeout(config.timeoutMs * 4),
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
            body: body as BodyInit ?? undefined,
            signal: AbortSignal.timeout(config.timeoutMs * 4),
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
      ...(data.rawTitle != null && data.rawTitle !== data.title ? { raw_title: data.rawTitle } : {}),
      content: data.content,
      syntax: data.syntax,
      author: data.contentAuthor ?? data.author,
      modified_date: data.modified != null ? this.parseTimestamp(data.modified) : undefined,
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
    // The wiki-wide /search ignores a space parameter; the space's own search resource limits it.
    const path = space ? `${this.spacePath(space)}/search` : '/search';
    const data = await this.get<XWikiSearchResponse>(path, params);
    const results = (data.searchResults ?? []).map(r => {
      const docItem = r.hierarchy?.items?.findLast(i => i.type === 'document');
      return {
        id: r.id,
        title: r.title ?? r.id,
        space: r.space,
        url: docItem?.url ?? '',
        score: r.score,
        modified_date: r.modified != null ? this.parseTimestamp(r.modified) : undefined,
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
      date: a.date != null ? this.parseTimestamp(a.date) : undefined,
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
    // Keep the STORED title: `title` is rendered, so writing it back would replace a sheet's
    // Velocity title with its output and give every record of the class the sheet's name.
    xmlParts.push(`<title>${this.escapeXml(title ?? current.raw_title ?? current.title)}</title>`);
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
        date: data.date != null ? this.parseTimestamp(data.date) : undefined,
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
      date: c.date != null ? this.parseTimestamp(c.date) : undefined,
      text: c.text ?? '',
      reply_to: c.replyTo,
    }));
  }

  // ---------------------------------------------------------------------------
  // Phase 2: Attachments (upload / download / delete)
  // ---------------------------------------------------------------------------

  /**
   * Upload a file as an attachment to a page.
   * content_base64: base64-encoded file bytes.
   */
  async uploadAttachment(
    space: string,
    page: string,
    filename: string,
    contentBase64: string,
    mimeType: string,
  ): Promise<AttachmentWriteResult> {
    const path = `${this.spacePath(space)}/pages/${encodeURIComponent(page)}/attachments/${encodeURIComponent(filename)}`;
    const bytes = Buffer.from(contentBase64, 'base64');
    const response = await this.mutate('PUT', path, bytes, mimeType);

    try {
      const data = await response.json() as XWikiAttachmentRaw;
      return {
        name: data.name ?? filename,
        size_bytes: data.longSize ?? data.size,
        mime_type: data.mimeType ?? mimeType,
        // The URL's ?rev= can name the version before this upload; the bare URL serves the latest.
        url: (data.xwikiAbsoluteUrl ?? '').replace(/\?rev=[^&]*$/, ''),
        status: 'uploaded',
      };
    } catch {
      return { name: filename, mime_type: mimeType, url: '', status: 'uploaded' };
    }
  }

  /**
   * Download an attachment from a page, returning its content as base64.
   */
  async downloadAttachment(
    space: string,
    page: string,
    filename: string,
  ): Promise<{ name: string; content_base64: string; mime_type?: string; size_bytes: number; download_url: string }> {
    // Build the direct download URL (not through REST path — attachments served via /bin/download)
    const spaceParts = space.split('.').map(s => encodeURIComponent(s)).join('/');
    const downloadUrl = `${config.baseUrl}/bin/download/${spaceParts}/${encodeURIComponent(page)}/${encodeURIComponent(filename)}`;

    let response: Response;
    try {
      response = await fetch(downloadUrl, {
        headers: { ...this.authHeaders() },
        signal: AbortSignal.timeout(config.timeoutMs * 4),
      });
    } catch {
      throw new XWikiError(`Cannot connect to XWiki at ${config.baseUrl}.`);
    }

    if (response.status === 404) throw new XWikiError(`Attachment not found: ${filename}`, 404);
    if (response.status === 401 || response.status === 403) throw new XWikiError('Authentication error downloading attachment.', response.status);
    if (!response.ok) throw new XWikiError(`Failed to download attachment: ${response.status}`, response.status);

    this.checkFileSize(Number(response.headers.get('content-length') ?? 0), downloadUrl);
    const buffer = await response.arrayBuffer();
    this.checkFileSize(buffer.byteLength, downloadUrl);
    const content_base64 = Buffer.from(buffer).toString('base64');
    return {
      name: filename,
      content_base64,
      mime_type: response.headers.get('content-type') ?? undefined,
      size_bytes: buffer.byteLength,
      download_url: downloadUrl,
    };
  }

  /** XWiki's own message from an error response (plain text, first 300 characters), so the error says what to fix. */
  private async errorDetail(response: Response): Promise<string> {
    try {
      const text = (await response.text()).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
      return text ? ` (${text.slice(0, 300)})` : '';
    } catch {
      return '';
    }
  }

  /** Refuse files over XWIKI_MCP_MAX_FILE_BYTES, so a large file never reaches the model. */
  private checkFileSize(bytes: number, url: string): void {
    if (bytes > config.maxFileBytes) {
      const size = (n: number) => (n < 1024 * 1024 ? `${Math.ceil(n / 1024)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);
      throw new XWikiError(`File is ${size(bytes)}, over the ${size(config.maxFileBytes)} limit (XWIKI_MCP_MAX_FILE_BYTES). Open it in the wiki instead: ${url}`, 413);
    }
  }

  /**
   * Delete an attachment from a page.
   */
  async deleteAttachment(space: string, page: string, filename: string): Promise<{ status: string }> {
    const path = `${this.spacePath(space)}/pages/${encodeURIComponent(page)}/attachments/${encodeURIComponent(filename)}`;
    await this.mutate('DELETE', path);
    return { status: 'deleted' };
  }

  // ---------------------------------------------------------------------------
  // Phase 2: Tags
  // ---------------------------------------------------------------------------

  /**
   * Get all tags on a page.
   */
  async getTags(space: string, page: string): Promise<Tag[]> {
    const path = `${this.spacePath(space)}/pages/${encodeURIComponent(page)}/tags`;
    const data = await this.get<XWikiTagsResponse>(path);
    return (data.tags ?? []).map(t => ({ name: t.name }));
  }

  /**
   * Add tags to a page. Replaces the full tag set — fetches existing tags first
   * and merges with the new ones to avoid removing existing tags.
   */
  async addTags(space: string, page: string, tags: string[]): Promise<Tag[]> {
    // Fetch existing tags to preserve them
    const existing = await this.getTags(space, page);
    const existingNames = new Set(existing.map(t => t.name));
    const merged = [...existing.map(t => t.name), ...tags.filter(t => !existingNames.has(t))];

    const path = `${this.spacePath(space)}/pages/${encodeURIComponent(page)}/tags`;

    // xWiki expects <tag name="value"/> attribute syntax (not text content)
    const tagElements = merged.map(t => `  <tag name="${this.escapeXml(t)}"/>`).join('\n');
    const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<tags xmlns="http://www.xwiki.org">\n${tagElements}\n</tags>`;

    await this.mutate('PUT', path, xml, 'application/xml');
    return merged.map(name => ({ name }));
  }

  // ---------------------------------------------------------------------------
  // Phase 3: Classes
  // ---------------------------------------------------------------------------

  /**
   * List all XWiki classes defined in the wiki.
   */
  async listClasses(start: number, limit: number): Promise<{ classes: XWikiClass[]; pagination: Pagination }> {
    // XWiki's classes endpoint ignores start and number and returns every class (with every
    // property), so the page is cut here.
    const data = await this.get<XWikiClassesResponse>('/classes');
    // xWiki REST API uses the key 'clazzs' (intentional typo in the API)
    const all = data.clazzs ?? [];
    const raw = all.slice(start, start + limit);
    const classes = raw.map((c: XWikiClassRaw) => ({
      id: c.id,
      name: c.name,
      property_count: (c.properties ?? []).length,
      properties: (c.properties ?? []).map(p => ({ name: p.name, type: p.type })),
    }));
    return {
      classes,
      pagination: {
        total: all.length,
        start,
        limit,
        has_more: start + limit < all.length,
      },
    };
  }

  /**
   * Get details of a single XWiki class including all its properties.
   */
  async getClass(className: string): Promise<XWikiClass> {
    const path = `/classes/${encodeURIComponent(className)}`;
    const data = await this.get<XWikiClassRaw>(path);
    return {
      id: data.id,
      name: data.name,
      property_count: (data.properties ?? []).length,
      properties: (data.properties ?? []).map(p => {
        // Keep non-empty attributes (prettyName, values, multiSelect, …) as a flat map.
        const attributes: Record<string, string> = {};
        for (const a of p.attributes ?? []) {
          if (a.value !== undefined && a.value !== null && a.value !== '') attributes[a.name] = a.value;
        }
        return { name: p.name, type: p.type, attributes };
      }),
    };
  }

  /**
   * Change attributes of existing class properties (hint, prettyName, values, …).
   * No REST endpoint edits classes; this posts the class editor's action:
   * POST /bin/propupdate/{class space path}/{class page} with `{property}_{attribute}=value`.
   * xWiki rebuilds the class from the stored one and changes only the fields sent.
   * Renaming (`name`) is refused: it rewrites every object of the class.
   */
  async updateClassProperties(
    className: string,
    updates: Record<string, Record<string, string>>,
  ): Promise<ClassUpdateResult> {
    const before = await this.getClass(className);
    const form = new URLSearchParams();
    const changes: ClassUpdateResult['changes'] = [];
    for (const [property, attributes] of Object.entries(updates)) {
      if (!before.properties.some(p => p.name === property)) {
        throw new XWikiError(`Property not found in ${className}: ${property}`, 404);
      }
      for (const [attribute, value] of Object.entries(attributes)) {
        if (attribute === 'name') {
          throw new XWikiError('Renaming a property is not supported: it rewrites every object of the class.', 400);
        }
        form.set(`${property}_${attribute}`, value);
        changes.push({ property, attribute, value });
      }
    }
    if (changes.length === 0) throw new XWikiError('No attributes to update.', 400);

    await this.postClassAction('propupdate', className, form);

    const after = await this.getClass(className);
    const unchanged = changes.filter(c =>
      (after.properties.find(p => p.name === c.property)?.attributes?.[c.attribute] ?? '') !== c.value);
    if (unchanged.length > 0) {
      throw new XWikiError(
        `Class ${className} was not changed as asked: ${unchanged.map(c => `${c.property}.${c.attribute}`).join(', ')}. Check the attribute names with xwiki_get_class.`,
      );
    }
    return { class_name: className, changes, status: 'updated' };
  }

  /**
   * Add a property to a class, then set its attributes if given.
   * Uses the class editor's action: POST /bin/propadd/{class space path}/{class page}
   * with propname and proptype (the type name xwiki_get_class shows, e.g. String, TextArea, StaticList).
   */
  async addClassProperty(
    className: string,
    property: string,
    type: string,
    attributes: Record<string, string> = {},
  ): Promise<ClassAddResult> {
    const before = await this.getClass(className);
    if (before.properties.some(p => p.name === property)) {
      throw new XWikiError(`Property already exists in ${className}: ${property}`, 400);
    }
    await this.postClassAction('propadd', className, new URLSearchParams({ propname: property, proptype: type }));

    const added = (await this.getClass(className)).properties.find(p => p.name === property);
    if (!added) {
      throw new XWikiError(`Property ${property} was not added to ${className}. Check the name (letters, digits, no spaces) and the type.`);
    }
    if (Object.keys(attributes).length > 0) {
      await this.updateClassProperties(className, { [property]: attributes });
    }
    return { class_name: className, property, type: added.type ?? type, attributes, status: 'added' };
  }

  /** POST a class editor action URL with the CSRF token as form_token. */
  private async postClassAction(action: 'propupdate' | 'propadd' | 'propdisable' | 'propenable', className: string, form: URLSearchParams): Promise<void> {
    const parts = className.split('.');
    if (parts.length < 2) throw new XWikiError(`Not a full class name: ${className}`, 400);
    const actionPath = parts.map(encodeURIComponent).join('/');
    const url = `${config.baseUrl}/bin/${action}/${actionPath}`;
    form.set('form_token', await this.getCsrfToken());

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: { ...this.authHeaders(), 'Content-Type': 'application/x-www-form-urlencoded' },
        body: form.toString(),
        redirect: 'manual',
        signal: AbortSignal.timeout(config.timeoutMs),
      });
    } catch {
      throw new XWikiError(`Cannot connect to XWiki at ${config.baseUrl}. Check XWIKI_BASE_URL.`);
    }
    // Success is a redirect; the caller confirms the change by reading the class back.
    if (response.status === 401 || response.status === 403) {
      throw new XWikiError('Authentication or permission error. Editing a class needs edit rights on its page.', response.status);
    }
    if (response.status >= 400) {
      throw new XWikiError(`XWiki server error: ${response.status}. URL: ${url}`, response.status);
    }
  }

  // ---------------------------------------------------------------------------
  // Phase 3: Objects
  // ---------------------------------------------------------------------------

  /**
   * List all objects on a page, optionally filtered by class name.
   */
  async listObjects(
    space: string,
    page: string,
    className?: string,
  ): Promise<XWikiObject[]> {
    const basePath = `${this.spacePath(space)}/pages/${encodeURIComponent(page)}/objects`;
    const path = className ? `${basePath}/${encodeURIComponent(className)}` : basePath;
    const data = await this.get<XWikiObjectsResponse>(path);
    const items = data.objectSummaries ?? data.objects ?? [];
    return items.map((o: XWikiObjectRaw) => ({
      class_name: o.className,
      number: o.number,
      page_id: o.pageId,
      url: o.xwikiAbsoluteUrl,
      properties: this.flattenObjectProperties(o.properties),
    }));
  }

  /**
   * Fill in the properties of listed objects. The list endpoint returns summaries without
   * property values, so each object is read in full, a few at a time.
   */
  async withObjectProperties(space: string, page: string, objects: XWikiObject[]): Promise<XWikiObject[]> {
    return this.mapLimit(objects, 6, o => this.getObject(space, page, o.class_name, o.number));
  }

  /**
   * Get a single object by class name and object number.
   */
  async getObject(space: string, page: string, className: string, objectNumber: number): Promise<XWikiObject> {
    const path = `${this.spacePath(space)}/pages/${encodeURIComponent(page)}/objects/${encodeURIComponent(className)}/${objectNumber}`;
    const data = await this.get<XWikiObjectRaw>(path);
    return {
      class_name: data.className,
      number: data.number,
      page_id: data.pageId,
      url: data.xwikiAbsoluteUrl,
      properties: this.flattenObjectProperties(data.properties),
    };
  }

  /**
   * Create a new object of a given class on a page.
   * properties: key-value map of property names to values.
   */
  async createObject(
    space: string,
    page: string,
    className: string,
    properties: Record<string, string>,
  ): Promise<XWikiObjectWriteResult> {
    const path = `${this.spacePath(space)}/pages/${encodeURIComponent(page)}/objects`;

    const form = this.propertiesForm(properties);
    form.set('className', className);

    const response = await this.mutate('POST', path, form.toString(), 'application/x-www-form-urlencoded');

    try {
      const data = await response.json() as XWikiObjectRaw;
      return {
        class_name: data.className ?? className,
        number: data.number ?? 0,
        url: data.xwikiAbsoluteUrl,
        status: 'created',
      };
    } catch {
      return { class_name: className, number: 0, status: 'created' };
    }
  }

  /**
   * Update an existing object's properties by class name and object number.
   * Only the provided properties are sent — existing unspecified properties are preserved by xWiki.
   */
  async updateObject(
    space: string,
    page: string,
    className: string,
    objectNumber: number,
    properties: Record<string, string>,
  ): Promise<XWikiObjectWriteResult> {
    const path = `${this.spacePath(space)}/pages/${encodeURIComponent(page)}/objects/${encodeURIComponent(className)}/${objectNumber}`;

    const form = this.propertiesForm(properties);

    const response = await this.mutate('PUT', path, form.toString(), 'application/x-www-form-urlencoded');

    try {
      const data = await response.json() as XWikiObjectRaw;
      return {
        class_name: data.className ?? className,
        number: data.number ?? objectNumber,
        url: data.xwikiAbsoluteUrl,
        status: 'updated',
      };
    } catch {
      return { class_name: className, number: objectNumber, status: 'updated' };
    }
  }

  /**
   * Delete an object from a page by class name and object number.
   */
  async deleteObject(space: string, page: string, className: string, objectNumber: number): Promise<{ status: string }> {
    const path = `${this.spacePath(space)}/pages/${encodeURIComponent(page)}/objects/${encodeURIComponent(className)}/${objectNumber}`;
    await this.mutate('DELETE', path);
    return { status: 'deleted' };
  }

  /**
   * Walk the page tree under a root page and report each descendant with its
   * level, direct child count and (optionally) the object classes it carries.
   * Endpoints: GET .../pages/{pg}/children?hierarchy=... (paged) and
   * GET .../pages/{pg}/objects, one each per page, run a few at a time.
   * hierarchy 'parentchild' follows the page's parent field (XWiki's REST default);
   * 'nestedpages' follows the page/space nesting.
   */
  async getPageTree(
    space: string,
    page: string,
    options: { hierarchy?: 'parentchild' | 'nestedpages'; maxDepth?: number; maxPages?: number; includeObjects?: boolean } = {},
  ): Promise<PageTree> {
    const hierarchy = options.hierarchy ?? 'parentchild';
    const maxDepth = options.maxDepth ?? 50;
    const maxPages = options.maxPages ?? 500;
    const includeObjects = options.includeObjects ?? true;
    const root = `${space}.${page}`;
    // The root page itself: its row is returned as root_page (and a missing root fails with 404 here).
    const rootDoc = await this.getPage(space, page);

    interface Entry { node: PageTreeNode; space: string; page: string; children: string[] }
    const entries = new Map<string, Entry>();
    const visited = new Set<string>([root]);
    const rootChildren: string[] = [];
    let truncated = false;

    // Level by level: fetch children of every page on the current level.
    let frontier: Array<{ ref: string; space: string; page: string; level: number; children: string[] }> =
      [{ ref: root, space, page, level: 0, children: rootChildren }];
    while (frontier.length > 0) {
      const results = await this.mapLimit(frontier, 6, f => this.getAllChildren(f.space, f.page, hierarchy));
      const next: typeof frontier = [];
      frontier.forEach((f, i) => {
        const kids = results[i];
        if (f.level > 0) entries.get(f.ref)!.node.child_count = kids.length;
        if (f.level >= maxDepth) return;
        for (const k of kids) {
          const ref = k.fullName ?? k.id;
          if (visited.has(ref)) continue;
          if (entries.size >= maxPages) { truncated = true; break; }
          visited.add(ref);
          const loc = this.splitReference(ref, k);
          const children: string[] = [];
          entries.set(ref, {
            node: {
              reference: ref,
              title: this.treeTitle(k, loc),
              level: f.level + 1,
              parent: f.ref,
              child_count: 0,
              url: k.xwikiAbsoluteUrl ?? '',
            },
            ...loc,
            children,
          });
          f.children.push(ref);
          next.push({ ref, ...loc, level: f.level + 1, children });
        }
      });
      frontier = next;
    }

    const rootNode: PageTreeNode = {
      reference: root,
      title: rootDoc.title?.trim() || (page === 'WebHome' ? space.slice(space.lastIndexOf('.') + 1) : page),
      level: 0,
      parent: rootDoc.parent ?? '',
      child_count: rootChildren.length,
      url: rootDoc.url,
    };

    let classTotals: Record<string, number> | undefined;
    if (includeObjects) {
      classTotals = {};
      const list = [{ node: rootNode, space, page }, ...entries.values()];
      const objects = await this.mapLimit(list, 6, e => this.listObjects(e.space, e.page));
      list.forEach((e, i) => {
        const classes: Record<string, number> = {};
        for (const o of objects[i]) classes[o.class_name] = (classes[o.class_name] ?? 0) + 1;
        e.node.classes = classes;
        for (const c of Object.keys(classes)) classTotals![c] = (classTotals![c] ?? 0) + 1;
      });
    }

    // Depth-first order, as a tree reads.
    const pages: PageTreeNode[] = [];
    const walk = (refs: string[]) => {
      for (const ref of refs) {
        const e = entries.get(ref)!;
        pages.push(e.node);
        walk(e.children);
      }
    };
    walk(rootChildren);

    return {
      root,
      root_page: rootNode,
      hierarchy,
      max_depth: maxDepth,
      total_pages: pages.length,
      truncated,
      ...(classTotals ? { class_totals: classTotals } : {}),
      pages,
    };
  }

  /** All children of one page, following the REST paging (start/number). */
  private async getAllChildren(space: string, page: string, hierarchy: string): Promise<XWikiPageSummaryRaw[]> {
    const path = `${this.spacePath(space)}/pages/${encodeURIComponent(page)}/children`;
    const pageSize = 500;
    const all: XWikiPageSummaryRaw[] = [];
    for (let start = 0; ; start += pageSize) {
      const data = await this.get<XWikiPagesResponse>(path, { hierarchy, start, number: pageSize });
      const batch = data.pageSummaries ?? [];
      all.push(...batch);
      if (batch.length < pageSize) return all;
    }
  }

  /** Space and page name of a child summary, falling back to splitting its full name. */
  private splitReference(ref: string, p: XWikiPageSummaryRaw): { space: string; page: string } {
    if (p.space && p.name) return { space: p.space, page: p.name };
    const i = ref.lastIndexOf('.');
    return { space: ref.slice(0, i), page: ref.slice(i + 1) };
  }

  /** Stored title, else page name, else the space name for a WebHome page. */
  private treeTitle(p: XWikiPageSummaryRaw, loc: { space: string; page: string }): string {
    const title = p.title?.trim();
    if (title) return title;
    if (loc.page === 'WebHome') return loc.space.slice(loc.space.lastIndexOf('.') + 1);
    return loc.page;
  }

  /** Map over items with at most `limit` requests in flight, keeping order. */
  private async mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
    const results = new Array<R>(items.length);
    let next = 0;
    const worker = async () => {
      while (next < items.length) {
        const i = next++;
        results[i] = await fn(items[i]);
      }
    };
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
    return results;
  }

  // ---------------------------------------------------------------------------
  // Phase 4: History, Query, Render, Recent Changes
  // ---------------------------------------------------------------------------

  /**
   * Get the revision history of a page.
   * Endpoint: GET /spaces/{space}/pages/{page}/history?number=N
   */
  async getPageHistory(space: string, page: string, limit = 20): Promise<HistorySummary[]> {
    const path = `${this.spacePath(space)}/pages/${encodeURIComponent(page)}/history`;
    const data = await this.get<XWikiHistoryResponse>(path, { number: limit });
    const summaries = data.historySummaries ?? [];
    // XWiki answers an empty history for a page that does not exist; report it as missing.
    if (summaries.length === 0) await this.getPage(space, page);
    return summaries.map(h => ({
      page: h.space && h.name ? `${h.space}.${h.name}` : h.pageId?.replace(/^[^:]*:/, ''),
      version: h.version,
      modified_date: h.modified ? this.parseTimestamp(h.modified) : undefined,
      modifier: h.modifier ? h.modifier.replace(/^xwiki:XWiki\./, '') : undefined,
      comment: h.comment || undefined,
    }));
  }

  /**
   * Roll a page back to an earlier version. xWiki saves the old version's
   * content and objects as a new version, so nothing is lost.
   * Uses the xWiki action URL (no REST endpoint exists for rollback):
   * POST /bin/rollback/{space path}/{page}?rev={version}&confirm=1&form_token=...
   */
  async rollbackPage(space: string, page: string, version: string): Promise<RollbackResult> {
    const history = await this.getPageHistory(space, page, 1000);
    if (!history.some(h => h.version === version)) {
      throw new XWikiError(`Version ${version} not found in the history of ${space}/${page}`, 404);
    }

    const actionPath = [...space.split('.'), page].map(encodeURIComponent).join('/');
    const url = new URL(`${config.baseUrl}/bin/rollback/${actionPath}`);
    url.searchParams.set('rev', version);
    url.searchParams.set('confirm', '1');
    const csrfToken = await this.getCsrfToken();
    if (csrfToken) url.searchParams.set('form_token', csrfToken);

    let response: Response;
    try {
      response = await fetch(url.toString(), {
        method: 'POST',
        headers: { ...this.authHeaders() },
        redirect: 'manual',
        signal: AbortSignal.timeout(config.timeoutMs),
      });
    } catch {
      throw new XWikiError(`Cannot connect to XWiki at ${config.baseUrl}. Check XWIKI_BASE_URL.`);
    }
    // xWiki answers a successful rollback with a redirect to the page view.
    if (response.status >= 400) {
      throw new XWikiError(`Rollback failed: ${response.status} ${response.statusText}`, response.status);
    }

    const latest = (await this.getPageHistory(space, page, 1))[0];
    return { space, page, rolled_back_to: version, new_version: latest?.version, status: 'rolled_back' };
  }

  /**
   * Get a page at a specific historical version.
   * Endpoint: GET /spaces/{space}/pages/{page}/history/{version}
   */
  async getPageVersion(space: string, page: string, version: string): Promise<Page> {
    const path = `${this.spacePath(space)}/pages/${encodeURIComponent(page)}/history/${encodeURIComponent(version)}`;
    const data = await this.get<XWikiPageVersionRaw>(path);
    return {
      title: data.title ?? page,
      content: data.content ?? '',
      syntax: data.syntax ?? 'xwiki/2.1',
      author: data.author,
      modified_date: data.modified ? this.parseTimestamp(data.modified) : undefined,
      version: data.version,
      parent: data.parent,
      url: data.xwikiAbsoluteUrl ?? '',
    };
  }

  /**
   * Run an HQL or XWQL query against the wiki.
   * Endpoint: GET /wikis/xwiki/query?q=...&type=hql|xwql&number=N
   * Note: q should be just the WHERE clause — xWiki prepends SELECT.
   * Example: "where doc.space = 'Main'" (HQL) or "where doc.author = 'XWiki.Admin'" (XWQL)
   */
  async advancedSearch(query: string, type: 'hql' | 'xwql' | 'solr' = 'solr', limit = 20, start = 0): Promise<QueryResult[]> {
    // '/query' is relative to wikiBase (which is already .../wikis/xwiki)
    const data = await this.get<XWikiQueryResponse>('/query', { q: query, type, number: limit, start });
    const results = data.searchResults ?? [];
    return results.map(r => ({
      page_full_name: r.pageFullName ?? r.id ?? '',
      title: r.title,
      space: r.space,
      url: (r.hierarchy?.items?.[r.hierarchy.items.length - 1]?.url) ?? undefined,
    }));
  }

  /**
   * Render a page to plain text or HTML.
   * Uses the xWiki action URL (not REST): /bin/get/{space}/{page}?outputSyntax=...
   * syntax: 'plain' | 'html' (default: 'plain')
   */
  async renderPage(space: string, page: string, syntax: 'plain' | 'html' = 'plain'): Promise<RenderResult> {
    // Both outputs render the page as a reader sees it, sheet included, as HTML. Plain text is
    // taken from that HTML: xWiki's own plain renderer drops the output of html macros, so a
    // page whose sheet draws its view inside {{html}} came back empty.
    const actionUrl = `${config.baseUrl}/bin/get/${this.actionPath(space, page)}`;
    const url = new URL(actionUrl);
    url.searchParams.set('outputSyntax', 'annotatedhtmlmacros');

    const response = await fetch(url.toString(), {
      headers: { Accept: 'text/plain, text/html', ...this.authHeaders() },
      signal: AbortSignal.timeout(config.timeoutMs),
    });
    if (!response.ok) throw new XWikiError(`renderPage failed: ${response.statusText}`, response.status);

    const html = await response.text();
    return { space, page, syntax, content: syntax === 'plain' ? htmlToText(html) : html };
  }

  /**
   * Get recent changes across the entire wiki.
   * Endpoint: GET /wikis/xwiki/modifications?number=N
   */
  async getRecentChanges(limit = 20): Promise<RecentChange[]> {
    const data = await this.get<XWikiHistoryResponse>('/modifications', { number: limit });
    const summaries = data.historySummaries ?? [];
    return summaries.map(h => ({
      page: h.space && h.name ? `${h.space}.${h.name}` : h.pageId?.replace(/^[^:]*:/, ''),
      version: h.version,
      modified_date: h.modified ? this.parseTimestamp(h.modified) : undefined,
      modifier: h.modifier ? h.modifier.replace(/^xwiki:XWiki\./, '') : undefined,
      comment: h.comment || undefined,
    }));
  }

  // ---------------------------------------------------------------------------
  // Phase 5: Wiki-level tags, pages filter, export, object property
  // ---------------------------------------------------------------------------

  /**
   * List all tags used anywhere in the wiki.
   * Endpoint: GET /wikis/xwiki/tags
   */
  async getAllWikiTags(): Promise<WikiTag[]> {
    const data = await this.get<XWikiWikiTagsResponse>('/tags');
    return (data.tags ?? []).map(t => ({ name: t.name }));
  }

  /**
   * Get all pages that have a specific tag.
   * Endpoint: GET /wikis/xwiki/tags/{tag}?number=N
   * Multiple tags can be comma-separated: /tags/tag1,tag2
   */
  async getPagesByTag(tag: string, limit = 50): Promise<PageSummary[]> {
    const encoded = encodeURIComponent(tag);
    const data = await this.get<XWikiTaggedPagesResponse>(`/tags/${encoded}`, { number: limit });
    return (data.pageSummaries ?? []).map(p => ({
      id: p.id,
      title: p.title ?? p.fullName ?? p.id,
      parent: p.parent,
      url: p.xwikiAbsoluteUrl ?? '',
    }));
  }

  /**
   * Find pages wiki-wide with optional filters for name, space, and/or author.
   * Endpoint: GET /wikis/xwiki/pages?name=...&space=...&author=...
   * At least one filter should be provided for useful results.
   */
  async findPages(
    filters: { name?: string; space?: string; author?: string },
    limit = 50,
  ): Promise<PageSummary[]> {
    const params: Record<string, string | number> = { number: limit };
    if (filters.name)   params['name']   = filters.name;
    if (filters.space)  params['space']  = filters.space;
    if (filters.author) params['author'] = filters.author;

    const data = await this.get<XWikiWikiPagesResponse>('/pages', params);
    // Deduplicate by fullName (the /pages endpoint sometimes returns duplicates)
    const seen = new Set<string>();
    return (data.pageSummaries ?? []).filter(p => {
      const key = p.fullName ?? p.id;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).map(p => ({
      id: p.id,
      title: p.title ?? p.fullName ?? p.id,
      parent: p.parent,
      url: p.xwikiAbsoluteUrl ?? '',
    }));
  }

  /**
   * Export a page as PDF.
   * Uses the xWiki action URL: /bin/export/{space}/{page}?format=pdf
   * Returns base64-encoded binary content.
   */
  async exportPage(space: string, page: string, format: 'pdf' | 'xar' | 'html' = 'pdf', options: { children?: boolean; history?: boolean } = {}): Promise<ExportResult> {
    const url = new URL(`${config.baseUrl}/bin/export/${this.actionPath(space, page)}`);
    url.searchParams.set('format', format);
    let init: RequestInit = { headers: { ...this.authHeaders() }, signal: AbortSignal.timeout(config.timeoutMs * 4) };

    if (format !== 'pdf') {
      // XAR and HTML exports must be POSTed; pages selects what goes in (% matches any characters).
      const form = new URLSearchParams({ format, name: `${space}.${page}`, form_token: await this.getCsrfToken() });
      form.append('pages', `${space}.${page}`);
      if (options.children && page === 'WebHome') form.append('pages', `${space}.%`);
      if (format === 'xar' && options.history) form.set('history', 'true');
      init = { ...init, method: 'POST', headers: { ...this.authHeaders(), 'Content-Type': 'application/x-www-form-urlencoded' }, body: form.toString() };
    }

    let response: Response;
    try {
      response = await fetch(url.toString(), init);
    } catch {
      throw new XWikiError(`Cannot connect to XWiki at ${config.baseUrl}. Check XWIKI_BASE_URL.`);
    }
    if (response.status === 401 || response.status === 403) {
      throw new XWikiError(format === 'xar'
        ? 'Permission error. XAR export needs wiki admin rights.'
        : 'Authentication failed. Check XWIKI_AUTH_TYPE and credentials.', response.status);
    }
    if (!response.ok) throw new XWikiError(`exportPage failed: ${response.status} ${response.statusText}`, response.status);

    const contentType = response.headers.get('content-type') ?? '';
    if (format !== 'pdf' && contentType.startsWith('text/html')) {
      // XWiki answers an export it refused (rights, nothing selected) with an HTML page.
      throw new XWikiError(`exportPage failed: XWiki returned a page instead of a ${format} file. ${format === 'xar' ? 'XAR export needs wiki admin rights.' : ''}`.trim(), 500);
    }
    this.checkFileSize(Number(response.headers.get('content-length') ?? 0), url.toString());
    const bytes = new Uint8Array(await response.arrayBuffer());
    this.checkFileSize(bytes.length, url.toString());
    if (format === 'html') {
      // The zip also holds the whole skin (CSS, JavaScript libraries, icons): several MB for one
      // page. Return only the rendered pages, as text.
      const entries = readZip(Buffer.from(bytes));
      // Each page is a full skin page (menus, scripts, footer): keep its content area only.
      const pages = entries
        .filter(e => e.name.startsWith('pages/') && e.name.endsWith('.html'))
        .map(e => ({ path: e.name, html: pageContentHtml(e.data.toString('utf8')) }));
      return { space, page, format, pages, files_omitted: entries.length - pages.length, content_type: 'text/html', size_bytes: bytes.length };
    }
    const defaults = { pdf: 'application/pdf', xar: 'application/zip' };
    return {
      space,
      page,
      format,
      content_base64: Buffer.from(bytes).toString('base64'),
      content_type: contentType || defaults[format],
      size_bytes: bytes.length,
      url: url.toString(),
    };
  }


  /**
   * Get a single named property from an XObject.
   * Endpoint: GET /spaces/.../pages/{pg}/objects/{class}/{n}/properties/{prop}
   */
  async getObjectProperty(
    space: string,
    page: string,
    className: string,
    objectNumber: number,
    propertyName: string,
  ): Promise<ObjectProperty> {
    const path = `${this.spacePath(space)}/pages/${encodeURIComponent(page)}/objects/${encodeURIComponent(className)}/${objectNumber}/properties/${encodeURIComponent(propertyName)}`;
    const data = await this.get<XWikiObjectPropertyResponse>(path);
    // Single-property endpoint returns the property directly at root level
    if (data.name === undefined && data.value === undefined) {
      throw new XWikiError(`Property '${propertyName}' not found on ${className}#${objectNumber}`, 404);
    }
    return {
      name: data.name ?? propertyName,
      value: data.value ?? null,
      type: data.type,
    };
  }

  // ---------------------------------------------------------------------------
  // v0.13: objects by class, tag removal, attachment search, move, required rights
  // ---------------------------------------------------------------------------

  /**
   * List the objects of one class across the whole wiki, ordered by page then object number.
   * Endpoint: GET /wikis/xwiki/classes/{className}/objects?start=&number=&order=
   * The endpoint returns summaries (first property as "headline"); with includeProperties
   * each object is also read in full, a few at a time.
   * Pages the user cannot view are dropped server-side, so a page of results can be short.
   */
  async listClassObjects(
    className: string,
    start = 0,
    limit = 50,
    order: 'page' | 'date' = 'page',
    includeProperties = true,
  ): Promise<{ objects: ClassObject[]; pagination: Pagination }> {
    const params: Record<string, string | number> = { start, number: limit };
    if (order === 'date') params['order'] = 'date';
    const data = await this.get<{ objectSummaries?: XWikiClassObjectSummaryRaw[] }>(
      `/classes/${encodeURIComponent(className)}/objects`, params);
    const summaries = data.objectSummaries ?? [];
    const objects: ClassObject[] = summaries.map(o => {
      const space = o.space ?? '';
      const pageName = o.pageName ?? '';
      return {
        page: space ? `${space}.${pageName}` : (o.pageId ?? '').replace(/^[^:]*:/, ''),
        space,
        page_name: pageName,
        number: o.number,
        page_version: o.pageVersion,
        page_author: o.pageAuthor?.replace(/^xwiki:XWiki\./, ''),
        headline: o.headline || undefined,
      };
    });
    if (includeProperties) {
      const full = await this.mapLimit(objects, 6, o => this.getObject(o.space, o.page_name, className, o.number));
      objects.forEach((o, i) => { o.properties = full[i].properties; });
    }
    return {
      objects,
      pagination: { start, limit, has_more: summaries.length === limit },
    };
  }

  /**
   * Remove tags from a page, keeping the others.
   * Endpoint: PUT /spaces/.../pages/{pg}/tags (the body replaces the page's whole tag list)
   */
  async removeTags(space: string, page: string, tags: string[]): Promise<TagRemoveResult> {
    const existing = (await this.getTags(space, page)).map(t => t.name);
    const drop = new Set(tags);
    const kept = existing.filter(t => !drop.has(t));
    const removed = existing.filter(t => drop.has(t));
    const notFound = tags.filter(t => !existing.includes(t));
    if (removed.length > 0) {
      const path = `${this.spacePath(space)}/pages/${encodeURIComponent(page)}/tags`;
      const tagElements = kept.map(t => `  <tag name="${this.escapeXml(t)}"/>`).join('\n');
      const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<tags xmlns="http://www.xwiki.org">\n${tagElements}\n</tags>`;
      await this.mutate('PUT', path, xml, 'application/xml');
    }
    return { removed, not_found: notFound, tags: kept };
  }

  /**
   * Find attachments wiki-wide, or within one space and its subspaces.
   * Endpoints: GET /wikis/xwiki/attachments, GET /spaces/{s}/attachments
   * Filters (name, page, space, author) match parts of the value; types is a
   * comma-separated list of media types or parts of them (e.g. "image,pdf").
   */
  async searchAttachments(
    filters: { space?: string; name?: string; page?: string; author?: string; types?: string },
    start = 0,
    limit = 25,
  ): Promise<{ attachments: AttachmentSearchResult[]; pagination: Pagination }> {
    const params: Record<string, string | number> = { start, number: limit };
    if (filters.name) params['name'] = filters.name;
    if (filters.page) params['page'] = filters.page;
    if (filters.author) params['author'] = filters.author;
    if (filters.types) params['types'] = filters.types;
    const path = filters.space ? `${this.spacePath(filters.space)}/attachments` : '/attachments';
    const data = await this.get<{ attachments?: Array<XWikiAttachmentRaw & { pageId?: string; version?: string }> }>(path, params);
    const items = data.attachments ?? [];
    return {
      attachments: items.map(a => ({
        name: a.name,
        page: (a.pageId ?? '').replace(/^[^:]*:/, ''),
        size_bytes: a.longSize ?? a.size,
        mime_type: a.mimeType,
        author: a.author?.replace(/^xwiki:XWiki\./, ''),
        date: a.date != null ? this.parseTimestamp(a.date) : undefined,
        version: a.version,
        download_url: a.xwikiAbsoluteUrl ?? '',
      })),
      pagination: { start, limit, has_more: items.length === limit },
    };
  }

  /**
   * Move or rename a page, the way the wiki's Rename action does: history is kept and,
   * by default, child pages move with it and links to it are updated.
   * Uses the action URL /bin/view/{spaces}/{page}?xpage=rename&step=2 (form_token required),
   * which runs the rename job and waits for it. The REST jobs API would need programming rights.
   * The target is given as its final reference; a WebHome target is a nested page
   * (Docs.Manuals + WebHome), any other name a terminal page (Docs.Guides + Install).
   * Needs delete right on the source and edit right on the target.
   */
  async movePage(
    space: string,
    page: string,
    targetSpace: string,
    targetPage: string,
    options: { children?: boolean; updateLinks?: boolean; autoRedirect?: boolean; newTitle?: string } = {},
  ): Promise<MovePageResult> {
    const from = `${space}.${page}`;
    const to = `${targetSpace}.${targetPage}`;
    if (from === to) throw new XWikiError(`Source and target are the same page: ${from}`, 400);

    const { terminal, spaceName: newSpaceName, pageName: newPageName } = this.refactoringTarget(targetSpace, targetPage);
    const children = options.children ?? true;
    const updateLinks = options.updateLinks ?? true;
    const autoRedirect = options.autoRedirect ?? false;

    // The source must exist (REST 404 otherwise) and the target must not.
    const source = await this.getPage(space, page);
    await this.expectMissing(targetSpace, targetPage, to);

    const form = new URLSearchParams({
      xpage: 'rename',
      step: '2',
      newSpaceName,
      newPageName,
      terminal: String(terminal),
      deep: String(children),
      updateLinks: String(updateLinks),
      autoRedirect: String(autoRedirect),
      form_token: await this.getCsrfToken(),
    });
    // Without a title, XWiki retitles a page whose title equals its old name after the new name.
    const title = options.newTitle || source.raw_title || source.title;
    if (title) form.set('newPageTitle', title);

    // XWiki rewrites only the pages its link index lists, and silently skips the rest (e.g. pages
    // saved moments before the move). Note each listed page's version to check it afterwards.
    let before: Map<string, string | undefined> | undefined;
    let linkCheckError: string | undefined;
    if (updateLinks) {
      try {
        const refs = await this.findBacklinks(from, children && !terminal ? `${space}.` : undefined);
        before = new Map(await this.mapLimit(refs, 6, async r => [r, await this.pageVersion(r)] as [string, string | undefined]));
      } catch (e) {
        linkCheckError = e instanceof Error ? e.message : String(e);
      }
    }

    const response = await this.postPageAction('view', space, page, form, config.timeoutMs * 4,
      'Moving a page needs delete right on it and edit right on the target.');
    if (response.status === 409) throw new XWikiError(`Target page already exists: ${to}`, 409);
    // Success redirects to the rename status page (renameId); anything else means the
    // form was shown again (e.g. a stale form_token) and nothing moved.
    this.expectRedirect(response, 'renameId', 'Move');

    // The job ran before the redirect; confirm the result from the target page.
    let moved: Page;
    try {
      moved = await this.getPage(targetSpace, targetPage);
    } catch (e) {
      if (e instanceof XWikiError && e.status === 404) {
        throw new XWikiError(`Move did not complete: ${to} does not exist. Check the page's rename status in the wiki.`, 500);
      }
      throw e;
    }
    let notUpdated: string[] = [];
    if (before) {
      try {
        // A page is rewritten as a new version; an unchanged version still holds the old link.
        const after = await this.mapLimit([...before], 6, async ([r, v]) => (await this.pageVersion(r)) === v ? r : undefined);
        notUpdated = after.filter((r): r is string => r !== undefined);
        // Pages indexed only now were not seen by XWiki either.
        const late = await this.findBacklinks(from, children && !terminal ? `${space}.` : undefined);
        notUpdated.push(...late.filter(r => !before!.has(r)));
      } catch (e) {
        linkCheckError = e instanceof Error ? e.message : String(e);
      }
    }
    return {
      from,
      to,
      children_moved: children && !terminal,
      links_updated: updateLinks && !!before && !linkCheckError && notUpdated.length === 0,
      ...(before ? { backlinks_found: before.size } : {}),
      ...(notUpdated.length ? { links_not_updated: notUpdated } : {}),
      ...(linkCheckError ? { link_check_error: linkCheckError } : {}),
      redirect_left: autoRedirect,
      url: moved.url,
      status: 'moved',
    };
  }

  /**
   * Pages that link to a page, from the wiki's link index (Solr links_extended), as the
   * rename job finds them. Leaves out the page itself and pages under excludePrefix.
   */
  private async findBacklinks(ref: string, excludePrefix?: string): Promise<string[]> {
    const target = `entity:document:${config.wikiName}:${ref}`.replace(/["\\]/g, '\\$&');
    const results = await this.advancedSearch(`links_extended:"${target}"`, 'solr', 200, 0);
    const refs = new Set(results.map(r => r.page_full_name).filter(r => r && r !== ref));
    return [...refs].filter(r => !excludePrefix || !r.startsWith(excludePrefix));
  }

  /** Current version of a page given as a full reference (Space.Sub.Page), or undefined if it is gone. */
  private async pageVersion(ref: string): Promise<string | undefined> {
    const dot = ref.lastIndexOf('.');
    try {
      return (await this.getPage(ref.slice(0, dot), ref.slice(dot + 1))).version;
    } catch (e) {
      if (e instanceof XWikiError && e.status === 404) return undefined;
      throw e;
    }
  }

  /**
   * Analyse which rights a page's content needs (scripts, macros, HTML) against the
   * rights the page declares. XWiki 17.4+; needs edit right on the page.
   * Endpoint: GET /spaces/.../pages/{pg}/requiredRights
   */
  async getRequiredRights(space: string, page: string): Promise<RequiredRightsReport> {
    const path = `${this.spacePath(space)}/pages/${encodeURIComponent(page)}/requiredRights`;
    const data = await this.get<XWikiRequiredRightsResponse>(path);
    const text = (html?: string) => (html ?? '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ')
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
      .replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
    return {
      page: `${space}.${page}`,
      declared: {
        enforce: data.currentRights?.enforce ?? false,
        rights: (data.currentRights?.rights ?? []).map(r => ({ right: r.right, scope: r.scope || undefined })),
      },
      needed: (data.availableRights ?? [])
        // XWiki lists "no extra right" as an entry with an empty right; leave it out.
        .filter(r => r.right && (r.definitelyRequiredRight || r.maybeRequiredRight))
        .map(r => ({
          right: r.right,
          scope: r.scope || undefined,
          definitely: r.definitelyRequiredRight ?? false,
          current_user_has: r.hasRight ?? false,
        })),
      findings: (data.analysisResults ?? []).map(a => ({
        entity: a.entityReference ?? '',
        summary: text(a.summaryMessageHTML),
        rights: (a.requiredRights ?? []).map(r => ({
          right: r.right,
          entity_type: r.entityType || undefined,
          manual_review: r.manualReviewNeeded ?? false,
        })),
      })),
    };
  }

  // ---------------------------------------------------------------------------
  // v0.14: copy, recycle bin, property state, attachment move/history,
  // property values, version compare, comment edit/delete
  // ---------------------------------------------------------------------------

  /**
   * Copy a page (and, for a nested page, optionally its children) to a new reference.
   * Uses the copy form: /bin/view/{spaces}/{page}?xpage=copy (form_token required),
   * which runs the copy job and waits for it. Needs view right on the source and edit
   * right on the target. Same target naming as movePage.
   */
  async copyPage(
    space: string,
    page: string,
    targetSpace: string,
    targetPage: string,
    options: { children?: boolean; newTitle?: string } = {},
  ): Promise<CopyPageResult> {
    const from = `${space}.${page}`;
    const to = `${targetSpace}.${targetPage}`;
    if (from === to) throw new XWikiError(`Source and target are the same page: ${from}`, 400);
    const { terminal, spaceName, pageName } = this.refactoringTarget(targetSpace, targetPage);
    const children = options.children ?? true;

    const source = await this.getPage(space, page);
    await this.expectMissing(targetSpace, targetPage, to);

    const form = new URLSearchParams({
      xpage: 'copy',
      sourceSpaceName: space,
      sourcePageName: page,
      targetSpaceName: spaceName,
      targetPageName: pageName,
      terminal: String(terminal),
      deep: String(children),
      form_token: await this.getCsrfToken(),
    });
    // Without a title, XWiki retitles a page whose title equals its old name after the new name.
    const copyTitle = options.newTitle || source.raw_title || source.title;
    if (copyTitle) form.set('targetPageTitle', copyTitle);

    const response = await this.postPageAction('view', space, page, form, config.timeoutMs * 4,
      'Copying a page needs view right on it and edit right on the target.');
    this.expectRedirect(response, 'copyId', 'Copy');

    const copied = await this.getPage(targetSpace, targetPage).catch(e => {
      if (e instanceof XWikiError && e.status === 404) {
        throw new XWikiError(`Copy did not complete: ${to} does not exist. Check the page's copy status in the wiki.`, 500);
      }
      throw e;
    });
    return { from, to, children_copied: children && !terminal, url: copied.url, status: 'copied' };
  }

  /**
   * List pages in the recycle bin, newest first.
   * There is no REST endpoint; this reads the JSON service page behind the wiki's
   * Deleted Documents view: /bin/get/XWiki/DeletedDocumentsJSON?list=1&xpage=plain
   * name filters the page reference (part of it, case-insensitive).
   */
  async listDeletedPages(name: string | undefined, start = 0, limit = 25): Promise<{ pages: DeletedPage[]; pagination: Pagination }> {
    const url = new URL(`${config.baseUrl}/bin/get/XWiki/DeletedDocumentsJSON`);
    const params: Record<string, string> = {
      list: '1', xpage: 'plain', outputSyntax: 'plain', reqNo: '1',
      offset: String(start + 1), limit: String(limit), sort: 'ddoc.date', dir: 'desc',
    };
    if (name) params['ddoc.fullName'] = name;
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    const data = await this.fetchActionJson<XWikiDeletedDocumentsResponse>(url.toString(), true);
    if (data === undefined) return this.listDeletedPagesFromTemplate(name, start, limit);
    const rows = data.rows ?? [];
    return {
      pages: rows.map(r => ({
        id: Number(/[?&]id=(\d+)/.exec(r.restoreUrl ?? '')?.[1] ?? NaN),
        page: r.fullname,
        title: r.title || undefined,
        language: r.language || undefined,
        deleted_by: (r.deleter ?? '').replace(/^xwiki:XWiki\./, '').replace(/^XWiki\./, '') || undefined,
        deleted_date: r.date || undefined,
        batch_id: r.batchId || undefined,
        can_restore: r.canRestore ?? false,
        page_exists_again: r.alreadyExists ?? false,
      })),
      pagination: { total: data.totalrows, start, limit, has_more: start + rows.length < (data.totalrows ?? 0) },
    };
  }

  /**
   * Fallback for wikis without XWiki.DeletedDocumentsJSON (a page of the standard flavor):
   * the core template behind the skin's restore view, ?xpage=getdeleteddocuments. It has no
   * name filter, so with a name the newest 1000 entries are read and filtered here.
   */
  private async listDeletedPagesFromTemplate(name: string | undefined, start: number, limit: number): Promise<{ pages: DeletedPage[]; pagination: Pagination }> {
    const url = new URL(`${config.baseUrl}/bin/get/Main/WebHome`);
    const window = name ? { offset: 1, limit: 1000 } : { offset: start + 1, limit };
    for (const [k, v] of Object.entries({ xpage: 'getdeleteddocuments', outputSyntax: 'plain', sort: 'ddoc.date', dir: 'desc', offset: String(window.offset), limit: String(window.limit) })) {
      url.searchParams.set(k, v);
    }
    const data = await this.fetchActionJson<XWikiDeletedDocumentsTemplateResponse>(url.toString(), true);
    if (data === undefined) throw new XWikiError('This wiki has no recycle-bin listing (neither XWiki.DeletedDocumentsJSON nor the getdeleteddocuments template).', 404);
    let pages: DeletedPage[] = (data.rows ?? []).filter(r => r.doc_viewable).map(r => ({
      id: Number(/[?&]id=(\d+)/.exec(r.doc_restore_url ?? '')?.[1] ?? NaN),
      page: r.doc_fullName ?? '',
      title: r.doc_name || undefined,
      language: r.doc_locale || undefined,
      deleted_by: r.doc_deleter || undefined,
      deleted_date: r.doc_date || undefined,
      can_restore: r.doc_hasrestore ?? false,
    }));
    if (!name) {
      return { pages, pagination: { total: data.totalrows, start, limit, has_more: start + pages.length < (data.totalrows ?? 0) } };
    }
    const needle = name.toLowerCase();
    pages = pages.filter(p => p.page.toLowerCase().includes(needle));
    return { pages: pages.slice(start, start + limit), pagination: { total: pages.length, start, limit, has_more: start + limit < pages.length } };
  }


  /**
   * Restore a page from the recycle bin by its recycle-bin id (from listDeletedPages).
   * Action URL: /bin/undelete/{spaces}/{page}?id={id} (form_token required). Refused if a
   * page exists at that reference again. Restores only that entry, not the rest of its batch.
   */
  async restorePage(space: string, page: string, id: number): Promise<RestorePageResult> {
    const ref = `${space}.${page}`;
    await this.expectMissing(space, page, ref, 'A page exists at that reference again; move or rename it first');
    const form = new URLSearchParams({ id: String(id), form_token: await this.getCsrfToken() });
    const response = await this.postPageAction('undelete', space, page, form, config.timeoutMs * 4,
      'Restoring a page needs the right to undelete it (usually its deleter or an admin).');
    if (!(response.status >= 300 && response.status < 400)) {
      this.csrfToken = null;
      throw new XWikiError(`Restore was not started (HTTP ${response.status}). Nothing was changed.`, response.status);
    }
    const restored = await this.getPage(space, page).catch(e => {
      if (e instanceof XWikiError && e.status === 404) {
        throw new XWikiError(`Restore did not complete: ${ref} does not exist. Check that recycle-bin id ${id} is this page's.`, 500);
      }
      throw e;
    });
    return { page: ref, id, url: restored.url, status: 'restored' };
  }

  /**
   * Disable or enable a class property. A disabled property is hidden from forms and
   * new objects; existing values are kept. Action URLs /bin/propdisable/ and /bin/propenable/.
   */
  async setClassPropertyEnabled(className: string, property: string, enabled: boolean): Promise<ClassPropertyStateResult> {
    const before = await this.getClass(className);
    if (!before.properties.some(p => p.name === property)) {
      throw new XWikiError(`Property '${property}' not found in class ${className}`, 404);
    }
    await this.postClassAction(enabled ? 'propenable' : 'propdisable', className, new URLSearchParams({ propname: property }));
    const after = await this.getClass(className);
    const disabled = after.properties.find(p => p.name === property)?.attributes?.['disabled'];
    if (disabled !== undefined && (disabled === '1') === enabled) {
      throw new XWikiError(`Property '${property}' was not ${enabled ? 'enabled' : 'disabled'}; read back disabled=${disabled}`, 500);
    }
    return { class_name: className, property, enabled, confirmed: disabled !== undefined, status: enabled ? 'enabled' : 'disabled' };
  }

  /**
   * Move or rename an attachment, optionally to another page.
   * Uses the attachment move form (/bin/view/{page}?xpage=attachment/move&step=2), which
   * starts a background job; its status is polled until it finishes, then the target is read back.
   */
  async moveAttachment(
    space: string,
    page: string,
    filename: string,
    targetSpace: string,
    targetPage: string,
    targetFilename: string,
    options: { updateReferences?: boolean; autoRedirect?: boolean } = {},
  ): Promise<AttachmentMoveResult> {
    const from = `${space}.${page}@${filename}`;
    const to = `${targetSpace}.${targetPage}@${targetFilename}`;
    if (from === to) throw new XWikiError(`Source and target are the same attachment: ${from}`, 400);
    const updateReferences = options.updateReferences ?? true;
    const autoRedirect = options.autoRedirect ?? false;

    const source = await this.getAttachments(space, page);
    if (!source.some(a => a.name === filename)) throw new XWikiError(`Attachment not found: ${from}`, 404);
    const existing = await this.getAttachments(targetSpace, targetPage);
    if (existing.some(a => a.name === targetFilename)) throw new XWikiError(`Target attachment already exists: ${to}`, 409);

    const form = new URLSearchParams({
      xpage: 'attachment/move',
      step: '2',
      sourceLocation: `${space}.${page}`,
      sourceAttachmentName: filename,
      targetLocation: `${targetSpace}.${targetPage}`,
      targetAttachmentName: targetFilename,
      updateReferences: String(updateReferences),
      autoRedirect: String(autoRedirect),
      form_token: await this.getCsrfToken(),
    });
    const response = await this.postPageAction('view', space, page, form, config.timeoutMs * 4,
      'Moving an attachment needs edit right on both pages.');
    if (response.status === 409) throw new XWikiError(`Target attachment already exists: ${to}`, 409);
    const moveId = this.expectRedirect(response, 'moveId', 'Attachment move');

    // Poll the move job until it leaves the running states.
    const statusUrl = new URL(`${config.baseUrl}/bin/get/${this.actionPath(space, page)}`);
    statusUrl.searchParams.set('xpage', 'attachment/move');
    statusUrl.searchParams.set('moveId', moveId);
    let state = '';
    for (let i = 0; i < 60; i++) {
      const job = await this.fetchActionJson<{ state?: string; log?: { items?: Array<{ level: string; renderedMessage?: string }> } }>(statusUrl.toString());
      state = job.state ?? '';
      const error = job.log?.items?.find(l => l.level === 'error');
      if (error) throw new XWikiError(`Attachment move failed: ${(error.renderedMessage ?? '').replace(/<[^>]*>/g, '').trim()}`, 500);
      if (state === 'FINISHED') break;
      await new Promise(r => setTimeout(r, this.pollIntervalMs));
    }
    if (state !== 'FINISHED') throw new XWikiError(`Attachment move still running (state ${state || 'unknown'}); check ${to} later.`, 500);

    const moved = (await this.getAttachments(targetSpace, targetPage)).find(a => a.name === targetFilename);
    if (!moved) throw new XWikiError(`Attachment move did not complete: ${to} does not exist.`, 500);
    return { from, to, references_updated: updateReferences, redirect_left: autoRedirect, download_url: moved.download_url, status: 'moved' };
  }

  /** Poll interval for background jobs (overridden in tests). */
  pollIntervalMs = 1000;

  /**
   * Version history of one attachment, newest first.
   * Endpoint: GET /spaces/.../pages/{pg}/attachments/{name}/history
   */
  async getAttachmentHistory(space: string, page: string, filename: string): Promise<AttachmentVersion[]> {
    const path = `${this.spacePath(space)}/pages/${encodeURIComponent(page)}/attachments/${encodeURIComponent(filename)}/history`;
    const data = await this.get<{ attachments?: Array<XWikiAttachmentRaw & { version?: string }> }>(path);
    // XWiki lists the versions oldest first; return them newest first.
    const versionKey = (v?: string) => (v ?? '0.0').split('.').map(Number);
    const sorted = [...(data.attachments ?? [])].sort((a, b) => {
      const [aMajor, aMinor] = versionKey(a.version);
      const [bMajor, bMinor] = versionKey(b.version);
      return bMajor - aMajor || bMinor - aMinor;
    });
    return sorted.map(a => ({
      version: a.version,
      size_bytes: a.longSize ?? a.size,
      mime_type: a.mimeType,
      author: a.author?.replace(/^xwiki:XWiki\./, ''),
      date: a.date != null ? this.parseTimestamp(a.date) : undefined,
      download_url: a.xwikiAbsoluteUrl ?? '',
    }));
  }

  /**
   * Allowed values of a class property whose values come from elsewhere: a database list
   * (DBList, DBTreeList), page, user or group pickers. StaticList values are in getClass.
   * Endpoint: GET /classes/{class}/properties/{prop}/values?limit=&fp=
   */
  async getClassPropertyValues(className: string, property: string, filter?: string, limit = 100): Promise<ClassPropertyValue[]> {
    const params: Record<string, string | number> = { limit };
    if (filter) params['fp'] = filter;
    const data = await this.get<{ propertyValues?: Array<{ value: unknown; metaData?: Record<string, unknown> }> }>(
      `/classes/${encodeURIComponent(className)}/properties/${encodeURIComponent(property)}/values`, params);
    return (data.propertyValues ?? []).map(v => {
      const label = v.metaData?.['label'];
      return { value: v.value, ...(label !== undefined && label !== v.value ? { label: String(label) } : {}) };
    });
  }

  /**
   * Compare two versions of a page: a unified diff of the content plus title and author changes.
   * toVersion defaults to the current version. The diff is computed here; XWiki's REST API has none.
   */
  async comparePageVersions(space: string, page: string, fromVersion: string, toVersion?: string, context = 3): Promise<VersionComparison> {
    const a = await this.getPageVersion(space, page, fromVersion);
    const b = toVersion ? await this.getPageVersion(space, page, toVersion) : await this.getPage(space, page);
    // A page or version read is dated by its last content change, so a version that only changed
    // objects, tags or attachments would show an older date. The history has each version's own.
    const history = await this.getPageHistory(space, page, 1000);
    const side = (p: Page, fallback: string) => {
      const version = p.version ?? fallback;
      const h = history.find(e => e.version === version);
      return { version, author: p.author, date: h?.modified_date ?? p.modified_date };
    };
    const { diff, added, removed } = unifiedDiff(a.content, b.content, context);
    return {
      page: `${space}.${page}`,
      from: side(a, fromVersion),
      to: side(b, toVersion ?? 'current'),
      ...(a.title !== b.title ? { title_change: { from: a.title, to: b.title } } : {}),
      ...(a.syntax !== b.syntax ? { syntax_change: { from: a.syntax, to: b.syntax } } : {}),
      lines_added: added,
      lines_removed: removed,
      diff,
    };
  }

  /**
   * Edit a comment's text. Comments are XWiki.XWikiComments objects; the comment id is the object number.
   */
  async updateComment(space: string, page: string, id: number, text: string): Promise<Comment> {
    await this.getObject(space, page, 'XWiki.XWikiComments', id);
    await this.updateObject(space, page, 'XWiki.XWikiComments', id, { comment: text });
    const after = (await this.getComments(space, page)).find(c => c.id === id);
    if (!after || after.text !== text) throw new XWikiError(`Comment ${id} was not updated; read back a different text.`, 500);
    return after;
  }

  /**
   * Delete a comment (its XWiki.XWikiComments object). Replies to it are kept.
   */
  async deleteComment(space: string, page: string, id: number): Promise<{ id: number; status: 'deleted' }> {
    await this.getObject(space, page, 'XWiki.XWikiComments', id);
    await this.deleteObject(space, page, 'XWiki.XWikiComments', id);
    return { id, status: 'deleted' };
  }

  // ---------------------------------------------------------------------------
  // Action URL helpers (refactoring forms)
  // ---------------------------------------------------------------------------

  /** "/Docs/Guides/Setup" style path for /bin/{action}/ URLs. */
  private actionPath(space: string, page: string): string {
    return [...space.split('.'), page].map(encodeURIComponent).join('/');
  }

  /**
   * The rename and copy forms name the target by parent space + name; for a nested
   * (WebHome) target the name is its last space.
   */
  private refactoringTarget(targetSpace: string, targetPage: string): { terminal: boolean; spaceName: string; pageName: string } {
    const terminal = targetPage !== 'WebHome';
    const i = targetSpace.lastIndexOf('.');
    return {
      terminal,
      spaceName: terminal ? targetSpace : (i > 0 ? targetSpace.slice(0, i) : ''),
      pageName: terminal ? targetPage : targetSpace.slice(i + 1),
    };
  }

  /** Throw 409 if a page exists at the reference (REST 404 means it is free). */
  private async expectMissing(space: string, page: string, ref: string, message = 'Target page already exists'): Promise<void> {
    try {
      await this.getPage(space, page);
    } catch (e) {
      if (e instanceof XWikiError && e.status === 404) return;
      throw e;
    }
    throw new XWikiError(`${message}: ${ref}`, 409);
  }

  /** POST a form to /bin/{action}/{page} without following redirects. */
  private async postPageAction(action: string, space: string, page: string, form: URLSearchParams, timeoutMs: number, rightsHint: string): Promise<Response> {
    const url = `${config.baseUrl}/bin/${action}/${this.actionPath(space, page)}`;
    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: { ...this.authHeaders(), 'Content-Type': 'application/x-www-form-urlencoded' },
        body: form.toString(),
        redirect: 'manual',
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      throw new XWikiError(`Cannot connect to XWiki at ${config.baseUrl}. Check XWIKI_BASE_URL.`);
    }
    if (response.status === 401 || response.status === 403) {
      throw new XWikiError(`Authentication or permission error. ${rightsHint}`, response.status);
    }
    if (response.status >= 400 && response.status !== 409) {
      throw new XWikiError(`XWiki server error: ${response.status}. URL: ${url}`, response.status);
    }
    return response;
  }

  /**
   * A refactoring form redirects to its status page with the job id (renameId, copyId,
   * moveId) when it started the job; otherwise it showed the form again (for example a
   * stale form_token) and nothing changed. Returns the job id.
   */
  private expectRedirect(response: Response, idParam: string, what: string): string {
    const location = response.headers.get('location') ?? '';
    const id = new RegExp(`[?&]${idParam}=([^&]+)`).exec(location)?.[1];
    if (!(response.status >= 300 && response.status < 400) || !id) {
      this.csrfToken = null;
      throw new XWikiError(`${what} was not started (HTTP ${response.status}). Nothing was changed; try again.`, response.status);
    }
    return decodeURIComponent(id);
  }

  /** GET a JSON response from an action URL (/bin/get/...). */
  /** GET JSON from an action URL. With optional, an empty or non-JSON body (page missing) gives undefined. */
  private async fetchActionJson<T>(url: string): Promise<T>;
  private async fetchActionJson<T>(url: string, optional: true): Promise<T | undefined>;
  private async fetchActionJson<T>(url: string, optional = false): Promise<T | undefined> {
    let response: Response;
    try {
      response = await fetch(url, {
        headers: { Accept: 'application/json', ...this.authHeaders() },
        signal: AbortSignal.timeout(config.timeoutMs),
      });
    } catch {
      throw new XWikiError(`Cannot connect to XWiki at ${config.baseUrl}. Check XWIKI_BASE_URL.`);
    }
    if (response.status === 401 || response.status === 403) {
      throw new XWikiError('Authentication failed. Check XWIKI_AUTH_TYPE and credentials.', response.status);
    }
    if (optional && response.status === 404) return undefined;
    if (!response.ok) throw new XWikiError(`XWiki server error: ${response.status}. URL: ${url}`, response.status);
    if (!optional) return response.json() as Promise<T>;
    const text = (await response.text()).trim();
    if (!text.startsWith('{')) return undefined;
    try {
      return JSON.parse(text) as T;
    } catch {
      return undefined;
    }
  }


  // ---------------------------------------------------------------------------
  // Utility
  // ---------------------------------------------------------------------------

  /** Convert a Unix ms timestamp (number or digit string) or ISO string to an ISO date string */
  private parseTimestamp(v: number | string): string {
    if (typeof v === 'number') return new Date(v).toISOString();
    if (/^\d+$/.test(v)) return new Date(Number(v)).toISOString();
    return v;
  }

  /** Escape special XML characters in content */
  /**
   * Object properties as an xWiki REST form body: property#<name>=<value>.
   * xWiki's form-encoded object endpoints set each property directly. (The
   * XML form was silently ignored: xWiki saved the object with no values.)
   */
  private propertiesForm(properties: Record<string, string>): URLSearchParams {
    const form = new URLSearchParams();
    for (const [name, value] of Object.entries(properties)) form.set(`property#${name}`, value);
    return form;
  }

  private escapeXml(s: string): string {
    return s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  /** Flatten xWiki object properties array into a plain key-value record */
  private flattenObjectProperties(properties?: Array<{ name: string; value?: unknown }>): Record<string, unknown> {
    if (!properties) return {};
    return Object.fromEntries(properties.map(p => [p.name, p.value ?? null]));
  }
}

/**
 * Read the files of a zip archive (stored or deflated entries) from its central directory.
 * Enough for XWiki's export zips; no encryption or zip64.
 */
export function readZip(buf: Buffer): Array<{ name: string; data: Buffer }> {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new XWikiError('Export is not a valid zip file.', 500);
  const count = buf.readUInt16LE(eocd + 10);
  let pos = buf.readUInt32LE(eocd + 16);
  const files: Array<{ name: string; data: Buffer }> = [];
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(pos) !== 0x02014b50) throw new XWikiError('Export zip has a damaged directory.', 500);
    const method = buf.readUInt16LE(pos + 10);
    const compressedSize = buf.readUInt32LE(pos + 20);
    const nameLength = buf.readUInt16LE(pos + 28);
    const extraLength = buf.readUInt16LE(pos + 30);
    const commentLength = buf.readUInt16LE(pos + 32);
    const localOffset = buf.readUInt32LE(pos + 42);
    const name = buf.toString('utf8', pos + 46, pos + 46 + nameLength);
    pos += 46 + nameLength + extraLength + commentLength;
    if (name.endsWith('/')) continue;
    const dataStart = localOffset + 30 + buf.readUInt16LE(localOffset + 26) + buf.readUInt16LE(localOffset + 28);
    const raw = buf.subarray(dataStart, dataStart + compressedSize);
    files.push({ name, data: method === 8 ? inflateRawSync(raw) : Buffer.from(raw) });
  }
  return files;
}

/**
 * The inner HTML of a skin page's content area (the element with id "xwikicontent"), or, when
 * there is none, the whole page without its script elements.
 */
export function pageContentHtml(html: string): string {
  const open = /<div\b[^>]*\bid="xwikicontent"[^>]*>/i.exec(html);
  if (!open) return html.replace(/<script\b[\s\S]*?<\/script>/gi, '');
  const from = open.index + open[0].length;
  const tag = /<(\/?)div\b[^>]*>/gi;
  tag.lastIndex = from;
  let depth = 1;
  for (let m = tag.exec(html); m; m = tag.exec(html)) {
    depth += m[1] ? -1 : 1;
    if (depth === 0) return html.slice(from, m.index).trim();
  }
  return html.slice(from).trim();
}
