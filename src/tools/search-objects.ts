import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/server';
import { XWikiError } from '../client.js';
import type { XWikiClient } from '../client.js';
import type { SkippedObject } from '../types.js';

const MAX_PATTERN = 500;
const MAX_COUNT = 1000;
const SNIPPET = 160;
const SNIPPET_BEFORE = 50;

export interface ObjectMatch {
  page: string;
  number: number;
  field: string;
  /** Matches in the value (counting stops at 1000) */
  count: number;
  snippet?: string;
}

/** A global RegExp for the pattern: escaped for "contains", as written for "regex". Throws on an invalid regex. */
export function patternRegExp(pattern: string, mode: 'contains' | 'regex', ignoreCase: boolean): RegExp {
  const source = mode === 'contains' ? pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') : pattern;
  return new RegExp(source, ignoreCase ? 'gi' : 'g');
}

/** Count matches of re in text (up to MAX_COUNT) and return the first one's index. */
export function findMatches(re: RegExp, text: string): { count: number; index: number } | undefined {
  re.lastIndex = 0;
  let count = 0;
  let index = -1;
  for (const m of text.matchAll(re)) {
    if (count === 0) {
      index = m.index;
    }
    if (++count >= MAX_COUNT) break;
  }
  return count === 0 ? undefined : { count, index };
}

/** Up to SNIPPET characters of text around a match, with … where it was cut. */
export function snippetAround(text: string, index: number): string {
  const from = Math.max(0, Math.min(index - SNIPPET_BEFORE, text.length - SNIPPET));
  const to = Math.min(text.length, from + SNIPPET);
  return `${from > 0 ? '…' : ''}${text.slice(from, to)}${to < text.length ? '…' : ''}`;
}

/** The values to search: the named fields (any value as text), or every string-valued property. */
function searchable(properties: Record<string, unknown>, fields?: string[]): Array<[string, string]> {
  if (!fields) return Object.entries(properties).filter((e): e is [string, string] => typeof e[1] === 'string');
  const out: Array<[string, string]> = [];
  for (const f of fields) {
    const v = properties[f];
    if (v === undefined || v === null) continue;
    out.push([f, typeof v === 'string' ? v : Array.isArray(v) ? v.join('|') : String(v)]);
  }
  return out;
}

export function register(server: McpServer, client: XWikiClient): void {
  server.registerTool(
    'xwiki_search_objects',
    {
      description: `Find the objects of one class whose property values contain a string or match a regular expression, returning only the matches.

Use it for exact matches that full-text search cannot give: Solr search is tokenized (searching for "{{code" finds every page with the word "code"), and recent XWiki versions refuse XWQL / HQL on the REST query endpoint. The server reads the class's objects in full, a batch at a time, and returns for each match the page, object number, field, match count and a short snippet, never the whole value.

A call scans at most scan_limit objects from start (default 0, 500) and stops early once max_results matches are found. Continue from next_start while has_more is true. Objects that fail to load are listed in skipped instead of failing the call.`,
      inputSchema: z.object({
        class_name: z.string().describe('Full class name (e.g. "Sandbox.Code.ExampleClass", "XWiki.StyleSheetExtension")'),
        pattern: z.string().min(1).max(MAX_PATTERN).describe(`Text to find, or a JavaScript regular expression with mode "regex" (at most ${MAX_PATTERN} characters)`),
        mode: z.enum(['contains', 'regex']).default('contains').describe('contains (default): literal substring; regex: JavaScript regular expression'),
        ignore_case: z.boolean().default(false).describe('Match regardless of case (default false)'),
        fields: z
          .array(z.string().min(1))
          .min(1)
          .optional()
          .describe('Property names to search (default: every string-valued property)'),
        include_snippet: z.boolean().default(true).describe('Return a short snippet around the first match in each field (default true)'),
        max_results: z.number().int().min(1).max(1000).default(100).describe('Stop after this many matches, one per object field (default 100)'),
        start: z.number().int().min(0).default(0).describe('Position in the class\'s object list to start scanning from (default 0); pass next_start to continue'),
        scan_limit: z.number().int().min(1).max(2000).default(500).describe('Objects to scan in this call at most (default 500)'),
      }),
    },
    async ({ class_name, pattern, mode, ignore_case, fields, include_snippet, max_results, start, scan_limit }) => {
      let re: RegExp;
      try {
        re = patternRegExp(pattern, mode, ignore_case);
      } catch (e) {
        return { content: [{ type: 'text', text: `Invalid regex: ${e instanceof Error ? e.message : String(e)}` }], isError: true };
      }
      const matches: ObjectMatch[] = [];
      const skipped: SkippedObject[] = [];
      let objectsRead = 0;
      let objectsMatched = 0;
      let next = start;
      let exhausted = false;
      try {
        scan: for await (const batch of client.scanClassObjects(class_name, start, scan_limit)) {
          skipped.push(...batch.skipped);
          for (const { position, object } of batch.objects) {
            objectsRead++;
            let matched = false;
            for (const [field, value] of searchable(object.properties ?? {}, fields)) {
              const m = findMatches(re, value);
              if (!m) continue;
              matched = true;
              matches.push({
                page: object.page,
                number: object.number,
                field,
                count: m.count,
                ...(include_snippet ? { snippet: snippetAround(value, m.index) } : {}),
              });
            }
            if (matched) objectsMatched++;
            if (matches.length >= max_results) {
              next = position + 1;
              break scan;
            }
          }
          next = batch.end;
          exhausted = batch.exhausted;
        }
      } catch (e) {
        const msg =
          e instanceof XWikiError && e.status === 404 ? `Class not found: ${class_name}` : e instanceof Error ? e.message : String(e);
        return { content: [{ type: 'text', text: msg }], isError: true };
      }
      const has_more = !exhausted;
      const result = {
        class_name,
        mode,
        pattern,
        match_count: matches.length,
        objects_matched: objectsMatched,
        matches,
        objects_read: objectsRead,
        ...(skipped.length > 0 ? { skipped: skipped.sort((a, b) => (a.position ?? 0) - (b.position ?? 0) || (a.page ?? '').localeCompare(b.page ?? '') || (a.number ?? 0) - (b.number ?? 0)) } : {}),
        scanned: { start, end: next },
        ...(has_more ? { next_start: next } : {}),
        has_more,
      };
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    },
  );
}
