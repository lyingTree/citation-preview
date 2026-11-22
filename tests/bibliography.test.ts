import { describe, expect, it } from 'vitest';
import { ignoredMarkdownRanges, parseReferences } from '../src/bibliography';

describe('parseReferences', () => {
  it('indexes multiline anchored references without headings and preserves exact source offsets', () => {
    const source = '😀 Intro [1–2].\r\n\r\n1. Smith. First title.\r\n   Journal, 2024. ^ref-1\r\n\r\n2. Lee. Second title. ^ref-2\r\n\r\nBody after references.';
    const index = parseReferences(source);
    expect([...index.entries.keys()]).toEqual([1, 2]);
    expect(index.entries.get(1)).toMatchObject({ number: 1, markdown: 'Smith. First title.\r\nJournal, 2024.', line: 2, anchor: '^ref-1', sectionId: 'ref' });
    const entry = index.entries.get(2)!;
    expect(source.slice(entry.from, entry.to)).toBe('2. Lee. Second title. ^ref-2');
    expect(index.referenceRanges).toHaveLength(2);
  });

  it.each(['', '## References\n', '## 6 参考文献（66条）\n', '### Unrelated heading\n', 'Some arbitrary prose.\n\n'])('does not depend on the text or presence of a heading: %s', heading => {
    const index = parseReferences(`${heading}1. First. ^ref-1\n2. Second. ^ref-2`);
    expect([...index.entries.keys()]).toEqual([1, 2]);
    expect(index.sections[0]).toMatchObject({ id: 'ref', title: 'ref' });
  });

  it.each(['## References', '## 参考文献', 'References\n----------', '### 7.7 补充参考文献（30条）'])('does not invent references from unanchored lists even under %s', heading => {
    const index = parseReferences(`${heading}\n1. First.\n2. Second.`);
    expect(index.entries.size).toBe(0);
    expect(index.sections).toEqual([]);
    expect(index.referenceRanges).toEqual([]);
  });

  it.each(['[1]', '［1］', '【1】', '(1)', '（1）', '1.', '1)', '1、', '1．', '-'])('strips the optional reference label %s', marker => {
    expect(parseReferences(`${marker} First reference. ^ref-1`).entries.get(1)?.markdown).toBe('First reference.');
  });

  it('accepts unnumbered paragraphs and uses the anchor number rather than a display label', () => {
    expect(parseReferences('An unnumbered reference. ^ref-12').entries.get(12)?.markdown).toBe('An unnumbered reference.');
    const index = parseReferences('99. First reference. ^ref-1');
    expect([...index.entries.keys()]).toEqual([1]);
    expect(index.entries.get(1)?.markdown).toBe('First reference.');
  });

  it.each([
    ['ref1', 'ref'], ['ref-1', 'ref'], ['sref1', 'sref'], ['sref-1', 'sref'],
    ['REF-1', 'ref'], ['Sref-a-1', 'sref-a'], ['ref-appendix-1', 'ref-appendix'], ['ref-appendix-a2-1', 'ref-appendix-a2']
  ])('uses the exact anchor %s and stable namespace %s', (anchor, namespace) => {
    const index = parseReferences(`First reference. ^${anchor}`);
    expect(index.anchors.get(`^${anchor}`)).toMatchObject({ number: 1, sectionId: namespace });
    expect(index.sections[0].id).toBe(namespace);
  });

  it.each(['fig-1', 'tbl-1', 'eq-1', 'reference-1', 'ref-0', 'sref-0', 'ref-1-2', 'ref-anything', 'some-id'])('does not infer a bibliography from a non-reference anchor %s', anchor => {
    expect(parseReferences(`1. Content. ^${anchor}`).entries.size).toBe(0);
  });

  it('does not index mere citation destinations or HTML IDs as reference definitions', () => {
    const source = 'Links [1](#^ref-1), [[#^sref-1|1]].\n<a id="ref-1"></a>\n1. Unanchored text.';
    expect(parseReferences(source).anchors.size).toBe(0);
  });

  it('aggregates interleaved main and supplementary definitions by anchor namespace', () => {
    const source = [
      '## Arbitrary', '1. Main first. ^ref-1', '1. Supplementary first. ^sref-1',
      '## Arbitrary', 'Body [1–2].', '', '2. Main second. ^ref-2',
      '### Something else', '2. Supplementary second. ^sref-2'
    ].join('\n');
    const index = parseReferences(source);
    expect(index.sections.map(section => [section.id, [...section.entries.keys()]])).toEqual([['ref', [1, 2]], ['sref', [1, 2]]]);
    expect(index.sections.map(section => [...section.duplicates])).toEqual([[], []]);
    expect([...index.duplicates]).toEqual([1, 2]);
    expect(index.anchors.size).toBe(4);
    expect(index.anchors.get('^sref-2')?.markdown).toBe('Supplementary second.');
    expect(index.referenceRanges.every(range => !source.slice(range.from, range.to).includes('Body [1–2]'))).toBe(true);
  });

  it('keeps duplicate number and duplicate anchor ambiguity within the correct namespace', () => {
    const source = '1. First. ^ref1\n1. Another first. ^ref-1\n2. Second. ^ref-2\n1. Supplementary. ^sref-1';
    const index = parseReferences(source);
    expect(index.sections[0].entries.has(1)).toBe(false);
    expect(index.sections[0].duplicates.has(1)).toBe(true);
    expect(index.sections[1].entries.get(1)?.markdown).toBe('Supplementary.');
    expect(index.anchors.get('^ref1')?.markdown).toBe('First.');
    expect(index.anchors.get('^ref-1')?.markdown).toBe('Another first.');
    expect(index.referenceRanges).toHaveLength(4);
  });

  it('never chooses an arbitrary entry when its actual anchor is repeated', () => {
    const index = parseReferences('1. First. ^ref-1\n2. Second. ^ref-2\n1. Conflicting. ^ref-1\n1. Also conflicting. ^ref-1');
    expect(index.anchors.has('^ref-1')).toBe(false);
    expect([...index.duplicateAnchors]).toEqual(['^ref-1']);
    expect(index.anchors.get('^ref-2')?.markdown).toBe('Second.');
    expect(index.referenceRanges).toHaveLength(4);
  });

  it('does not create a new namespace when headings or entry positions change', () => {
    const original = parseReferences('1. Main. ^ref-1\n1. Supplementary. ^sref-1');
    const reordered = parseReferences('## Random\n1. Supplementary. ^sref-1\n## Another\n1. Main. ^ref-1');
    expect(reordered.anchors.get('^ref-1')?.sectionId).toBe(original.anchors.get('^ref-1')?.sectionId);
    expect(reordered.anchors.get('^sref-1')?.sectionId).toBe(original.anchors.get('^sref-1')?.sectionId);
  });

  it.each(['\n', '\n\n'])('supports a standalone block ID separated by %j', gap => {
    const source = `1. First reference.\n   Journal, 2024.${gap}^ref-1\n\nSecond reference.\n^ref-2`;
    const index = parseReferences(source);
    expect(index.entries.get(1)?.markdown).toBe('First reference.\nJournal, 2024.');
    expect(index.entries.get(2)?.markdown).toBe('Second reference.');
    expect(source.slice(index.referenceRanges[0].from, index.referenceRanges[0].to)).toBe(`1. First reference.\n   Journal, 2024.${gap}^ref-1`);
  });

  it('handles compact lists and loose lists without joining neighboring references', () => {
    const source = '1. First. ^ref-1\n2. Second. ^ref-2\n\n3. Third.\n   Continuation. ^ref-3';
    expect([...parseReferences(source).entries.values()].map(entry => entry.markdown)).toEqual(['First.', 'Second.', 'Third.\nContinuation.']);
  });

  it('ends each entry exactly at its anchor and never swallows following explanations or metadata', () => {
    const source = '1. First. ^ref-1\nPublisher disclaimer.\n\n---\n[Zotero item](zotero://select/library/items/TEST)';
    const index = parseReferences(source);
    expect(index.entries.get(1)?.markdown).toBe('First.');
    expect(source.slice(index.referenceRanges[0].from, index.referenceRanges[0].to)).toBe('1. First. ^ref-1');
  });

  it('does not attach an empty standalone anchor to another anchored block', () => {
    expect(parseReferences('^ref-1').entries.size).toBe(0);
    const index = parseReferences('Figure caption. ^fig-1\n\n^ref-1\n\n1. Actual. ^ref-2');
    expect([...index.entries.keys()]).toEqual([2]);
  });

  it('accepts four-space and tab-indented list continuations while excluding genuine indented code', () => {
    const source = '1. First reference.\n    Journal. ^ref-1\n\n2. Second reference.\n\tJournal. ^ref-2\n\n    3. Code pretending to be a reference. ^ref-3';
    const index = parseReferences(source);
    expect([...index.entries.keys()]).toEqual([1, 2]);
    expect(index.entries.get(1)?.markdown).toBe('First reference.\nJournal.');
    expect(index.entries.get(2)?.markdown).toBe('Second reference.\nJournal.');
  });

  it('supports an indented continuation paragraph of a reference list item', () => {
    const source = '1. First reference.\n\n   Continuation.\n   ^ref-1\n\n2. Second. ^ref-2';
    expect(parseReferences(source).entries.get(1)?.markdown).toBe('First reference.\n\nContinuation.');
  });

  it('does not accept code nested inside a list or a block ID following a code block', () => {
    const source = '1. Body list item.\n\n       Code. ^ref-1\n\n2. Another body item.\n    ~~~md\n    Code. ^ref-2\n    ~~~\n\n    Indented code.\n\n^ref-3\n\n4. Actual. ^ref-4';
    expect([...parseReferences(source).entries.keys()]).toEqual([4]);
  });

  it('does not let literal fences in indented code hide subsequent real references', () => {
    const source = '    ```\n    An indented code block.\n\n1. Valid first. ^ref-1\n2. Valid second. ^ref-2';
    expect([...parseReferences(source).entries.keys()]).toEqual([1, 2]);
  });

  it('keeps indented literal fence pairs separate from real references between their code blocks', () => {
    const source = '    ```\n    First code block.\n\n1. First. ^ref-1\n\n    ```\n    Another code block.\n\n2. Second. ^ref-2';
    expect([...parseReferences(source).entries.keys()]).toEqual([1, 2]);
  });

  it('excludes list-fenced payloads with three-space indentation and resumes after the closing fence', () => {
    const source = '1. Body list item.\n    ~~~md\n   1. False. ^ref-1\n    ~~~\n\n2. Actual. ^ref-2';
    expect([...parseReferences(source).entries.keys()]).toEqual([2]);
  });

  it('does not swallow headings or previous labeled blocks when locating unnumbered references', () => {
    const source = 'Body text.\n## Anything\nA reference. ^ref-1\nA figure. ^fig-1\nAnother reference. ^ref-2';
    expect([...parseReferences(source).entries.values()].map(entry => entry.markdown)).toEqual(['A reference.', 'Another reference.']);
  });

  it('preserves Markdown links, inline code, and inline math in genuine reference text', () => {
    const source = '1. [Title](https://example.org). `A code name` and $E=mc^2$. ^ref-1';
    expect(parseReferences(source).entries.get(1)?.markdown).toBe('[Title](https://example.org). `A code name` and $E=mc^2$.');
  });

  it('ignores apparent reference anchors in YAML, fenced code, comments, raw code, and math', () => {
    const source = '---\nvalue: False. ^ref-1\n---\n```md\nFalse. ^ref-2\n```\n<!--\nFalse. ^ref-3\n-->\n%%\nFalse. ^ref-4\n%%\n<pre>\nFalse. ^ref-5\n</pre>\n<script>\nFalse. ^ref-6\n</script>\n$$\nFalse. ^ref-7\n$$\n8. Actual. ^ref-8';
    expect([...parseReferences(source).entries.keys()]).toEqual([8]);
  });

  it('ignores reference definitions inside an unterminated code fence', () => {
    expect(parseReferences('```md\n1. Code. ^ref-1').entries.size).toBe(0);
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
