// Heading outline of raw page content, for xwiki_get_page's outline and section reads.

export interface Heading {
  /** 1-based position in the outline; xwiki_get_page's section takes it. */
  n: number;
  level: number;
  title: string;
  /** 1-based line of the heading. */
  line: number;
  /** Last line of the section: up to the next heading of the same or a higher level. */
  end_line: number;
  /** Characters in the section, its subsections included. */
  chars: number;
}

export interface Section {
  heading: Heading;
  content: string;
}

// xwiki/2.x: "== Title ==" (closing equals optional), after optional (% params %).
const XWIKI_HEADING = /^\s*(?:\(%.*?%\)\s*)?(={1,6})(?!=)\s*(.*?)\s*=*\s*$/;
// Markdown ATX: "## Title", closing hashes optional.
const MD_HEADING = /^ {0,3}(#{1,6})(?:\s+(.*?))?\s*#*\s*$/;

/**
 * Which lines are code, not markup: inside or opening/closing an xwiki {{code}}…{{/code}} or
 * {{{…}}} block, or a Markdown ``` / ~~~ fence. A block opened and closed on one line is not.
 */
export function codeLines(lines: string[], markdown: boolean): boolean[] {
  let fence: string | null = null;
  return lines.map(raw => {
    const line = raw.replace(/\r$/, '');
    if (markdown) {
      const f = /^ {0,3}(`{3,}|~{3,})/.exec(line);
      if (f) {
        if (!fence) fence = f[1][0].repeat(3);
        else if (line.trim().startsWith(fence)) fence = null;
        return true;
      }
      return fence !== null;
    }
    if (fence === '{{{') {
      if (line.includes('}}}')) fence = null;
      return true;
    }
    if (fence === 'code') {
      if (/\{\{\/code\}\}/.test(line)) fence = null;
      return true;
    }
    if (/\{\{code\b[^}]*\}\}/.test(line) && !/\{\{\/code\}\}/.test(line)) { fence = 'code'; return true; }
    if (line.includes('{{{') && !line.slice(line.indexOf('{{{') + 3).includes('}}}')) { fence = '{{{'; return true; }
    return false;
  });
}

/**
 * Headings in content, skipping lines inside code blocks (xwiki {{code}}…{{/code}} and {{{…}}},
 * Markdown ``` / ~~~ fences). Syntax is the page's syntax id (e.g. "xwiki/2.1", "markdown/1.2").
 */
export function outline(content: string, syntax = 'xwiki/2.1'): Heading[] {
  const markdown = syntax.startsWith('markdown');
  const lines = content.split('\n');
  const starts: number[] = [];
  let pos = 0;
  for (const l of lines) {
    starts.push(pos);
    pos += l.length + 1;
  }

  const code = codeLines(lines, markdown);
  const found: Array<{ level: number; title: string; index: number }> = [];
  lines.forEach((raw, i) => {
    if (code[i]) return;
    const m = (markdown ? MD_HEADING : XWIKI_HEADING).exec(raw.replace(/\r$/, ''));
    if (m && m[2]?.trim()) found.push({ level: m[1].length, title: m[2].trim(), index: i });
  });

  return found.map((h, k) => {
    const next = found.slice(k + 1).find(o => o.level <= h.level);
    const endIndex = next ? next.index - 1 : lines.length - 1;
    // Up to the line break before the next heading, so chars is the section's own length.
    const endPos = next ? starts[next.index] - 1 : content.length;
    return { n: k + 1, level: h.level, title: h.title, line: h.index + 1, end_line: endIndex + 1, chars: endPos - starts[h.index] };
  });
}

/** Content of section n of the outline (heading line included), or undefined if there is none. */
export function section(content: string, syntax: string | undefined, n: number): Section | undefined {
  const heading = outline(content, syntax).find(h => h.n === n);
  if (!heading) return undefined;
  const lines = content.split('\n');
  return { heading, content: lines.slice(heading.line - 1, heading.end_line).join('\n') };
}
