import type { ReferenceEntry, ReferenceIndex, ReferenceSection } from './types';

export interface SourceRange { from: number; to: number }

interface SourceLine extends SourceRange {
  text: string;
  line: number;
}

/** Keep offsets in the original document, including CRLF and astral characters. */
export function sourceLines(source: string): SourceLine[] {
  const lines: SourceLine[] = [];
  let from = 0;
  let line = 0;
  while (from < source.length) {
    const end = source.indexOf('\n', from);
    const to = end < 0 ? source.length : end + 1;
    lines.push({ from, to, line, text: source.slice(from, end < 0 ? to : end).replace(/\r$/, '') });
    from = to;
    line += 1;
  }
  return lines;
}

function escaped(source: string, offset: number): boolean {
  let backslashes = 0;
  for (let p = offset - 1; p >= 0 && source[p] === '\\'; p -= 1) backslashes += 1;
  return backslashes % 2 === 1;
}

/** Syntax that must not be interpreted as citation text. No Markdown is executed. */
export function ignoredMarkdownRanges(source: string, lines = sourceLines(source), includeIndentedCode = true): SourceRange[] {
  const ranges: SourceRange[] = [];
  let fenced: { marker: string; length: number; from: number; inList: boolean } | undefined;
  let frontmatterEnd = 0;
  if (lines[0]?.text.replace(/^\uFEFF/, '').trim() === '---') {
    const close = lines.findIndex((line, i) => i > 0 && /^(?:---|\.\.\.)\s*$/.test(line.text));
    frontmatterEnd = close < 0 ? source.length : lines[close].to;
    ranges.push({ from: 0, to: frontmatterEnd });
  }
  for (const line of lines) {
    if (line.from < frontmatterEnd) continue;
    const indent = indentation(line.text);
    const continuationStart = !fenced && !includeIndentedCode && indent > 0 ? entryFirstLine(lines, line.line, 0) : undefined;
    const parentList = continuationStart === undefined ? undefined : entryPrefix(lines[continuationStart].text);
    const inList = !!parentList && indent >= parentList.contentIndent && indent < parentList.contentIndent + 4;
    // Extra indentation is meaningful for a fence only inside an actual list item.
    // Literal backticks in top-level indented code must not hide subsequent references.
    const fence = (fenced?.inList || inList ? /^[ \t]*(`{3,}|~{3,})(.*)$/ : /^ {0,3}(`{3,}|~{3,})(.*)$/).exec(line.text);
    if (fenced) {
      if (fence && fence[1][0] === fenced.marker && fence[1].length >= fenced.length && !fence[2].trim()) {
        ranges.push({ from: fenced.from, to: line.to });
        fenced = undefined;
      }
      continue;
    }
    if (fence) {
      if (fence[1][0] === '`' && fence[2].includes('`')) continue;
      fenced = { marker: fence[1][0], length: fence[1].length, from: line.from, inList };
      continue;
    }
    if (indent >= 4 && (includeIndentedCode || continuationStart === undefined)) ranges.push({ from: line.from, to: line.to });
    if (/^ {0,3}\[[^\]\n]+\]:\s*/.test(line.text)) ranges.push({ from: line.from, to: line.to });
  }
  if (fenced) ranges.push({ from: fenced.from, to: source.length });
  ranges.sort((a, b) => a.from - b.from);
  let blockIndex = 0;
  for (let p = 0; p < source.length;) {
    while (blockIndex < ranges.length && ranges[blockIndex].to <= p) blockIndex += 1;
    const blocked = ranges[blockIndex];
    if (blocked && blocked.from <= p && p < blocked.to) { p = blocked.to; continue; }
    if (source.startsWith('<!--', p) || source.startsWith('%%', p)) {
      const opener = source.startsWith('<!--', p) ? '<!--' : '%%';
      const closer = opener === '<!--' ? '-->' : '%%';
      const end = source.indexOf(closer, p + opener.length);
      const to = end < 0 ? source.length : end + closer.length;
      ranges.push({ from: p, to });
      p = to;
      continue;
    }
    if (source[p] === '<') {
      const rawTag = /^<(pre|code|script|style)\b[^>]*>/i.exec(source.slice(p, p + 2048));
      if (rawTag) {
        const closer = new RegExp(`<\\/${rawTag[1]}\\s*>`, 'gi');
        closer.lastIndex = p + rawTag[0].length;
        const end = closer.exec(source);
        const to = end ? end.index + end[0].length : source.length;
        ranges.push({ from: p, to });
        p = to;
        continue;
      }
    }
    if (source[p] === '`' && !escaped(source, p)) {
      let count = 1;
      while (source[p + count] === '`') count += 1;
      const marker = '`'.repeat(count);
      let end = source.indexOf(marker, p + count);
      while (end >= 0 && (source[end - 1] === '`' || source[end + count] === '`')) end = source.indexOf(marker, end + count);
      if (end >= 0) {
        ranges.push({ from: p, to: end + count });
        p = end + count;
        continue;
      }
      p += count;
      continue;
    }
    if (source[p] === '$' && !escaped(source, p)) {
      const marker = source[p + 1] === '$' ? '$$' : '$';
      // A solitary currency sign followed by whitespace cannot open inline math.
      if (marker === '$' && /\s/.test(source[p + 1] ?? ' ')) { p += 1; continue; }
      let end = source.indexOf(marker, p + marker.length);
      while (end >= 0 && escaped(source, end)) end = source.indexOf(marker, end + marker.length);
      if (end >= 0 && (marker === '$$' || !source.slice(p, end).includes('\n'))) {
        ranges.push({ from: p, to: end + marker.length });
        p = end + marker.length;
        continue;
      }
    }
    p += 1;
  }
  ranges.sort((a, b) => a.from - b.from || a.to - b.to);
  const merged: SourceRange[] = [];
  for (const range of ranges) {
    const last = merged[merged.length - 1];
    if (last && range.from <= last.to) { last.to = Math.max(last.to, range.to); continue; }
    merged.push({ ...range });
  }
  return merged;
}

/** Only explicit reference block IDs establish a bibliography namespace. */
export function referenceAnchor(id: string): { number: number; namespace: string } | undefined {
  const match = /^(s?ref)-?([1-9]\d{0,8})$/i.exec(id)
    ?? /^((?:s?ref)(?:-[A-Za-z][A-Za-z0-9]*)+)-([1-9]\d{0,8})$/i.exec(id);
  if (!match) return undefined;
  return { number: Number(match[2]), namespace: match[1].toLowerCase() };
}

function rangeAt(offset: number, ranges: SourceRange[]): SourceRange | undefined {
  let low = 0;
  let high = ranges.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (ranges[middle].to <= offset) low = middle + 1;
    else high = middle;
  }
  const range = ranges[low];
  return range && range.from <= offset ? range : undefined;
}

function indentation(text: string): number {
  let width = 0;
  for (const char of text) {
    if (char === ' ') { width += 1; continue; }
    if (char === '\t') { width += 4 - width % 4; continue; }
    break;
  }
  return width;
}

interface EntryPrefix { length: number; indent: number; contentIndent: number }

function entryPrefix(text: string): EntryPrefix | undefined {
  const match = /^[ \t]*(?:(?:\[\d+\]|［\d+］|【\d+】|\(\d+\)|（\d+）|\d+[.)、．])[ \t]*|[-+*][ \t]+)/.exec(text);
  if (!match) return undefined;
  return {
    length: match[0].length,
    indent: indentation(text),
    contentIndent: indentation(match[0].replace(/\S/g, ' '))
  };
}

/** Structural block boundaries, independent of the wording or language of any heading. */
function blockBoundary(text: string): boolean {
  return /^ {0,3}#{1,6}(?:\s|$)/.test(text)
    || /^[ \t]*(?:`{3,}|~{3,})/.test(text)
    || /^ {0,3}(?:(?:\*[ \t]*){3,}|(?:-[ \t]*){3,}|(?:_[ \t]*){3,}|=+)\s*$/.test(text)
    || /(?:^|\s)\^[A-Za-z0-9-]+\s*$/.test(text);
}

/** Locate the paragraph/list item ending at an explicit anchor, never the following text. */
function entryFirstLine(lines: SourceLine[], last: number, floor: number): number | undefined {
  let first = last;
  while (first > floor) {
    const prefix = entryPrefix(lines[first].text);
    if (prefix && prefix.indent <= 3) break;
    const previous = lines[first - 1].text;
    if (!previous.trim() || blockBoundary(previous)) break;
    first -= 1;
  }
  const indent = indentation(lines[first].text);
  if (!indent) return first;
  if (entryPrefix(lines[first].text)?.indent === indent && indent <= 3) return first;

  // A separately spaced, indented continuation can still belong to the previous list item.
  // A true indented code block has no enclosing item, or is indented four extra columns.
  for (let previous = first - 1; previous >= floor; previous -= 1) {
    const text = lines[previous].text;
    if (!text.trim()) continue;
    if (blockBoundary(text)) break;
    const prefix = entryPrefix(text);
    if (prefix && prefix.indent <= 3) {
      if (indent < prefix.contentIndent || indent >= prefix.contentIndent + 4) break;
      const continuation = lines.slice(previous + 1, first).every(line => !line.text.trim() || indentation(line.text) >= prefix.contentIndent);
      if (continuation) return previous;
      break;
    }
    if (indentation(text) < indent) break;
  }
  return indent >= 4 ? undefined : first;
}

/** Parse anchored reference blocks anywhere in the note. Heading text never creates entries. */
export function parseReferences(source: string, lines = sourceLines(source), ignored = ignoredMarkdownRanges(source, lines)): ReferenceIndex {
  const result: ReferenceIndex = {
    entries: new Map(), duplicates: new Set(), sections: [], referenceRanges: [],
    anchors: new Map(), duplicateAnchors: new Set()
  };
  const namespaces = new Map<string, ReferenceSection>();
  let hardIgnored: SourceRange[] | undefined;
  let floor = 0;

  const addNumber = (entry: ReferenceEntry, index: Pick<ReferenceIndex, 'entries' | 'duplicates'>): void => {
    if (index.entries.has(entry.number) || index.duplicates.has(entry.number)) {
      index.duplicates.add(entry.number);
      index.entries.delete(entry.number);
      return;
    }
    index.entries.set(entry.number, entry);
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const match = /(?:^|[ \t])\^([A-Za-z0-9-]+)[ \t]*$/.exec(line.text);
    if (!match) continue;
    const identity = referenceAnchor(match[1]);
    if (!identity) continue;
    const caret = match.index + match[0].indexOf('^');
    const anchorOffset = line.from + caret;
    if (rangeAt(anchorOffset, ignored)) {
      if (indentation(line.text) < 4) continue;
      // Recheck hard exclusions before accepting a list continuation that resembles code.
      hardIgnored ??= ignoredMarkdownRanges(source, lines, false);
      if (rangeAt(anchorOffset, hardIgnored)) continue;
    }
    const standalone = !line.text.slice(0, caret).trim();
    let last = standalone ? i - 1 : i;
    while (last >= floor && !lines[last].text.trim()) last -= 1;
    if (last < floor) continue;
    if (standalone && blockBoundary(lines[last].text)) continue;
    const first = entryFirstLine(lines, last, floor);
    if (first === undefined) continue;
    const from = lines[first].from;
    const raw = source.slice(from, anchorOffset);
    if (!raw.trim()) continue;
    hardIgnored ??= ignoredMarkdownRanges(source, lines, false);
    const contentFrom = from + (raw.match(/^\s*/)?.[0].length ?? 0);
    const contentTo = anchorOffset - (raw.match(/\s*$/)?.[0].length ?? 0);
    const blockedContent = rangeAt(contentFrom, hardIgnored);
    if (blockedContent && blockedContent.to >= contentTo) continue;

    const prefix = entryPrefix(lines[first].text);
    const markdown = raw.slice(prefix?.length ?? 0).replace(/^(?: {1,4}|\t)(?=\S)/gm, '').trim();
    if (!markdown) continue;
    const to = anchorOffset + match[1].length + 1;
    const anchor = `^${match[1]}`;
    const entry: ReferenceEntry = { number: identity.number, markdown, from, to, line: lines[first].line, sectionId: identity.namespace, anchor };
    let section = namespaces.get(identity.namespace);
    if (!section) {
      section = { id: identity.namespace, title: identity.namespace, from, to, entries: new Map(), duplicates: new Set() };
      namespaces.set(identity.namespace, section);
      result.sections.push(section);
    }
    section.to = to;
    addNumber(entry, result);
    addNumber(entry, section);
    if (result.anchors.has(anchor) || result.duplicateAnchors.has(anchor)) {
      result.duplicateAnchors.add(anchor);
      result.anchors.delete(anchor);
    } else {
      result.anchors.set(anchor, entry);
    }
    result.referenceRanges.push({ from, to });
    floor = i + 1;
  }
  return result;
}
