import { ignoredMarkdownRanges, parseReferences, referenceAnchor, sourceLines, type SourceRange } from './bibliography';
import type { HeadingScope, ReferenceEntry, ReferenceIndex, ReferenceList } from './types';

interface Candidate extends ReferenceEntry {
  evidence: number;
  heading: string;
  namespace?: string;
}

const YEAR = /\b(?:1[5-9]|20|21)\d{2}[a-z]?\b/i;
const IDENTIFIER = /(?:\b10\.\d{4,9}\/\S+|\bISBN(?:-1[03])?\s*:?[\s\d-]{10,}|\barXiv\s*:\s*\d{4}\.\d{4,5})/i;
const DOCUMENT_TYPE = /\[(?:J|M|C|D|R|S|P|N|EB)(?:\/(?:OL|CD))?\]/i;
const PUBLICATION = /\b(?:Journal|Proceedings|Transactions|Letters|Review|Reviews|Press|Publisher|University|Geophys(?:ical)?|Atmos(?:pheric)?|Ocean(?:ography|ographic)?|Science|Nature|Springer|Elsevier)\b|学报|期刊|出版社|大学|会议|标准|专利/i;
const PAGES = /\b\d{1,4}\s*(?:\(\d{1,3}\))?\s*[:,]\s*(?:[A-Za-z]?\d{1,7})(?:\s*[-–—]\s*\d{1,7})?/;
const AUTHOR = /^(?:[A-ZÀ-ÖØ-Ý][\p{L}'’‐-]+(?:\s*,\s*|\s+)(?:[A-Z](?:[.\s,-]|$)|[A-Z][\p{L}'’‐-]+(?:\s*,|\s+and\s))|[\p{Script=Han}]{2,4}(?:[，,、.．。]|\s+[\p{Script=Han}]{2,4}))/u;

/** Exported for the insertion planner; only genuine block definitions match. */
export function blockAnchorAtEnd(text: string): { id: string; from: number } | undefined {
  const match = /(?:^|[ \t])\^([A-Za-z0-9-]+)[ \t]*$/.exec(text);
  if (!match) return undefined;
  return { id: match[1], from: match.index + match[0].indexOf('^') };
}

function blocked(offset: number, ranges: SourceRange[]): boolean {
  let low = 0;
  let high = ranges.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (ranges[mid].to <= offset) low = mid + 1;
    else high = mid;
  }
  return !!ranges[low] && ranges[low].from <= offset;
}

function numberedStart(text: string): { number: number; width: number } | undefined {
  const match = /^ {0,3}(?:\*\*)?(?:\[([1-9]\d{0,8})\]|［([1-9]\d{0,8})］|【([1-9]\d{0,8})】|\(([1-9]\d{0,8})\)|（([1-9]\d{0,8})）|([1-9]\d{0,8})[.)、．])(?:\*\*)?[ \t]*/.exec(text);
  if (!match) return undefined;
  const number = Number(match.slice(1).find(value => value !== undefined));
  return { number, width: match[0].length };
}

function structuralBoundary(text: string): boolean {
  return /^ {0,3}(?:#{1,6}(?:\s|$)|>|(?:`{3,}|~{3,})|\|)/.test(text)
    || /^ {0,3}(?:(?:\*[ \t]*){3,}|(?:-[ \t]*){3,}|(?:_[ \t]*){3,}|=+)\s*$/.test(text);
}

function headingText(text: string): string | undefined {
  const atx = /^ {0,3}#{1,6}\s+(.+?)(?:\s+#+)?\s*$/.exec(text);
  if (atx) return atx[1];
  const bold = /^\s*\*\*(.{1,100})\*\*\s*$/.exec(text);
  return bold?.[1];
}

/** Parse heading nesting once. Titles are not used to assign citation membership. */
export function detectHeadingScopes(source: string, lines = sourceLines(source), ignored = ignoredMarkdownRanges(source, lines, false)): HeadingScope[] {
  const scopes: HeadingScope[] = [];
  const stack: Array<{ level: number; from: number }> = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const content = line.from + (line.text.match(/^\s*/)?.[0].length ?? 0);
    if (blocked(content, ignored)) continue;
    const atx = /^ {0,3}(#{1,6})(?:\s|$)/.exec(line.text);
    const setext = !atx && line.text.trim() && !numberedStart(line.text) && !structuralBoundary(line.text)
      ? /^ {0,3}(=+|-+)\s*$/.exec(lines[i + 1]?.text ?? '') : null;
    const level = atx ? atx[1].length : setext ? (setext[1][0] === '=' ? 1 : 2) : 0;
    if (!level) continue;
    while (stack.length && stack[stack.length - 1].level >= level) stack.pop();
    stack.push({ level, from: line.from });
    scopes.push({ from: line.from, path: stack.map(heading => heading.from) });
    if (setext) i += 1;
  }
  return scopes;
}

export function headingPathAt(scopes: HeadingScope[], offset: number): number[] {
  let low = 0;
  let high = scopes.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (scopes[mid].from <= offset) low = mid + 1;
    else high = mid;
  }
  return low > 0 ? scopes[low - 1].path : [];
}

/** Structural numbering alone, or a year alone, cannot establish a bibliography. */
function evidence(text: string, anchored: boolean): number {
  if (anchored) return 4;
  const clean = text
    .replace(/\[\[([^\]\n|]+)(?:\|([^\]\n]+))?\]\]/g, (_match, target: string, label: string | undefined) => label ?? target)
    .replace(/\[((?:\\.|[^\]\\])*)\]\((?:<[^>\r\n]*>|[^)\r\n]*)\)/g, '$1')
    .replace(/<[^>\n]*>/g, '')
    .replace(/\\([\\`*{}[\]()#+\-.!_>])/g, '$1')
    .replace(/\*\*|__/g, '').trim();
  if (clean.length < 18) return 0;
  if (IDENTIFIER.test(clean)) return 3;
  const year = YEAR.test(clean);
  if (year && DOCUMENT_TYPE.test(clean)) return 3;
  if (!year || !AUTHOR.test(clean)) return 0;
  if (PUBLICATION.test(clean) || PAGES.test(clean)) return 2;
  const punctuation = clean.match(/[.。．]/g)?.length ?? 0;
  return punctuation >= 2 ? 2 : 0;
}

function addEntry(list: ReferenceList, entry: ReferenceEntry, duplicateAnchor: boolean): void {
  list.items.push(entry);
  if (duplicateAnchor || list.entries.has(entry.number) || list.duplicates.has(entry.number)) {
    list.duplicates.add(entry.number);
    list.entries.delete(entry.number);
    return;
  }
  list.entries.set(entry.number, entry);
}

/**
 * Detect physically adjacent numbered bibliography entries conservatively.
 * This never adds to or changes the explicit ref/sref anchor namespace index.
 */
export function detectReferenceLists(
  source: string,
  index: ReferenceIndex = parseReferences(source),
  lines = sourceLines(source)
): ReferenceList[] {
  const ignored = ignoredMarkdownRanges(source, lines, false);
  const headingScopes = index.headingScopes ?? detectHeadingScopes(source, lines, ignored);
  const blockIds = new Set<string>();
  const duplicatedBlockIds = new Set<string>(index.duplicateAnchors);
  for (const line of lines) {
    const anchor = blockAnchorAtEnd(line.text);
    if (!anchor || blocked(line.from + anchor.from, ignored)) continue;
    const id = `^${anchor.id}`;
    if (blockIds.has(id)) duplicatedBlockIds.add(id);
    blockIds.add(id);
  }
  const known = new Map<number, ReferenceEntry>();
  for (const entry of index.anchors.values()) known.set(entry.from, entry);
  const candidates: Candidate[] = [];
  let heading = '';

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (blocked(line.from + (line.text.match(/^\s*/)?.[0].length ?? 0), ignored)) continue;
    const nextHeading = headingText(line.text);
    if (nextHeading && !numberedStart(line.text)) { heading = nextHeading; continue; }
    if (!numberedStart(line.text) && /^ {0,3}(?:=+|-+)\s*$/.test(lines[i + 1]?.text ?? '') && line.text.trim()) {
      heading = line.text.trim();
      i += 1;
      continue;
    }
    const prefix = numberedStart(line.text);
    const anchored = known.get(line.from);
    if (!prefix && !anchored) continue;
    if (/^(?: {4,}|\t)/.test(line.text)) continue;

    // Existing anchors already supply exact block boundaries, including multiline entries.
    if (anchored) {
      candidates.push({ ...anchored, evidence: 4, heading, namespace: anchored.sectionId });
      while (i + 1 < lines.length && lines[i + 1].from < anchored.to) i += 1;
      continue;
    }
    if (!prefix) continue;
    let last = i;
    let end = line.from + line.text.trimEnd().length;
    let existingAnchor = blockAnchorAtEnd(line.text);
    let blank = false;
    for (let next = i + 1; !existingAnchor && next < lines.length; next += 1) {
      const follow = lines[next];
      if (!follow.text.trim()) { blank = true; continue; }
      const anchorLine = /^\s*\^[A-Za-z0-9-]+\s*$/.test(follow.text);
      if (numberedStart(follow.text) || headingText(follow.text) || structuralBoundary(follow.text)) break;
      if (blocked(follow.from + (follow.text.match(/^\s*/)?.[0].length ?? 0), ignored)) break;
      if (blank && !/^\s/.test(follow.text) && !anchorLine) break;
      // An inline body citation is evidence that the reference block has ended.
      if (!anchorLine && /(?:\[\s*\d+(?:\s*[-–,]\s*\d+)*\s*\]|#\^(?:s?ref))/.test(follow.text)) break;
      last = next;
      end = follow.from + follow.text.trimEnd().length;
      existingAnchor = blockAnchorAtEnd(follow.text);
      blank = false;
    }
    const raw = source.slice(line.from + prefix.width, end);
    const lastLine = lines[last];
    const identity = existingAnchor ? referenceAnchor(existingAnchor.id) : undefined;
    const contentEnd = existingAnchor ? lastLine.from + existingAnchor.from : end;
    const markdown = source.slice(line.from + prefix.width, contentEnd)
      .replace(/^(?: {1,4}|\t)(?=\S)/gm, '').trim();
    const score = evidence(markdown, identity !== undefined);
    if (score) {
      candidates.push({
        number: identity?.number ?? prefix.number,
        sectionId: '', markdown, from: line.from, to: end, line: line.line,
        anchor: existingAnchor ? `^${existingAnchor.id}` : undefined,
        evidence: score, heading, namespace: identity?.namespace
      });
    }
    // A rejected list item still owns its continuation; do not discover nested entries inside it.
    if (raw.trim()) i = last;
  }

  const lists: ReferenceList[] = [];
  let pending: Candidate[] = [];
  const flush = (): void => {
    if (!pending.length) return;
    const strong = pending.some(entry => entry.evidence >= 3);
    const headingEvidence = /references|bibliography|literature cited|参考文献|引用文献|文献目录/i.test(pending[0].heading);
    // A lone anchored fragment need not be a physical list; the anchor namespace still resolves it.
    if (pending.length === 1 && pending[0].evidence === 4 && !headingEvidence && !evidence(pending[0].markdown, false)) {
      pending = [];
      return;
    }
    // A single unanchored author/year entry needs a bibliography heading; identifiers are sufficient alone.
    if (!strong && pending.length < 2 && !headingEvidence) { pending = []; return; }
    const first = pending[0];
    const last = pending[pending.length - 1];
    const list: ReferenceList = {
      id: `list:${first.from}`, title: first.heading || 'Detected references',
      from: first.from, to: last.to, entries: new Map(), duplicates: new Set(), items: [],
      supplemental: /supplement|appendix|补充|附录|附加/i.test(first.heading),
      headingPath: headingPathAt(headingScopes, first.from)
    };
    for (const candidate of pending) {
      const { evidence: _evidence, heading: _heading, namespace: _namespace, ...entry } = candidate;
      const copy = { ...entry, sectionId: list.id };
      addEntry(list, copy, !!entry.anchor && duplicatedBlockIds.has(entry.anchor));
    }
    lists.push(list);
    pending = [];
  };
  for (const candidate of candidates) {
    const previous = pending[pending.length - 1];
    if (previous) {
      const gap = source.slice(previous.to, candidate.from);
      const resets = candidate.number === 1 && previous.number > 1;
      const changesNamespace = previous.namespace && candidate.namespace && previous.namespace !== candidate.namespace;
      if (gap.trim() || resets || changesNamespace) flush();
    }
    pending.push(candidate);
  }
  flush();
  return lists;
}

/** Prefer the closest shared chapter, then distance; missing entries never select another list. */
export function nearestReferenceList(lists: ReferenceList[], from: number, to: number, headingPath: readonly number[] = []): ReferenceList | undefined {
  let best: ReferenceList | undefined;
  let distance = Number.POSITIVE_INFINITY;
  let shared = -1;
  for (const list of lists) {
    let common = 0;
    while (common < headingPath.length && list.headingPath?.[common] === headingPath[common]) common += 1;
    const current = list.from >= to ? list.from - to : from >= list.to ? from - list.to : 0;
    if (common > shared || (common === shared && (current < distance
      || (current === distance && list.from >= to && (!best || best.from < to))))) {
      best = list;
      distance = current;
      shared = common;
    }
  }
  return best;
}
