import type { ReferenceEntry, ReferenceIndex } from './types';

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
export function ignoredMarkdownRanges(source: string, lines = sourceLines(source)): SourceRange[] {
  const ranges: SourceRange[] = [];
  let fenced: { marker: string; length: number; from: number } | undefined;
  let frontmatterEnd = 0;
  if (lines[0]?.text.replace(/^\uFEFF/, '').trim() === '---') {
    const close = lines.findIndex((line, i) => i > 0 && /^(?:---|\.\.\.)\s*$/.test(line.text));
    frontmatterEnd = close < 0 ? source.length : lines[close].to;
    ranges.push({ from: 0, to: frontmatterEnd });
  }
  for (const line of lines) {
    if (line.from < frontmatterEnd) continue;
    const fence = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line.text);
    if (fenced) {
      if (fence && fence[1][0] === fenced.marker && fence[1].length >= fenced.length && !fence[2].trim()) {
        ranges.push({ from: fenced.from, to: line.to });
        fenced = undefined;
      }
      continue;
    }
    if (fence) {
      if (fence[1][0] === '`' && fence[2].includes('`')) continue;
      fenced = { marker: fence[1][0], length: fence[1].length, from: line.from };
      continue;
    }
    if (/^(?: {4}|\t)/.test(line.text)) ranges.push({ from: line.from, to: line.to });
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

function heading(text: string): { level: number; title: string } | undefined {
  const match = /^ {0,3}(#{1,6})\s+(.+?)\s*#*\s*$/.exec(text);
  if (!match) return undefined;
  return { level: match[1].length, title: match[2] };
}

function isBibliographyTitle(title: string): boolean {
  const normalized = title
    .replace(/[*_]/g, '')
    .replace(/^(?:\d+(?:\.\d+)*[.)、]?\s+|第[一二三四五六七八九十百\d]+[章节]\s*)/, '')
    .replace(/[：:]\s*$/, '')
    .trim();
  return /^(?:references|bibliography|literature\s+cited|works\s+cited|参考文献|參考文獻|参考资料|參考資料)$/i.test(normalized);
}

const EMPTY_ANCHOR = /<a\s+[^>]*\b(?:id|name)\s*=\s*(?:"([^"]+)"|'([^']+)')[^>]*>\s*<\/a\s*>/gi;

function anchorFrom(text: string): string | undefined {
  const block = /(?:^|\s)\^([A-Za-z0-9-]+)\s*$/m.exec(text);
  if (block) return `^${block[1]}`;
  const anchor = /<a\s+[^>]*\b(?:id|name)\s*=\s*(?:"([^"]+)"|'([^']+)')[^>]*>/i.exec(text);
  return anchor?.[1] ?? anchor?.[2];
}

interface EntryStart { number: number; prefix: number; heading?: string; anchor?: string }

function entryStart(text: string): EntryStart | undefined {
  // HTML anchors may occur immediately before the reference label.
  const anchorPrefix = /^(?:\s*<a\s+[^>]*\b(?:id|name)\s*=\s*(?:"[^"]+"|'[^']+')[^>]*>\s*<\/a\s*>\s*)*/i.exec(text)?.[0] ?? '';
  const tail = text.slice(anchorPrefix.length);
  const h = heading(tail);
  const value = h ? h.title : tail;
  const numbered = /^\s*(?:\[(\d+)\]|［(\d+)］|【(\d+)】|\((\d+)\)|（(\d+)）|(\d+)[.)、．])(?:\s*|$)/.exec(value);
  const bareHeading = h ? /^\s*(\d+)\s*$/.exec(value) : null;
  const digits = numbered ? numbered.slice(1).find(Boolean) : bareHeading?.[1];
  if (!digits) return undefined;
  const number = Number(digits);
  if (!Number.isSafeInteger(number) || number < 1) return undefined;
  const markerLength = numbered?.[0].length ?? value.length;
  const prefix = anchorPrefix.length + (h ? tail.indexOf(h.title) : 0) + markerLength;
  return { number, prefix, heading: h?.title, anchor: anchorFrom(anchorPrefix) };
}

function stripEntrySyntax(raw: string, start: EntryStart): string {
  let text = raw.slice(start.prefix);
  text = text.replace(EMPTY_ANCHOR, '').replace(/(?:^|\s)\^[A-Za-z0-9-]+\s*$/gm, '');
  // Reference continuations commonly indent their wrapped lines.
  return text.replace(/^ {1,4}(?=\S)/gm, '').trim();
}

/** Parse only explicit bibliography sections; never derive references from body numbers. */
export function parseReferences(source: string, lines = sourceLines(source), ignored = ignoredMarkdownRanges(source, lines)): ReferenceIndex {
  const result: ReferenceIndex = { entries: new Map(), duplicates: new Set(), sections: [] };
  let blocked = 0;
  const isIgnored = (offset: number): boolean => {
    while (blocked < ignored.length && ignored[blocked].to <= offset) blocked += 1;
    return !!ignored[blocked] && ignored[blocked].from <= offset && offset < ignored[blocked].to;
  };
  let section: { from: number; level: number } | undefined;
  let current: { line: SourceLine; start: EntryStart; from: number; prefixAnchor?: string } | undefined;
  let precedingAnchor: { from: number; text: string } | undefined;

  const finishEntry = (to: number): void => {
    if (!current) return;
    const { line, start, from, prefixAnchor = '' } = current;
    const raw = source.slice(line.from, to);
    const markdown = stripEntrySyntax(raw, start);
    const entry: ReferenceEntry = {
      number: start.number,
      markdown,
      from,
      to: to - (source.slice(from, to).match(/\s*$/)?.[0].length ?? 0),
      line: line.line,
      anchor: anchorFrom(prefixAnchor + raw) ?? start.anchor ?? start.heading
    };
    if (result.entries.has(entry.number) || result.duplicates.has(entry.number)) {
      result.duplicates.add(entry.number);
      result.entries.delete(entry.number);
    } else {
      result.entries.set(entry.number, entry);
    }
    current = undefined;
  };
  const finishSection = (to: number): void => {
    if (!section) return;
    finishEntry(to);
    result.sections.push({ from: section.from, to });
    section = undefined;
    precedingAnchor = undefined;
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (isIgnored(line.from)) continue;
    const h = heading(line.text);
    const setext = lines[i + 1] && /^ {0,3}(?:=+|-+)\s*$/.test(lines[i + 1].text);
    const title = h?.title ?? line.text.trim();
    const isTitle = isBibliographyTitle(title);
    if (isTitle) {
      finishSection(line.from);
      section = { from: line.from, level: h?.level ?? (setext && lines[i + 1].text.trim()[0] === '-' ? 2 : 1) };
      if (setext && !h) i += 1;
      continue;
    }
    if (!section) continue;
    const start = entryStart(line.text);
    if (h && h.level <= section.level && !start) { finishSection(line.from); continue; }
    if (start) {
      const from = precedingAnchor?.from ?? line.from;
      finishEntry(from);
      current = { line, start, from, prefixAnchor: precedingAnchor?.text };
      precedingAnchor = undefined;
      // A preceding anchor belongs to this entry, not the previous one.
      continue;
    }
    const anchorOnly = line.text.trim().replace(EMPTY_ANCHOR, '').trim() === '' && /<a\s/i.test(line.text);
    if (anchorOnly) {
      finishEntry(line.from);
      precedingAnchor = { from: line.from, text: line.text };
      continue;
    }
    if (line.text.trim()) precedingAnchor = undefined;
  }
  finishSection(source.length);
  return result;
}
