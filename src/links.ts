// Outgoing links in raw page content, for xwiki_get_links.
import { codeLines } from './outline.js';

export interface OutgoingLink {
  /** Link target as written, without its type prefix (e.g. "Docs.Guides.Setup", "https://example.com") */
  reference: string;
  /** doc, page, space, attach, url, mailto, image, include, ... ("untyped" when no prefix is written) */
  type: string;
  /** 1-based line in the text the link was found in */
  line: number;
}

// [[image:target||params]], read first: an image can be a link's label.
const XWIKI_IMAGE = /(?<!~)\[\[image:((?:(?!\]\]).)*?)\]\]/gi;
// [[label>>target||params]] and [[target]]: the target is after the last ">>" before "||".
const XWIKI_LINK = /(?<!~)\[\[((?:(?!\]\]).)*?)\]\]/g;
// {{include reference="..."/}} and {{display reference="..."/}}
const XWIKI_MACRO = /\{\{(include|display)\b[^}]*?\breference="([^"]*)"/g;
// [label](target) and ![alt](target)
const MD_LINK = /(!?)\[[^\]]*\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g;
const TYPED = /^([a-zA-Z]+):(?!\/\/)(.*)$/;
// Code spans within one line: {{code}}…{{/code}} and {{{…}}}, or Markdown `…`.
const XWIKI_INLINE_CODE = /\{\{code\b[^}]*\}\}.*?\{\{\/code\}\}|\{\{\{.*?\}\}\}/g;
const MD_INLINE_CODE = /(`+).*?\1/g;

/** Links written in content, outside code blocks; syntax is the page's syntax id. */
export function outgoingLinks(content: string, syntax = 'xwiki/2.1'): OutgoingLink[] {
  const markdown = syntax.startsWith('markdown');
  const lines = content.split('\n');
  const code = codeLines(lines, markdown);
  const links: OutgoingLink[] = [];
  lines.forEach((raw, i) => {
    if (code[i]) return;
    const text = raw.replace(markdown ? MD_INLINE_CODE : XWIKI_INLINE_CODE, '');
    const line = i + 1;
    if (markdown) {
      for (const m of text.matchAll(MD_LINK)) {
        const target = m[2];
        const type = m[1] ? 'image' : /^[a-z][a-z0-9+.-]*:\/\//i.test(target) ? 'url' : /^mailto:/i.test(target) ? 'mailto' : 'untyped';
        links.push({ reference: type === 'mailto' ? target.slice(7) : target, type, line });
      }
      return;
    }
    for (const m of text.matchAll(XWIKI_IMAGE)) links.push({ reference: m[1].split('||')[0].trim(), type: 'image', line });
    for (const m of text.replace(XWIKI_IMAGE, '').matchAll(XWIKI_LINK)) {
      const target = m[1].split('||')[0].split('>>').pop()!.trim();
      if (!target) continue;
      const typed = TYPED.exec(target);
      if (typed) links.push({ reference: typed[2], type: typed[1].toLowerCase(), line });
      else links.push({ reference: target, type: /^[a-z][a-z0-9+.-]*:\/\//i.test(target) ? 'url' : 'untyped', line });
    }
    for (const m of text.matchAll(XWIKI_MACRO)) links.push({ reference: m[2], type: m[1], line });
  });
  return links;
}
