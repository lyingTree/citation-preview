import { describe, expect, it } from 'vitest';
import { CitationDocument } from '../src/model';
import { detectReferenceLists, nearestReferenceList } from '../src/reference-lists';
import { DEFAULT_SETTINGS, type ReferenceList } from '../src/types';

const first = 'Smith J, Lee A. Atmospheric waves. Journal of Climate, 2024, 37: 1-12.';
const second = 'Jones B. Ocean dynamics [J]. Ocean Science, 2023, 19: 11-22.';
const third = '王五, 李四. 重力波研究[J]. 大气科学, 2022, 46(2): 1-10.';
const make = (body: string) => new CitationDocument(body, 'Paper.md', DEFAULT_SETTINGS);

describe('conservative physical bibliography detection', () => {
  it.each(['[1]', '［1］', '【1】', '(1)', '（1）', '1.', '1)', '1、', '1．', '**[1]**'])('recognizes numbered bibliography marker %s without a heading', marker => {
    const lists = detectReferenceLists(`${marker} ${first}\n2. ${second}`);
    expect(lists).toHaveLength(1);
    expect([...lists[0].entries.keys()]).toEqual([1, 2]);
  });

  it('does not infer a bibliography from a heading, years, or numbered steps alone', () => {
    for (const source of [
      '## References\n1. First step.\n2. Second step.',
      '## Timeline\n1. In 2024 the team measured rainfall.\n2. In 2025 the team revised the model.',
      '## Data\n1. 2024, 37: 1-12.\n2. 2023, 19: 11-22.',
      '1. Install the Journal software in 2024.\n2. Run the climate model in 2025.'
    ]) expect(detectReferenceLists(source)).toEqual([]);
  });

  it('preserves multiline entries and excludes following prose and code', () => {
    const source = `Evidence [1,2].\n\n1. Smith J, Lee A. Atmospheric waves.\n   Journal of Climate, 2024, 37: 1-12.\n\n2. ${second}\n\nBody after references [1].\n\n\`\`\`md\n3. ${third}\n\`\`\``;
    const model = make(source);
    expect(model.references.lists).toHaveLength(1);
    expect(model.references.lists![0].items).toHaveLength(2);
    expect(model.reference(model.groups[0], 1)?.markdown).toContain('Atmospheric waves.\nJournal');
    expect(model.groups.map(group => group.numbers)).toEqual([[1, 2], [1]]);
    expect(model.references.lists![0].items.some(entry => entry.markdown.includes('Body after'))).toBe(false);
  });

  it('supports linked and wiki-linked bibliography text while preserving original Markdown', () => {
    const linked = '[Fritts, D.C.; Alexander, M.J. Gravity wave dynamics. Rev. Geophys. 2003, 41, 1003. \\[CrossRef\\]](<2003-Paper.md>)';
    const wiki = `[[Journal/Other paper|${third}]]`;
    const source = `Evidence [1-3].\n\n1. ${first}\n2. ${linked}\n3. ${wiki}`;
    const model = make(source);
    expect(model.references.lists).toHaveLength(1);
    expect(model.references.lists![0].items).toHaveLength(3);
    expect(model.reference(model.groups[0], 2)?.markdown).toBe(linked);
    expect(model.reference(model.groups[0], 3)?.markdown).toBe(wiki);
    expect(model.isResolved(model.groups[0])).toBe(true);
  });

  it('accepts a single entry with a strong identifier and a single author/year entry under a bibliography heading', () => {
    expect(detectReferenceLists('1. A documented report. https://doi.org/10.1234/abcd')).toHaveLength(1);
    expect(detectReferenceLists(`## 参考文献\n1. ${first}`)).toHaveLength(1);
    expect(detectReferenceLists(`1. ${first}`)).toHaveLength(0);
  });

  it('separates numbering resets and sections instead of merging bibliography numbers', () => {
    const source = `A [1,2].\n\n1. ${first}\n2. ${second}\n\n1. ${third}\n2. ${second}\n\n## Other chapter\n\n1. ${first}\n2. ${second}`;
    const lists = detectReferenceLists(source);
    expect(lists).toHaveLength(3);
    expect(lists.map(list => list.items.map(entry => entry.number))).toEqual([[1, 2], [1, 2], [1, 2]]);
  });

  it('detects repeated numbers as ambiguous instead of silently assigning one entry', () => {
    const model = make(`Evidence [1,2].\n\n1. ${first}\n1. ${third}\n2. ${second}`);
    expect(model.groups).toHaveLength(1);
    expect(model.references.lists![0].duplicates.has(1)).toBe(true);
    expect(model.reference(model.groups[0], 1)).toBeUndefined();
    expect(model.isResolved(model.groups[0])).toBe(false);
  });

  it('treats repeated generic block IDs anywhere in the note as ambiguous destinations', () => {
    const model = make(`Evidence [1,2].\n\n1. ${first} ^shared\n2. ${second} ^safe\n\nUnrelated paragraph. ^shared`);
    expect(model.references.lists![0].duplicates.has(1)).toBe(true);
    expect(model.reference(model.groups[0], 1)).toBeUndefined();
    expect(model.isResolved(model.groups[0])).toBe(false);
  });

  it('respects the pure numeric recognition setting without changing explicit links', () => {
    const source = `Plain [1,2]. Linked [1](#^ref-1).\n\n1. ${first} ^ref-1\n2. ${second}`;
    const model = new CitationDocument(source, 'Paper.md', { ...DEFAULT_SETTINGS, recognizePlainText: false });
    expect(model.references.lists).toBeUndefined();
    expect(model.groups).toHaveLength(1);
    expect(model.groups[0].linked).toBe(true);
  });
});

describe('nearest bibliography selection', () => {
  it('resolves identical plain labels against their nearest preceding or following physical list', () => {
    const source = `Early [1,2].\n\n1. ${first}\n2. ${second}\n\n${'Other prose.\n'.repeat(80)}\nLater [1,2].\n\n## Supplementary references\n1. ${third}\n2. ${second}`;
    const model = make(source);
    expect(model.groups).toHaveLength(2);
    expect(model.groups[0].scopeId).not.toBe(model.groups[1].scopeId);
    expect(model.reference(model.groups[0], 1)?.markdown).toBe(first);
    expect(model.reference(model.groups[1], 1)?.markdown).toBe(third);
    expect(model.groups.every(group => model.isResolved(group))).toBe(true);
  });

  it('does not borrow a missing item from a more distant list', () => {
    const source = `Evidence [1-3].\n\n1. ${first}\n3. ${second}\n\n${'Other prose.\n'.repeat(30)}\n## Supplement\n1. ${third}\n2. ${second}\n3. ${first}`;
    const model = make(source);
    expect(model.groups).toHaveLength(1);
    expect(model.reference(model.groups[0], 2)).toBeUndefined();
    expect(model.isResolved(model.groups[0])).toBe(false);
  });

  it('chooses the following list when distances are exactly equal', () => {
    const list = (id: string, from: number, to: number): ReferenceList => ({
      id, title: id, from, to, entries: new Map(), duplicates: new Set(), items: [], supplemental: false
    });
    const before = list('before', 0, 10);
    const after = list('after', 30, 40);
    expect(nearestReferenceList([before, after], 15, 25)).toBe(after);
    expect(nearestReferenceList([after, before], 15, 25)).toBe(after);
  });

  it('prefers a bibliography in the same structural chapter over a closer list in another chapter', () => {
    const source = `# Paper\n## Main material\nMain [1,2].\n### References\n1. ${first}\n2. ${second}\n\n## Supplemental material\n### Early figures\nSupplement [1,2].\n\n${'Extended supplementary discussion.\n'.repeat(100)}\n### References\n1. ${third}\n2. ${second}`;
    for (const document of [source, source.replace(/^(#{1,6}) .*$/gm, '$1 Arbitrary title')]) {
      const model = make(document);
      expect(model.groups).toHaveLength(2);
      expect(model.reference(model.groups[0], 1)?.markdown).toBe(first);
      expect(model.reference(model.groups[1], 1)?.markdown).toBe(third);
    }
  });

  it('keeps missing chapter-local entries missing even when another chapter contains the number', () => {
    const source = `# Paper\n## Main\n1. ${first}\n2. ${second}\n3. ${third}\n\n## Supplement\n### Text\nEvidence [1-3].\n\n${'More text.\n'.repeat(50)}\n### Bibliography\n1. ${second}\n3. ${first}`;
    const model = make(source);
    expect(model.reference(model.groups[0], 1)?.markdown).toBe(second);
    expect(model.reference(model.groups[0], 2)).toBeUndefined();
    expect(model.isResolved(model.groups[0])).toBe(false);
  });
});
