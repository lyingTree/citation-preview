import type { CitationGroup } from './types';

/** Expanded preview numbers are deduplicated; native hover applies to one displayed linked token only. */
export function usesNativeSinglePreview(group: CitationGroup): boolean {
  if (!group.linked) return false;
  if (group.tokens) return group.tokens.length === 1 && group.tokens[0].linked;
  return group.numbers.length === 1;
}
