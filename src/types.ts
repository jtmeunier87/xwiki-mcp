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

export interface Pagination {
  total?: number;
  start: number;
  limit: number;
  has_more: boolean;
}
