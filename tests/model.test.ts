import { describe, expect, it } from 'vitest';
import { CitationDocument } from '../src/model';
import { DEFAULT_SETTINGS } from '../src/types';

function paper(prefix = 'First', newline = '\n'): string {
  return [
    '# Analysis',
    '',
    '😀 Early evidence [1–3].',
    'Text between the citation groups.',
    'Later evidence [2, 4]. Final group [3–4].',
    '',
    '## References',
    '',
    `1. ${prefix} fictional reference one. ^ref-1`,
    `2. ${prefix} fictional reference two. ^ref-2`,
    `3. ${prefix} fictional reference three. ^ref-3`,
    `4. ${prefix} fictional reference four. ^ref-4`
  ].join(newline);
}

describe('citation document reference scope', () => {
  it('resolves identical citation numbers independently in different files', () => {
    const first = new CitationDocument(paper('Alpha'), 'A/Paper.md', DEFAULT_SETTINGS);
    const second = new CitationDocument(paper('Beta'), 'B/Paper.md', DEFAULT_SETTINGS);
    expect(first.references.entries.get(1)?.markdown).toContain('Alpha fictional reference one');
    expect(second.references.entries.get(1)?.markdown).toContain('Beta fictional reference one');
    expect(first.references.entries).not.toBe(second.references.entries);
    expect(first.groups.map(group => group.numbers)).toEqual([[1, 2, 3], [2, 4], [3, 4]]);
    expect(second.groups.map(group => group.numbers)).toEqual([[1, 2, 3], [2, 4], [3, 4]]);
  });

  it('keeps separate document revisions independent after a bibliography edit', () => {
    const earlier = new CitationDocument(paper('Original'), 'Paper.md', DEFAULT_SETTINGS);
    const updated = new CitationDocument(paper('Corrected'), 'Paper.md', DEFAULT_SETTINGS);
    expect(earlier.references.entries.get(3)?.markdown).toContain('Original fictional reference three');
    expect(updated.references.entries.get(3)?.markdown).toContain('Corrected fictional reference three');
    expect(updated.references.entries.get(3)).not.toBe(earlier.references.entries.get(3));
  });
});

describe('citation position lookup', () => {
  it('finds each group by its actual source position, including after non-BMP text', () => {
    const source = paper();
    const model = new CitationDocument(source, 'Paper.md', DEFAULT_SETTINGS);
    expect(model.at(source.indexOf('[1–3]') + 2)?.numbers).toEqual([1, 2, 3]);
    expect(model.at(source.indexOf('[2, 4]') + 4)?.numbers).toEqual([2, 4]);
    expect(model.at(source.indexOf('[3–4]') + 1)?.numbers).toEqual([3, 4]);
  });

  it('includes both visible brackets but excludes the character after a group', () => {
    const source = paper();
    const model = new CitationDocument(source, 'Paper.md', DEFAULT_SETTINGS);
    const start = source.indexOf('[1–3]');
    expect(model.at(start)?.label).toBe('[1–3]');
    expect(model.at(start + '[1–3]'.length - 1)?.label).toBe('[1–3]');
    expect(model.at(start - 1)).toBeUndefined();
    expect(model.at(start + '[1–3]'.length)).toBeUndefined();
  });

  it('returns no citation in prose, the bibliography, or outside the document', () => {
    const source = paper();
    const model = new CitationDocument(source, 'Paper.md', DEFAULT_SETTINGS);
    expect(model.at(source.indexOf('Text between'))).toBeUndefined();
    expect(model.at(source.indexOf('fictional reference one'))).toBeUndefined();
    expect(model.at(-1)).toBeUndefined();
    expect(model.at(source.length)).toBeUndefined();
    expect(model.at(source.length + 100)).toBeUndefined();
  });
});

describe('citation line filtering', () => {
  it('uses zero-based inclusive line bounds and retains source order within a line', () => {
    const model = new CitationDocument(paper(), 'Paper.md', DEFAULT_SETTINGS);
    expect(model.inLines(2, 2).map(group => group.numbers)).toEqual([[1, 2, 3]]);
    expect(model.inLines(3, 4).map(group => group.numbers)).toEqual([[2, 4], [3, 4]]);
    expect(model.inLines(2, 4).map(group => group.numbers)).toEqual([[1, 2, 3], [2, 4], [3, 4]]);
    expect(model.inLines(0, 1)).toEqual([]);
    expect(model.inLines(5, 11)).toEqual([]);
  });

  it('handles CRLF notes without moving citation offsets or changing line selection', () => {
    const source = paper('First', '\r\n');
    const model = new CitationDocument(source, 'Paper.md', DEFAULT_SETTINGS);
    expect(model.inLines(2, 2).map(group => group.numbers)).toEqual([[1, 2, 3]]);
    expect(model.inLines(4, 4).map(group => group.numbers)).toEqual([[2, 4], [3, 4]]);
    expect(model.at(source.indexOf('[3–4]') + 2)?.numbers).toEqual([3, 4]);
  });

  it('keeps citations on adjacent lines within their own line bounds', () => {
    const source = [
      '[1–3]',
      '[2–3]',
      '',
      '## References',
      '',
      '1. Fictional one.',
      '2. Fictional two.',
      '3. Fictional three.'
    ].join('\n');
    const model = new CitationDocument(source, 'Paper.md', DEFAULT_SETTINGS);
    expect(model.inLines(0, 1).map(group => group.numbers)).toEqual([[1, 2, 3], [2, 3]]);
    expect(model.inLines(0, 0).map(group => group.numbers)).toEqual([[1, 2, 3]]);
    expect(model.inLines(1, 1).map(group => group.numbers)).toEqual([[2, 3]]);
  });

  it('returns no groups for empty or out-of-document line intervals', () => {
    const model = new CitationDocument(paper(), 'Paper.md', DEFAULT_SETTINGS);
    expect(model.inLines(4, 3)).toEqual([]);
    expect(model.inLines(0, -1)).toEqual([]);
    expect(model.inLines(100, 200)).toEqual([]);
    expect(model.inLines(0, 200)).toHaveLength(3);
    expect(new CitationDocument('', 'Empty.md', DEFAULT_SETTINGS).inLines(0, 0)).toEqual([]);
  });
});
