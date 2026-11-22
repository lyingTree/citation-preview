import { describe, expect, it } from 'vitest';
import { planReferenceAnchors, type AnchorPlan } from '../src/anchors';
import { parseReferences } from '../src/bibliography';

const first = 'Smith J. Atmospheric waves [J]. Journal of Climate, 2024, 37: 1-12.';
const second = 'Jones B. Ocean dynamics [J]. Ocean Science, 2023, 19: 11-22.';
function apply(source: string, plan: AnchorPlan): string {
  for (const change of [...plan.changes].reverse()) source = source.slice(0, change.from) + change.insert + source.slice(change.to);
  return source;
}

describe('manual reference-anchor planning', () => {
  it('plans insertions without changing the supplied string and is idempotent after application', () => {
    const source = `Body [1,2].\n\n1. ${first}\n2. ${second}`;
    const plan = planReferenceAnchors(source);
    expect(source).not.toContain('^ref-');
    expect(plan).toMatchObject({ added: 2, skipped: 0, lists: 1 });
    expect(plan.changes.every(change => change.from === change.to)).toBe(true);
    const result = apply(source, plan);
    expect(parseReferences(result).anchors.size).toBe(2);
    expect(planReferenceAnchors(result).changes).toEqual([]);
  });

  it('preserves CRLF, Unicode text, trailing spaces, and missing final newline', () => {
    const source = `😀 Evidence [1,2].\r\n\r\n1. ${first}  \r\n2. ${second}`;
    const result = apply(source, planReferenceAnchors(source));
    expect(result.replace(/ \^ref-[12]/g, '')).toBe(source);
    expect(result).toContain('^ref-1  \r\n');
    expect(result.endsWith('^ref-2')).toBe(true);
  });

  it('uses independent namespaces for main, supplementary, and later bibliographies', () => {
    const source = `## References\n1. ${first}\n2. ${second}\n\n## Supplementary references\n1. ${first}\n2. ${second}\n\n## Other references\n1. ${first}\n2. ${second}`;
    const plan = planReferenceAnchors(source);
    expect(plan.changes.map(change => change.insert)).toEqual([
      ' ^ref-1', ' ^ref-2', ' ^sref-1', ' ^sref-2', ' ^ref-list2-1', ' ^ref-list2-2'
    ]);
    expect(parseReferences(apply(source, plan)).duplicateAnchors.size).toBe(0);
  });

  it('preserves any existing block ID and fills only safe missing IDs', () => {
    const source = `1. ${first} ^custom\n2. ${second}\n3. ${first} ^ref-3`;
    const plan = planReferenceAnchors(source);
    expect(plan).toMatchObject({ added: 1, skipped: 2 });
    expect(plan.changes[0].insert).toBe(' ^ref-2');
    expect(apply(source, plan)).toContain('^custom');
  });

  it('skips repeated numbers and semantic collisions between ref1 and ref-1', () => {
    const source = `Existing unrelated reference. ^ref1\n\n## References\n1. ${first}\n2. ${second} ^ref-2\n3. ${first}\n3. ${second}`;
    const plan = planReferenceAnchors(source);
    expect(plan.added).toBe(0);
    expect(plan.changes).toEqual([]);
  });

  it('does not reuse a namespace occupied by a different physical list', () => {
    const source = `Old isolated reference. ^ref-20\n\n## New references\n1. ${first}\n2. ${second}`;
    const plan = planReferenceAnchors(source);
    expect(plan.changes.map(change => change.insert)).toEqual([' ^ref-list2-1', ' ^ref-list2-2']);
  });

  it('does not modify code, ordinary numbered lists, or bibliography-like examples in YAML', () => {
    const source = `---\nexample: |\n  1. ${first}\n---\n\n1. First step.\n2. Second step.\n\n\`\`\`md\n1. ${first}\n2. ${second}\n\`\`\``;
    expect(planReferenceAnchors(source).changes).toEqual([]);
  });
});
