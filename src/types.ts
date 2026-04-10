// XWiki REST API response shapes (raw, before transformation)

export interface XWikiSpaceRaw {
  id: string;
  name: string;
  home?: string;
  xwikiRelativeUrl?: string;
  xwikiAbsoluteUrl?: string;
}

export interface XWikiSpacesResponse {
  spaces: XWikiSpaceRaw[];
}

export interface XWikiPageSummaryRaw {
  id: string;
  fullName: string;
  title: string;
  parent?: string;
  wiki?: string;
  space?: string;
  name?: string;
  version?: string;
  author?: string;
  xwikiRelativeUrl?: string;
  xwikiAbsoluteUrl?: string;
}

export interface XWikiPagesResponse {
  pageSummaries: XWikiPageSummaryRaw[];
  totalResults?: number;
}

export interface XWikiPageRaw {
  id: string;
  fullName: string;
  title: string;
  content: string;
  syntax: string;
  author?: string;
  contentAuthor?: string;
  modified?: string;
  created?: string;
  version?: string;
  parent?: string;
  xwikiAbsoluteUrl?: string;
}

export interface XWikiSearchResultRaw {
  id: string;
  type: string;
  score?: number;
  title?: string;
  space?: string;
  modified?: string | number;
  pageFullName?: string;
  object?: null | Record<string, unknown>;
  hierarchy?: {
    items: Array<{
      label: string;
      name: string;
      type: string;
      url: string;
    }>;
  };
}

export interface XWikiSearchResponse {
  searchResults: XWikiSearchResultRaw[];
  totalResults?: number;
}

export interface XWikiAttachmentRaw {
  id?: string;
  name: string;
  size?: number;
  longSize?: number;
  mimeType?: string;
  author?: string;
  date?: string | number;
  xwikiRelativeUrl?: string;
  xwikiAbsoluteUrl?: string;
}

export interface XWikiAttachmentsResponse {
  attachments: XWikiAttachmentRaw[];
}

// XWiki REST API response shapes for comments

export interface XWikiCommentRaw {
  id?: number;
  author?: string;
  authorName?: string;
  date?: string | number;
  text?: string;
  highlight?: string;
  replyTo?: number;
  xwikiAbsoluteUrl?: string;
}

export interface XWikiCommentsResponse {
  comments: XWikiCommentRaw[];
}

// Phase 2: Tags

export interface XWikiTagRaw {
  name: string;
}

export interface XWikiTagsResponse {
  tags: XWikiTagRaw[];
}

// Phase 3: Classes and Objects

export interface XWikiClassPropertyRaw {
  name: string;
  type?: string;
  value?: unknown;
  attributes?: Array<{ name: string; value: string }>;
}

export interface XWikiClassRaw {
  id: string;
  name: string;
  properties?: XWikiClassPropertyRaw[];
}

export interface XWikiClassesResponse {
  // xWiki uses the (typo) key 'clazzs' in the REST API response
  clazzs: XWikiClassRaw[];
}

export interface XWikiObjectPropertyRaw {
  name: string;
  value?: unknown;
  type?: string;
}

export interface XWikiObjectRaw {
  id?: string;
  guid?: string;
  className: string;
  number: number;
  pageName?: string;
  pageId?: string;
  wiki?: string;
  properties?: XWikiObjectPropertyRaw[];
  xwikiAbsoluteUrl?: string;
}

export interface XWikiObjectSummaryRaw {
  id?: string;
  guid?: string;
  className: string;
  number: number;
  pageName?: string;
  pageId?: string;
  xwikiAbsoluteUrl?: string;
}

export interface XWikiObjectsResponse {
  objectSummaries?: XWikiObjectSummaryRaw[];
  objects?: XWikiObjectRaw[];
}

// Transformed output types (what tools return)

export interface Space {
  id: string;
  name: string;
  home_url: string;
}

export interface PageSummary {
  id: string;
  title: string;
  parent?: string;
  url: string;
}

export interface Page {
  title: string;
  content: string;
  syntax: string;
  author?: string;
  modified_date?: string;
  version?: string;
  parent?: string;
  url: string;
}

export interface SearchResult {
  id: string;
  title: string;
  space?: string;
  url: string;
  score?: number;
  modified_date?: string;
}

export interface Attachment {
  name: string;
  size_bytes?: number;
  mime_type?: string;
  author?: string;
  date?: string;
  download_url: string;
}

export interface AttachmentWriteResult {
  name: string;
  size_bytes?: number;
  mime_type?: string;
  url: string;
  status: string;
}

export interface Comment {
  id?: number;
  author?: string;
  date?: string;
  text: string;
  reply_to?: number;
}

export interface PageWriteResult {
  title: string;
  version?: string;
  url: string;
  status: string;
}

export interface Pagination {
  total?: number;
  start: number;
  limit: number;
  has_more: boolean;
}

// Phase 2: Tags

export interface Tag {
  name: string;
}

// Phase 3: Classes and Objects

export interface XWikiClass {
  id: string;
  name: string;
  property_count: number;
  properties: Array<{
    name: string;
    type?: string;
  }>;
}

export interface XWikiObject {
  class_name: string;
  number: number;
  page_id?: string;
  url?: string;
  properties: Record<string, unknown>;
}

export interface XWikiObjectWriteResult {
  class_name: string;
  number: number;
  url?: string;
  status: string;
}

// ---------------------------------------------------------------------------
// Phase 4: History, Query, Render, Recent Changes
// ---------------------------------------------------------------------------

export interface XWikiHistorySummaryRaw {
  version: string;
  /** Unix millisecond timestamp or ISO string */
  modified?: number | string;
  modifier?: string;
  comment?: string;
}

export interface XWikiHistoryResponse {
  historySummaries: XWikiHistorySummaryRaw[];
}

/** Full page at a specific version — same shape as XWikiPageRaw */
export type XWikiPageVersionRaw = XWikiPageRaw;

/** Query endpoint response — shares structure with search */
export interface XWikiQueryResponse {
  searchResults: XWikiSearchResultRaw[];
  totalResults?: number;
}

// Transformed Phase 4 output types

export interface HistorySummary {
  version: string;
  modified_date?: string;
  modifier?: string;
  comment?: string;
}

export interface QueryResult {
  page_full_name: string;
  title?: string;
  space?: string;
  url?: string;
}

export interface RenderResult {
  space: string;
  page: string;
  syntax: string;
  content: string;
}

export interface RecentChange {
  version: string;
  modified_date?: string;
  modifier?: string;
  comment?: string;
}

// ---------------------------------------------------------------------------
// Phase 5: Tags (wiki-level), Wiki-wide Pages, Export, Object Property
// ---------------------------------------------------------------------------

export interface XWikiWikiTagRaw {
  name: string;
}

export interface XWikiWikiTagsResponse {
  tags: XWikiWikiTagRaw[];
}

// pages tagged with a specific tag share the pageSummaries shape
export type XWikiTaggedPagesResponse = XWikiPagesResponse;

// wiki-wide pages filter shares the pageSummaries shape
export type XWikiWikiPagesResponse = XWikiPagesResponse;

export interface XWikiObjectPropertyValueRaw {
  name: string;
  value?: unknown;
  type?: string;
  attributes?: Array<{ name: string; value: string }>;
}

/**
 * Single-property endpoint returns the property directly at root level,
 * NOT wrapped in a properties array.
 */
export interface XWikiObjectPropertyResponse {
  name?: string;
  value?: unknown;
  type?: string;
  attributes?: Array<{ name: string; value: string }>;
}

// Transformed Phase 5 output types

export interface WikiTag {
  name: string;
}

export interface ObjectProperty {
  name: string;
  value: unknown;
  type?: string;
}

export interface ExportResult {
  space: string;
  page: string;
  format: string;
  /** base64-encoded file content */
  content_base64: string;
  content_type: string;
  size_bytes: number;
}
