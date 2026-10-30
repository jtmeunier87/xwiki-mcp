import { describe, it, expect } from 'vitest';
import { outline, section } from './outline.js';

describe('outline', () => {
  const page = [
    '= Intro =', // 1
    'text',
    '== Setup', // 3: closing equals are optional
    '{{code}}', // 4
    '= not a heading =',
    '{{/code}}',
    '(% class="x" %) == Usage ==', // 7
    '{{{',
    '== verbatim ==',
    '}}}',
    '= Notes =', // 11
    'end',
  ].join('\n');

  it('lists xwiki headings with their line ranges, skipping code blocks', () => {
    expect(outline(page).map(h => [h.n, h.level, h.title, h.line, h.end_line])).toEqual([
      [1, 1, 'Intro', 1, 10],
      [2, 2, 'Setup', 3, 6],
      [3, 2, 'Usage', 7, 10],
      [4, 1, 'Notes', 11, 12],
    ]);
  });

  it('gives each section its size and content, subsections included', () => {
    const s = section(page, 'xwiki/2.1', 2)!;
    expect(s.content).toBe('== Setup\n{{code}}\n= not a heading =\n{{/code}}');
    expect(s.heading.chars).toBe(s.content.length);
    expect(section(page, 'xwiki/2.1', 4)!.content).toBe('= Notes =\nend');
    expect(section(page, 'xwiki/2.1', 9)).toBeUndefined();
  });

  it('reads Markdown headings outside fences', () => {
    const md = '# Title\n```\n# comment\n```\n## Part ##\n#nospace';
    expect(outline(md, 'markdown/1.2').map(h => [h.level, h.title, h.line])).toEqual([[1, 'Title', 1], [2, 'Part', 5]]);
  });
});
