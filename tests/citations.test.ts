import { describe, expect, it } from 'vitest';
import { parseReferences } from '../src/bibliography';
import { findCitationGroups } from '../src/citations';
import type { ParseOptions } from '../src/types';

const options: ParseOptions = { maxReferences: 100, recognizePlainText: true, sourcePath: 'Papers/Article.md' };
const bibliography = '\n\n## References\n' + Array.from({ length: 12 }, (_, i) => `[${i + 1}] Reference ${i + 1}. ^ref-${i + 1}`).join('\n');

function find(body: string, config: Partial<ParseOptions> = {}) {
  const source = body + bibliography;
  return findCitationGroups(source, parseReferences(source), { ...options, ...config });
}

describe('findCitationGroups', () => {
  it('expands all ten items and keeps exact UTF-16 offsets', () => {
    const body = '😀 An observation [1–10] ends here.';
    const groups = find(body);
    expect(groups).toHaveLength(1);
    expect(groups[0].numbers).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(body.slice(groups[0].from, groups[0].to)).toBe('[1–10]');
    expect(groups[0].label).toBe('[1–10]');
    expect(groups[0].linked).toBe(false);
  });

  it.each(['-', '–', '—', '−', '－'])('supports the range delimiter %s', dash => {
    expect(find(`[1${dash}3]`)[0]?.numbers).toEqual([1, 2, 3]);
  });

  it('expands mixed groups in source order and deduplicates overlaps', () => {
    expect(find('[1–3, 5, 8–10]')[0].numbers).toEqual([1, 2, 3, 5, 8, 9, 10]);
    expect(find('[3–5, 4–6, 1]')[0].numbers).toEqual([3, 4, 5, 6, 1]);
    expect(find('[1，3；5、8]')[0].numbers).toEqual([1, 3, 5, 8]);
  });

  it.each([
    String.raw`\[[1](#^ref-1)–[10](#^ref-10)\]`,
    String.raw`\[[[#^ref-1|1]]–[[#^ref-10|10]]\]`,
    '[[1](#^ref-1)–[10](#^ref-10)]',
    '[ [[#^ref-1|1]]–[[#^ref-10|10]] ]',
    '[1](#^ref-1)–[10](#^ref-10)',
    '[[#^ref-1|1]]–[[#^ref-10|10]]',
    '[1–10](#^ref-1)',
    '<sup>[1–10]</sup>'
  ])('supports citation markup %s', body => {
    const groups = find(body);
    expect(groups).toHaveLength(1);
    expect(groups[0].numbers).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(groups[0].label).toBe('[1–10]');
  });

  it('supports same-file Markdown and wiki links', () => {
    expect(find(String.raw`\[[1](Article.md#^ref-1)–[3](Article.md#^ref-3)\]`)[0].numbers).toEqual([1, 2, 3]);
    expect(find(String.raw`\[[[Papers/Article#^ref-1|1]]–[[Papers/Article#^ref-3|3]]\]`)[0].numbers).toEqual([1, 2, 3]);
    expect(find(String.raw`\[[1](./Article.md#%5Eref-1)–[3](./Article.md#%5Eref-3)\]`)[0].numbers).toEqual([1, 2, 3]);
  });

  it.each([
    { body: String.raw`\[[1](<#^ref-1>)\]`, numbers: [1] },
    { body: String.raw`\[[1](<#^ref-1>), [3](<#^ref-3>), [5](<#^ref-5>)\]`, numbers: [1, 3, 5] },
    { body: String.raw`\[[1](<#^ref-1>)-[10](<#^ref-10>)\]`, numbers: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] },
    { body: String.raw`\[[1](<#^ref-1> "First reference")–[3](<#^ref-3> 'Third reference')\]`, numbers: [1, 2, 3] }
  ])('preserves angle-bracket destinations in $body', ({ body, numbers }) => {
    const groups = find(body, { recognizePlainText: false });
    expect(groups).toHaveLength(1);
    expect(groups[0].numbers).toEqual(numbers);
    expect(groups[0].linked).toBe(true);
    expect(body.slice(groups[0].from, groups[0].to)).toBe(body);
  });

  it('supports angle-bracket destinations containing the same note path with spaces', () => {
    const body = String.raw`\[[1](<Papers/Article with spaces.md#^ref-1>), [3](<Papers/Article with spaces.md#^ref-3>)\]`;
    const groups = find(body, { sourcePath: 'Papers/Article with spaces.md', recognizePlainText: false });
    expect(groups).toHaveLength(1);
    expect(groups[0].numbers).toEqual([1, 3]);
  });

  it('still masks HTML attributes and code containers next to angle-bracket links', () => {
    const body = String.raw`<span title="[1] [1,3,5] [1-10]">No citation here</span><code>\[[1](<#^ref-1>)\]</code> Valid \[[3](<#^ref-3>)\].`;
    const groups = find(body);
    expect(groups).toHaveLength(1);
    expect(groups[0].numbers).toEqual([3]);
    expect(body.slice(groups[0].from, groups[0].to)).toBe(String.raw`\[[3](<#^ref-3>)\]`);
    expect(find(String.raw`\[[1](<Other.md#^ref-1>)–[10](<#^ref-10>)\]`)).toEqual([]);
  });

  it('retains linked ranges when plain-number recognition is disabled', () => {
    const body = String.raw`Plain [1–10]; linked \[[1](#^ref-1)–[10](#^ref-10)\].`;
    const groups = find(body, { recognizePlainText: false });
    expect(groups).toHaveLength(1);
    expect(groups[0].linked).toBe(true);
  });

  it.each([
    String.raw`\[[1](#^ref-1)–[10](Other.md#^ref-10)\]`,
    String.raw`\[[[Other#^ref-1|1]]–[[Other#^ref-10|10]]\]`,
    '[1](#^ref-1)–[10](Other.md#^ref-10)',
    '[1–10](https://example.org)',
    '[1–10](Other.md#^ref-1)',
    String.raw`\[[1](#fig-1)–[10](#fig-10)\]`,
    String.raw`\[[1](#^ref-10)–[10](#^ref-1)\]`
  ])('does not merge non-reference or cross-file links: %s', body => {
    expect(find(body)).toEqual([]);
  });

  it('keeps separate local references instead of combining their bibliography indices', () => {
    const first = '[1–3]\n\n## References\n[1] A.\n[2] B.\n[3] C.';
    const second = '[1–3]\n\n## References\n[1] X.\n[2] Y.\n[3] Z.';
    const a = parseReferences(first);
    const b = parseReferences(second);
    expect(findCitationGroups(first, a, options)[0].numbers).toEqual([1, 2, 3]);
    expect(findCitationGroups(second, b, options)[0].numbers).toEqual([1, 2, 3]);
    expect(a.entries.get(1)?.markdown).toBe('A.');
    expect(b.entries.get(1)?.markdown).toBe('X.');
  });

  it('keeps missing intermediate entries so the UI can report them', () => {
    const source = '[1–10]\n\n## References\n[1] First.\n[10] Tenth.';
    expect(findCitationGroups(source, parseReferences(source), options)[0].numbers).toHaveLength(10);
  });

  it('keeps ambiguous entries so the UI can report them', () => {
    const source = '[1–2]\n\n## References\n[1] A.\n[1] Ambiguous.\n[2] B.';
    const index = parseReferences(source);
    expect(index.duplicates.has(1)).toBe(true);
    expect(findCitationGroups(source, index, options)[0].numbers).toEqual([1, 2]);
  });

  it('requires some reference evidence for plain numbers', () => {
    expect(find('[100–105]')).toEqual([]);
    expect(findCitationGroups('A range [1–10].', parseReferences('A range [1–10].'), options)).toEqual([]);
  });

  it.each(['[3–1]', '[0–3]', '[1–2–3]', '[1,]', '[-1–3]', '[1.5–3]', '[1–100000000]', '[999999999999–9999999999999]'])('rejects malformed or unsafe range %s', body => {
    expect(find(body)).toEqual([]);
  });

  it('enforces the reference cap without partial results', () => {
    expect(find('[1–10]', { maxReferences: 9 })).toEqual([]);
    expect(find('[1,2,3]', { maxReferences: 2 })).toEqual([]);
    expect(find('[1–3,2–4]', { maxReferences: 4 })[0].numbers).toEqual([1, 2, 3, 4]);
    expect(find('[1]', { maxReferences: Number.NaN })).toEqual([]);
  });

  it('ignores code, math, comments, HTML attributes and image alt text', () => {
    const body = '---\nrange: "[1–10]"\n---\n`[1–10]`\n```md\n[1–10]\n```\n    [1–10]\n$x[1–10]$\n$$\n[1–10]\n$$\n<!-- [1–10] -->\n%% [1–10] %%\n<span title="[1–10]">text</span>\n<code>[1–10]</code>\n![1–10](image.png)\nVisible [1–10].';
    const groups = find(body);
    expect(groups).toHaveLength(1);
    expect(body.slice(groups[0].from, groups[0].to)).toBe('[1–10]');
    expect(groups[0].from).toBe(body.lastIndexOf('[1–10]'));
  });

  it('does not treat a linked image destination or reference-style link as an in-text citation', () => {
    expect(find('[1–10][other]\n[other]: https://example.org')).toEqual([]);
    expect(find('![1–10](image.png "[1–10]")')).toEqual([]);
    expect(find('[1]: https://example.org "[1–10]"')).toEqual([]);
  });

  it('bounds malformed wiki-link lookahead', () => {
    expect(find('['.repeat(10_000))).toEqual([]);
  });

  it('skips large unclosed bracket and image lines without losing later citations', () => {
    const malformed = '[['.repeat(100_000) + '\n' + '!['.repeat(100_000);
    const body = malformed + '\nAfter malformed text [1–3].';
    const groups = find(body);
    expect(groups).toHaveLength(1);
    expect(groups[0].numbers).toEqual([1, 2, 3]);
    expect(groups[0].from).toBe(body.lastIndexOf('[1–3]'));
    expect(body.slice(groups[0].from, groups[0].to)).toBe('[1–3]');
  }, 10_000);

  it('does not truncate a valid citation group with long, bounded link destinations', () => {
    const notePath = 'Papers/' + 'a'.repeat(900) + '.md';
    const body = String.raw`\[[1](${notePath}#^ref-1)–[10](${notePath}#^ref-10)\]`;
    const groups = find(body, { sourcePath: notePath });
    expect(groups).toHaveLength(1);
    expect(groups[0].numbers).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(body.slice(groups[0].from, groups[0].to)).toBe(body);
  });

  it('finds multiple groups independently', () => {
    expect(find('A [1–3], B [5,8–10].').map(group => group.numbers)).toEqual([[1, 2, 3], [5, 8, 9, 10]]);
  });

  it('never parses the bibliography itself as citations', () => {
    expect(find('No body citations.')).toEqual([]);
  });
});
