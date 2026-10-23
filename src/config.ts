import { readFileSync } from 'fs';

export interface Config {
  baseUrl: string;
  authType: 'basic' | 'token' | 'none';
  username: string;
  password: string;
  token: string;
  wikiName: string;
  restPath: string;
  pageLimit: number;
  readOnly: boolean;
  allowDelete: boolean;
  /** Tools to leave unregistered (XWIKI_MCP_DISABLED_TOOLS) */
  disabledTools: string[];
  /** Bearer token required on POST /mcp in HTTP mode; empty = none */
  httpToken: string;
  /** Interface the HTTP server listens on; empty = all */
  httpHost: string;
  /** Timeout for one XWiki request, ms; long operations (writes, exports, refactoring jobs) get 4x */
  timeoutMs: number;
  /** Toolsets to register (XWIKI_MCP_TOOLSETS); empty = all */
  toolsets: string[];
  /** Origins allowed on HTTP requests that send one (XWIKI_MCP_ALLOWED_ORIGINS) */
  allowedOrigins: string[];
  /** Host header values accepted in HTTP mode (XWIKI_MCP_ALLOWED_HOSTS); empty = any */
  allowedHosts: string[];
  /** Tool calls allowed per minute, across all clients; 0 = no limit */
  rateLimit: number;
  /** Largest file returned by download / export, bytes */
  maxFileBytes: number;
  /** Log one line per tool call to stderr */
  logCalls: boolean;
}

function parseFlag(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  if (['true', '1', 'yes'].includes(raw.toLowerCase())) return true;
  if (['false', '0', 'no'].includes(raw.toLowerCase())) return false;
  throw new Error(`${name} must be true|false, got: ${raw}`);
}

/** A secret from NAME, or from the file NAME_FILE points to (Docker / Kubernetes secrets). */
function secret(name: string): string {
  const file = process.env[`${name}_FILE`];
  if (file) {
    try {
      return readFileSync(file, 'utf8').trim();
    } catch (e) {
      throw new Error(`${name}_FILE cannot be read: ${file} (${e instanceof Error ? e.message : String(e)})`);
    }
  }
  return process.env[name] ?? '';
}

function list(name: string): string[] {
  return (process.env[name] ?? '').split(',').map(t => t.trim()).filter(Boolean);
}

function int(name: string, fallback: number, min: number): number {
  const raw = process.env[name];
  const value = raw === undefined || raw === '' ? fallback : Number(raw);
  if (!Number.isInteger(value) || value < min) {
    throw new Error(`${name} must be an integer of at least ${min}, got: ${raw}`);
  }
  return value;
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

  const timeoutMs = parseInt(process.env.XWIKI_TIMEOUT_MS ?? '30000', 10);
  if (isNaN(timeoutMs) || timeoutMs < 1000) {
    throw new Error(`XWIKI_TIMEOUT_MS must be an integer of at least 1000, got: ${process.env.XWIKI_TIMEOUT_MS}`);
  }

  const disabledTools = (process.env.XWIKI_MCP_DISABLED_TOOLS ?? '').split(',').map(t => t.trim()).filter(Boolean);

  return {
    baseUrl: baseUrl.replace(/\/$/, ''),
    authType: rawAuthType as Config['authType'],
    username: process.env.XWIKI_USERNAME ?? '',
    password: secret('XWIKI_PASSWORD'),
    token: secret('XWIKI_TOKEN'),
    wikiName: process.env.XWIKI_WIKI_NAME ?? 'xwiki',
    restPath: process.env.XWIKI_REST_PATH ?? '/rest',
    pageLimit,
    readOnly: parseFlag('XWIKI_MCP_READ_ONLY', false),
    allowDelete: parseFlag('XWIKI_MCP_ALLOW_DELETE', false),
    disabledTools,
    httpToken: secret('XWIKI_MCP_HTTP_TOKEN'),
    httpHost: process.env.XWIKI_MCP_HOST ?? '',
    timeoutMs,
    toolsets: list('XWIKI_MCP_TOOLSETS'),
    allowedOrigins: list('XWIKI_MCP_ALLOWED_ORIGINS'),
    allowedHosts: list('XWIKI_MCP_ALLOWED_HOSTS').map(h => h.toLowerCase()),
    rateLimit: int('XWIKI_MCP_RATE_LIMIT', 120, 0),
    maxFileBytes: int('XWIKI_MCP_MAX_FILE_BYTES', 10 * 1024 * 1024, 1024),
    logCalls: parseFlag('XWIKI_MCP_LOG_CALLS', true),
  };
}

export const config = load();
