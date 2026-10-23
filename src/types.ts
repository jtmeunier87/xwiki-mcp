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
    attributes?: Record<string, string>; // only from getClass
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
  /** e.g. "xwiki:Main.WebHome" (on /modifications; the page's own history omits it in practice) */
  pageId?: string;
  space?: string;
  name?: string;
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
  /** Page reference, e.g. "Main.WebHome" */
  page?: string;
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
  /** base64-encoded file content (pdf, xar) */
  content_base64?: string;
  /** html: the rendered page files from the export zip */
  pages?: Array<{ path: string; html: string }>;
  /** html: skin, script and image files in the zip that were left out */
  files_omitted?: number;
  content_type: string;
  size_bytes: number;
  /** The export URL */
  url?: string;
}

export interface ClassUpdateResult {
  class_name: string;
  changes: Array<{ property: string; attribute: string; value: string }>;
  status: 'updated';
}

export interface ClassAddResult {
  class_name: string;
  property: string;
  type: string;
  attributes: Record<string, string>;
  status: 'added';
}

export interface RollbackResult {
  space: string;
  page: string;
  rolled_back_to: string;
  new_version?: string;
  status: 'rolled_back';
}

export interface PageTreeNode {
  reference: string;
  title: string;
  /** 0 = the root page, 1 = direct child of the root */
  level: number;
  parent: string;
  child_count: number;
  url: string;
  /** Object class name -> number of objects of that class on the page */
  classes?: Record<string, number>;
}

export interface PageTree {
  root: string;
  /** The root page itself (level 0), with its own object classes */
  root_page: PageTreeNode;
  hierarchy: 'parentchild' | 'nestedpages';
  max_depth: number;
  total_pages: number;
  /** True when max_pages stopped the walk before the whole tree was read */
  truncated: boolean;
  /** Class name -> number of pages in the tree (root included) carrying at least one object of it */
  class_totals?: Record<string, number>;
  /** The root's descendants, depth-first, each page followed by its descendants (the root is in root_page) */
  pages: PageTreeNode[];
}

export interface XWikiClassObjectSummaryRaw {
  className: string;
  number: number;
  pageId?: string;
  space?: string;
  pageName?: string;
  pageVersion?: string;
  pageAuthor?: string;
  headline?: string;
}

export interface ClassObject {
  page: string;
  space: string;
  page_name: string;
  number: number;
  page_version?: string;
  page_author?: string;
  /** Value of the object's first property (XWiki's "headline") */
  headline?: string;
  /** All property values, when include_properties is on */
  properties?: Record<string, unknown>;
}

export interface AttachmentSearchResult {
  name: string;
  page: string;
  size_bytes?: number;
  mime_type?: string;
  author?: string;
  date?: string;
  version?: string;
  download_url: string;
}

export interface TagRemoveResult {
  removed: string[];
  not_found: string[];
  tags: string[];
}

export interface MovePageResult {
  from: string;
  to: string;
  children_moved: boolean;
  /** True only when every page found linking to the old reference was rewritten */
  links_updated: boolean;
  /** Pages the wiki's link index listed as linking to the page before the move */
  backlinks_found?: number;
  /** Pages that still link to the old reference after the move */
  links_not_updated?: string[];
  /** Why the links could not be checked (e.g. the search index is unavailable) */
  link_check_error?: string;
  redirect_left: boolean;
  url?: string;
  status: 'moved';
}

export interface XWikiRequiredRightsResponse {
  analysisResults?: Array<{
    entityReference?: string;
    locale?: string;
    summaryMessageHTML?: string;
    detailedMessageHTML?: string;
    requiredRights?: Array<{ right: string; entityType?: string; manualReviewNeeded?: boolean }>;
  }>;
  currentRights?: { enforce?: boolean; rights?: Array<{ right: string; scope?: string }> };
  availableRights?: Array<{
    right: string;
    scope?: string;
    displayName?: string;
    hasRight?: boolean;
    definitelyRequiredRight?: boolean;
    maybeRequiredRight?: boolean;
  }>;
}

export interface RequiredRightsReport {
  page: string;
  /** Rights the page declares, and whether XWiki enforces them */
  declared: { enforce: boolean; rights: Array<{ right: string; scope?: string }> };
  /** Rights the analysis says the content needs, with whether the current user (the MCP account) has them */
  needed: Array<{ right: string; scope?: string; definitely: boolean; current_user_has: boolean }>;
  /** What in the page needs each right (plain-text summaries) */
  findings: Array<{ entity: string; summary: string; rights: Array<{ right: string; entity_type?: string; manual_review: boolean }> }>;
}

export interface CopyPageResult {
  from: string;
  to: string;
  children_copied: boolean;
  url?: string;
  status: 'copied';
}

export interface XWikiDeletedDocumentsResponse {
  totalrows?: number;
  rows?: Array<{
    fullname: string;
    title?: string;
    restoreUrl?: string;
    canRestore?: boolean;
    alreadyExists?: boolean;
    date?: string;
    deleter?: string;
    language?: string;
    batchId?: string;
  }>;
}

export interface DeletedPage {
  /** Recycle-bin id, passed to xwiki_restore_deleted_page */
  id: number;
  page: string;
  title?: string;
  language?: string;
  deleted_by?: string;
  deleted_date?: string;
  /** Pages deleted together share a batch id */
  batch_id?: string;
  can_restore: boolean;
  /** A page exists at the reference again, so it cannot be restored there (not reported by the fallback listing) */
  page_exists_again?: boolean;
}

export interface RestorePageResult {
  page: string;
  id: number;
  url?: string;
  status: 'restored';
}

export interface ClassPropertyStateResult {
  class_name: string;
  property: string;
  enabled: boolean;
  /** Whether the class read-back showed the property's disabled flag */
  confirmed: boolean;
  status: 'enabled' | 'disabled';
}

export interface AttachmentMoveResult {
  from: string;
  to: string;
  references_updated: boolean;
  redirect_left: boolean;
  download_url: string;
  status: 'moved';
}

export interface AttachmentVersion {
  version?: string;
  size_bytes?: number;
  mime_type?: string;
  author?: string;
  date?: string;
  download_url: string;
}

export interface ClassPropertyValue {
  value: unknown;
  label?: string;
}

export interface VersionComparison {
  page: string;
  from: { version: string; author?: string; date?: string };
  to: { version: string; author?: string; date?: string };
  title_change?: { from: string; to: string };
  syntax_change?: { from: string; to: string };
  lines_added: number;
  lines_removed: number;
  /** Unified diff of the page content ("" when identical) */
  diff: string;
}

export interface XWikiDeletedDocumentsTemplateResponse {
  totalrows?: number;
  rows?: Array<{
    doc_viewable?: boolean;
    doc_fullName?: string;
    doc_name?: string;
    doc_locale?: string;
    doc_date?: string;
    doc_deleter?: string;
    doc_hasrestore?: boolean;
    doc_restore_url?: string;
  }>;
}
