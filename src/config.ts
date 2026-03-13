export interface Config {
  baseUrl: string;
  authType: 'basic' | 'token' | 'none';
  username: string;
  password: string;
  token: string;
  wikiName: string;
  restPath: string;
  pageLimit: number;
}

function load(): Config {
  const baseUrl = process.env.XWIKI_BASE_URL;
  if (!baseUrl) {
    throw new Error('XWIKI_BASE_URL environment variable is required');
  }

  const rawAuthType = process.env.XWIKI_AUTH_TYPE ?? 'basic';
  if (!['basic', 'token', 'none'].includes(rawAuthType)) {
    throw new Error(`XWIKI_AUTH_TYPE must be basic|token|none, got: ${rawAuthType}`);
  }

  const pageLimit = parseInt(process.env.XWIKI_PAGE_LIMIT ?? '50', 10);
  if (isNaN(pageLimit) || pageLimit < 1) {
    throw new Error(`XWIKI_PAGE_LIMIT must be a positive integer, got: ${process.env.XWIKI_PAGE_LIMIT}`);
  }

  return {
    baseUrl: baseUrl.replace(/\/$/, ''),
    authType: rawAuthType as Config['authType'],
    username: process.env.XWIKI_USERNAME ?? '',
    password: process.env.XWIKI_PASSWORD ?? '',
    token: process.env.XWIKI_TOKEN ?? '',
    wikiName: process.env.XWIKI_WIKI_NAME ?? 'xwiki',
    restPath: process.env.XWIKI_REST_PATH ?? '/rest',
    pageLimit,
  };
}

export const config = load();
