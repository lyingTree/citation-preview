import { describe, expect, it } from 'vitest';
import { ignoredMarkdownRanges, parseReferences } from '../src/bibliography';

describe('parseReferences', () => {
  it('indexes multiline references and preserves source offsets and block IDs', () => {
    const source = '😀 Intro [1–2].\r\n\r\n## 参考文献\r\n\r\n1. Smith. First title.\r\n   Journal, 2024. ^ref-1\r\n\r\n2. Lee. Second title. ^ref-2\r\n\r\n## Appendix\r\n1. Not a reference.\r\n';
    const index = parseReferences(source);
    expect([...index.entries.keys()]).toEqual([1, 2]);
    expect(index.entries.get(1)).toMatchObject({ number: 1, markdown: 'Smith. First title.\r\nJournal, 2024.', line: 4, anchor: '^ref-1' });
    const entry = index.entries.get(2)!;
    expect(source.slice(entry.from, entry.to)).toBe('2. Lee. Second title. ^ref-2');
    expect(source.slice(index.sections[0].from, index.sections[0].to)).not.toContain('Appendix');
  });

  it.each(['References', 'REFERENCES', 'Bibliography', 'Literature cited', 'Works cited', '参考文献', '參考文獻', '6. References', '6.2 References', '**参考文献**'])('recognizes the bibliography heading %s', title => {
    const index = parseReferences(`## ${title}\n[1] First reference.\n[2] Second reference.`);
    expect(index.entries.size).toBe(2);
  });

  it('recognizes setext and plain bibliography headings', () => {
    expect(parseReferences('References\n----------\n\n[1] First.').entries.get(1)?.markdown).toBe('First.');
    expect(parseReferences('参考文献：\n1) First.').entries.get(1)?.markdown).toBe('First.');
  });

  it.each(['[1]', '［1］', '【1】', '(1)', '（1）', '1.', '1)', '1、', '1．'])('recognizes entry numbering %s', marker => {
    expect(parseReferences(`## References\n${marker} First reference.`).entries.get(1)?.markdown).toBe('First reference.');
  });

  it('supports number headings and title headings', () => {
    const index = parseReferences('## References\n### 1\nFirst paper.\n\n### [2] Second paper\nPublished in Journal.\n\n## Appendix\nAnother section.');
    expect(index.entries.get(1)).toMatchObject({ markdown: 'First paper.', anchor: '1' });
    expect(index.entries.get(2)).toMatchObject({ markdown: 'Second paper\nPublished in Journal.', anchor: '[2] Second paper' });
  });

  it('assigns separate leading HTML anchors to the following reference', () => {
    const source = '## References\n<a id="ref-1"></a>\n[1] First.\n<a name="ref-2"></a>\n[2] Second.\n[3] Third.';
    const index = parseReferences(source);
    expect(index.entries.get(1)).toMatchObject({ markdown: 'First.', anchor: 'ref-1' });
    expect(index.entries.get(2)).toMatchObject({ markdown: 'Second.', anchor: 'ref-2' });
    expect(index.entries.get(3)).toMatchObject({ markdown: 'Third.', anchor: undefined });
    expect(source.slice(index.entries.get(2)!.from, index.entries.get(2)!.to)).toBe('<a name="ref-2"></a>\n[2] Second.');
  });

  it('recognizes inline HTML anchors while preserving real hyperlinks', () => {
    const index = parseReferences('## References\n<a id="ref-1"></a> [1] First. [DOI](https://doi.org/10/example).\n[2] <a href="https://example.org">Second</a>. ^ref-2');
    expect(index.entries.get(1)).toMatchObject({ markdown: 'First. [DOI](https://doi.org/10/example).', anchor: 'ref-1' });
    expect(index.entries.get(2)?.markdown).toBe('<a href="https://example.org">Second</a>.');
  });

  it('marks repeated numbers as ambiguous rather than selecting one', () => {
    const index = parseReferences('## References\n[1] First.\n[1] Duplicate.\n[2] Second.\n[1] Another duplicate.');
    expect([...index.duplicates]).toEqual([1]);
    expect(index.entries.has(1)).toBe(false);
    expect(index.entries.get(2)?.markdown).toBe('Second.');
  });

  it('does not invent a bibliography from numbered body paragraphs', () => {
    expect(parseReferences('1. Introduction.\n2. Methods.\nA result [1–2].').entries.size).toBe(0);
  });

  it('ignores bibliography-looking source in YAML, code and comments', () => {
    const source = '---\nvalue: |\n  ## References\n  [1] Frontmatter.\n---\n```md\n## References\n[1] Code.\n```\n<!--\n## References\n[1] Comment.\n-->\n%%\n## References\n[1] Obsidian comment.\n%%\n## References\n[2] Actual.';
    expect([...parseReferences(source).entries.keys()]).toEqual([2]);
  });

  it('ends an unterminated code fence at EOF', () => {
    expect(parseReferences('```md\n## References\n[1] Code.').entries.size).toBe(0);
  });

  it('ignores bibliography headings inside raw code and script containers', () => {
    const source = '<pre>\n## References\n[1] Code.\n</pre>\n<script>\n## References\n[2] Script.\n</script>\n## References\n[3] Actual.';
    expect([...parseReferences(source).entries.keys()]).toEqual([3]);
  });

  it('detects duplicate IDs across multiple bibliography sections', () => {
    const index = parseReferences('## References\n[1] First.\n## Body\ntext\n## Bibliography\n[1] Conflicting first.\n[2] Second.');
    expect(index.sections).toHaveLength(2);
    expect(index.duplicates.has(1)).toBe(true);
  });
});

describe('ignoredMarkdownRanges', () => {
  it('masks exact inline-code runs, math, comments and indented code', () => {
    const source = 'Before `a [1]` then ``b ` [2]`` and $x[3]$\n$$\n[4]\n$$\n    [5]\nAfter [6].';
    const ranges = ignoredMarkdownRanges(source);
    const strings = ranges.map(range => source.slice(range.from, range.to));
    expect(strings.some(text => text.includes('[1]'))).toBe(true);
    expect(strings.some(text => text.includes('[2]'))).toBe(true);
    expect(strings.some(text => text.includes('[3]'))).toBe(true);
    expect(strings.some(text => text.includes('[4]'))).toBe(true);
    expect(strings.some(text => text.includes('[5]'))).toBe(true);
    expect(strings.some(text => text.includes('[6]'))).toBe(false);
  });
});
