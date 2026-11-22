import { ignoredMarkdownRanges, parseReferences, referenceAnchor, sourceLines } from './bibliography';
import { blockAnchorAtEnd, detectReferenceLists } from './reference-lists';

export interface AnchorInsertion {
  from: number;
  to: number;
  insert: string;
}

export interface AnchorPlan {
  /** Sorted insertions, suitable for one undoable editor transaction. */
  changes: AnchorInsertion[];
  added: number;
  skipped: number;
  lists: number;
}

/**
 * Plan only. No source or files are changed until a user invokes the registered command.
 * Existing IDs, including non-reference IDs, are never replaced or duplicated on a block.
 */
export function planReferenceAnchors(source: string): AnchorPlan {
  const lines = sourceLines(source);
  const ignored = ignoredMarkdownRanges(source, lines, false);
  const index = parseReferences(source, lines);
  const lists = detectReferenceLists(source, index, lines);
  const ids = new Set<string>();
  const namespaces = new Set<string>();
  const usedNumbers = new Map(index.sections.map(section => [section.id, new Set([...section.entries.keys(), ...section.duplicates])]));
  let ignoredIndex = 0;
  for (const line of lines) {
    const anchor = blockAnchorAtEnd(line.text);
    if (!anchor) continue;
    const offset = line.from + anchor.from;
    while (ignoredIndex < ignored.length && ignored[ignoredIndex].to <= offset) ignoredIndex += 1;
    if (ignored[ignoredIndex]?.from <= offset) continue;
    ids.add(anchor.id);
    const identity = referenceAnchor(anchor.id);
    if (identity) {
      namespaces.add(identity.namespace);
      const numbers = usedNumbers.get(identity.namespace) ?? new Set<number>();
      numbers.add(identity.number);
      usedNumbers.set(identity.namespace, numbers);
    }
  }

  const plan: AnchorPlan = { changes: [], added: 0, skipped: 0, lists: lists.length };
  const newNamespace = (supplemental: boolean): string => {
    const base = supplemental ? 'sref' : 'ref';
    if (!namespaces.has(base)) { namespaces.add(base); return base; }
    for (let suffix = 2; ; suffix += 1) {
      const candidate = `${base}-list${suffix}`;
      if (namespaces.has(candidate)) continue;
      namespaces.add(candidate);
      return candidate;
    }
  };

  for (const list of lists) {
    const existingNamespaces = new Set(list.items.flatMap(entry => {
      const identity = entry.anchor ? referenceAnchor(entry.anchor.slice(1)) : undefined;
      return identity ? [identity.namespace] : [];
    }));
    if (existingNamespaces.size > 1) {
      plan.skipped += list.items.length;
      continue;
    }
    const namespace = existingNamespaces.values().next().value
      ?? newNamespace(list.supplemental);
    for (const entry of list.items) {
      if (entry.anchor || list.duplicates.has(entry.number)) { plan.skipped += 1; continue; }
      const id = `${namespace}-${entry.number}`;
      if (ids.has(id) || usedNumbers.get(namespace)?.has(entry.number)) { plan.skipped += 1; continue; }
      // Detection ends at the final content character, before CRLF or trailing spaces.
      plan.changes.push({ from: entry.to, to: entry.to, insert: ` ^${id}` });
      ids.add(id);
      const numbers = usedNumbers.get(namespace) ?? new Set<number>();
      numbers.add(entry.number);
      usedNumbers.set(namespace, numbers);
      plan.added += 1;
    }
  }
  plan.changes.sort((left, right) => left.from - right.from);
  return plan;
}
