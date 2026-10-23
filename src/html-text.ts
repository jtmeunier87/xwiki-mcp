// Readable plain text from rendered page HTML, for xwiki_render_page's plain output.

const ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  hellip: '…', middot: '·', mdash: '—', ndash: '–', rarr: '→', larr: '←', copy: '©', reg: '®',
};

// Elements that start a new line of text
const BLOCK = 'p|div|section|article|header|footer|nav|aside|main|ul|ol|dl|dt|dd|h[1-6]|tr|table|thead|tbody|pre|blockquote|details|summary|figure|figcaption|form|fieldset|option';

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

/** Strip tags, scripts and styles; keep one line per block element and "- " for list items. */
export function htmlToText(html: string): string {
  const text = html
    .replace(/<(script|style|template)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<li\b[^>]*>/gi, '\n- ')
    .replace(new RegExp(`</?(?:${BLOCK})\\b[^>]*>`, 'gi'), '\n')
    .replace(/<\/t[dh]>/gi, ' ')
    .replace(/<[^>]+>/g, '');
  const lines = decodeEntities(text)
    .split('\n')
    .map(l => l.replace(/[ \t ]+/g, ' ').trim());
  // One line per block, no empty lines; a bare "-" (list item whose text starts on a later
  // line) joins the next text line.
  const out: string[] = [];
  for (const l of lines) {
    if (l === '') continue;
    if (out[out.length - 1] === '-') out[out.length - 1] = `- ${l}`;
    else out.push(l);
  }
  return out.join('\n');
}
