import { describe, expect, it } from 'vitest';
import { CitationDocument } from '../src/model';
import { DEFAULT_SETTINGS, type CitationGroup } from '../src/types';

const references = [
  '1. Main first. ^ref-1',
  '2. Main second. ^ref-2',
  '3. Main third. ^ref-3',
  '',
  '1. Supplement first. ^sref-1',
  '2. Supplement second. ^sref-2',
  '3. Supplement third. ^sref-3'
].join('\n');

function parse(body: string, entries = references): CitationDocument {
  return new CitationDocument(`${body}\n\n${entries}`, 'Papers/Article.md', DEFAULT_SETTINGS);
}

function texts(model: CitationDocument, group: CitationGroup): Array<string | undefined> {
  const scope = model.references.sections.find(section => section.id === group.scopeId);
  return group.numbers.map(number => scope?.entries.get(number)?.markdown);
}

describe('anchor namespaces without bibliography headings', () => {
  it('resolves identical main and supplementary labels to different references', () => {
    const model = parse(String.raw`Main \[[1](<#^ref-1>)–[3](<#^ref-3>)\]; supplement \[[1](<#^sref-1>)–[3](<#^sref-3>)\].`);
    expect(model.groups.map(group => group.scopeId)).toEqual(['ref', 'sref']);
    expect(model.groups.map(group => group.label)).toEqual(['[1–3]', '[1–3]']);
    expect(texts(model, model.groups[0])).toEqual(['Main first.', 'Main second.', 'Main third.']);
    expect(texts(model, model.groups[1])).toEqual(['Supplement first.', 'Supplement second.', 'Supplement third.']);
    expect(model.references.anchors.size).toBe(6);
  });

  it('finds entries split across arbitrary headings and preserves intervening body citations', () => {
    const source = String.raw`First \[[1](#^ref-1)–[3](#^ref-3)\].`
      + '\n\n1. Main first. ^ref-1\n\n## An unrelated heading\n\nSecond [1–3].'
      + '\n\n2. Main second. ^ref-2\n\n## Another heading\n\n3. Main third. ^ref-3';
    const model = new CitationDocument(source, 'Article.md', DEFAULT_SETTINGS);
    expect(model.references.sections).toHaveLength(1);
    expect(model.references.sections[0].id).toBe('ref');
    expect(model.groups).toHaveLength(2);
    expect(model.groups.map(group => texts(model, group))).toEqual([
      ['Main first.', 'Main second.', 'Main third.'],
      ['Main first.', 'Main second.', 'Main third.']
    ]);
  });

  it('supports supplementary wiki links and a linked range label', () => {
    const model = parse(String.raw`\[[[#^sref-1|1]], [[#^sref-3|3]]\] and [1–3](<#^sref-1>).`);
    expect(model.groups.map(group => group.scopeId)).toEqual(['sref', 'sref']);
    expect(model.groups.map(group => group.linkTargets)).toEqual([['^sref-1', '^sref-3'], ['^sref-1']]);
    expect(model.groups.map(group => group.numbers)).toEqual([[1, 3], [1, 2, 3]]);
  });

  it('keeps a missing intermediate item in its own namespace', () => {
    const entries = references.replace('2. Supplement second. ^sref-2\n', '');
    const model = parse(String.raw`\[[1](#^sref-1)–[3](#^sref-3)\]`, entries);
    expect(texts(model, model.groups[0])).toEqual(['Supplement first.', undefined, 'Supplement third.']);
  });

  it('does not silently merge explicitly linked namespaces', () => {
    for (const separator of ['–', ',']) {
      const model = parse(String.raw`\[[1](#^ref-1)${separator}[3](#^sref-3)\]`);
      expect(model.groups).toEqual([]);
    }
  });

  it('requires real targets and matching citation numbers', () => {
    for (const body of [
      String.raw`\[[1](#^sref-2),[3](#^sref-3)\]`,
      String.raw`\[[1](#^ref1),[3](#^ref-3)\]`,
      String.raw`\[[1](#^fig-1),[3](#^fig-3)\]`,
      String.raw`\[[1](Other.md#^sref-1),[3](#^sref-3)\]`
    ]) expect(parse(body).groups).toEqual([]);
  });

  it('marks plain citations ambiguous when multiple namespaces contain their endpoints', () => {
    const model = parse('An unlinked interval [1–3].');
    expect(model.groups).toHaveLength(1);
    expect(model.groups[0].ambiguousScope).toBe(true);
    expect(model.groups[0].scopeId).toBeUndefined();
  });

  it('selects a plain citation namespace only with unique number evidence', () => {
    const model = parse('Unlinked [1, 4].', references + '\n\n4. Main fourth. ^ref-4');
    expect(model.groups[0].scopeId).toBe('ref');
    expect(texts(model, model.groups[0])).toEqual(['Main first.', 'Main fourth.']);
  });

  it('does not create references from a heading or unanchored numbered prose', () => {
    const model = parse('Evidence [1–3].', '## References\n1. Ordinary step.\n2. Another step.\n3. Last step.');
    expect(model.references.anchors.size).toBe(0);
    expect(model.groups).toEqual([]);
  });

  it('expands the supplied supplement structure without depending on entry order', () => {
    const entries = [
      ...Array.from({ length: 66 }, (_, i) => `${i + 1}. Main ${i + 1}. ^ref-${i + 1}`),
      ...Array.from({ length: 30 }, (_, i) => `${i + 1}. Supplement ${i + 1}. ^sref-${i + 1}`)
    ].reverse().join('\n');
    const model = parse(String.raw`\[[8](<#^sref-8>),[10](<#^sref-10>),[26](<#^sref-26>)-[28](<#^sref-28>)\]`, entries);
    expect(model.references.anchors.size).toBe(96);
    expect(model.groups[0].numbers).toEqual([8, 10, 26, 27, 28]);
    expect(texts(model, model.groups[0])).toEqual(['Supplement 8.', 'Supplement 10.', 'Supplement 26.', 'Supplement 27.', 'Supplement 28.']);
  });
});
