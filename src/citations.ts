import { ignoredMarkdownRanges } from './bibliography';
import { localLinkAnchor } from './links';
import { headingPathAt, nearestReferenceList } from './reference-lists';
import type { CitationGroup, ParseOptions, ReferenceIndex } from './types';

interface NumberToken {
  number: number;
  from: number;
  labelTo: number;
  to: number;
  linked: boolean;
  valid: boolean;
  scopeId?: string;
  target?: string;
}
interface Parts { tokens: NumberToken[]; separators: string[]; separatorRanges: Array<{ from: number; to: number }>; to: number }

function positiveInteger(text: string): number | undefined {
  if (!/^[1-9]\d{0,8}$/.test(text)) return undefined;
  const value = Number(text);
  return Number.isSafeInteger(value) ? value : undefined;
}

function localReferenceLink(target: string, number: number | undefined, index: ReferenceIndex, sourcePath?: string): Pick<NumberToken, 'valid' | 'scopeId' | 'target'> {
  const anchor = localLinkAnchor(target, sourcePath);
  if (!anchor || index.duplicateAnchors.has(anchor)) return { valid: false };
  const entry = index.anchors.get(anchor);
  // A plausible suffix is not evidence that a link points to a bibliography entry.
  // Exact anchors also support supplementary and user-defined naming conventions.
  if (!entry || (number !== undefined && entry.number !== number)) return { valid: false };
  return { valid: true, scopeId: entry.sectionId, target: anchor };
}

/** Read a Markdown link destination with bounded, balanced parentheses. */
function destinationAt(source: string, open: number): { target: string; to: number } | undefined {
  if (source[open] !== '(') return undefined;
  let depth = 1;
  const limit = Math.min(source.length, open + 2048);
  for (let p = open + 1; p < limit; p += 1) {
    const char = source[p];
    if (char === '\n' || char === '\r') return undefined;
    if (char === '\\') { p += 1; continue; }
    if (char === '(') depth += 1;
    if (depth > 8) return undefined;
    if (char !== ')') continue;
    depth -= 1;
    if (depth) continue;
    const value = source.slice(open + 1, p).trim();
    if (value.startsWith('<')) {
      const close = value.indexOf('>');
      if (close < 0) return undefined;
      return { target: value.slice(1, close), to: p + 1 };
    }
    return { target: value.split(/\s/, 1)[0], to: p + 1 };
  }
  return undefined;
}

function readToken(source: string, from: number, index: ReferenceIndex, options: ParseOptions): NumberToken | undefined {
  if (source.startsWith('[[', from)) {
    const relativeEnd = source.slice(from + 2, from + 2050).indexOf(']]');
    if (relativeEnd < 0) return undefined;
    const end = relativeEnd + from + 2;
    const body = source.slice(from + 2, end);
    const divider = body.lastIndexOf('|');
    if (divider < 0) return undefined;
    const number = positiveInteger(body.slice(divider + 1).trim());
    if (!number) return undefined;
    const labelFrom = from + 2 + divider + 1 + (body.slice(divider + 1).match(/^\s*/)?.[0].length ?? 0);
    return { number, from: labelFrom, labelTo: labelFrom + String(number).length, to: end + 2, linked: true, ...localReferenceLink(body.slice(0, divider), number, index, options.sourcePath) };
  }
  const linkLabel = /^\[([1-9]\d{0,8})\]/.exec(source.slice(from, from + 12));
  if (linkLabel) {
    const destination = destinationAt(source, from + linkLabel[0].length);
    if (!destination) return undefined;
    const number = Number(linkLabel[1]);
    return { number, from: from + 1, labelTo: from + 1 + linkLabel[1].length, to: destination.to, linked: true, ...localReferenceLink(destination.target, number, index, options.sourcePath) };
  }
  const digits = /^[1-9]\d{0,8}/.exec(source.slice(from, from + 10));
  if (!digits || /\d/.test(source[from + digits[0].length] ?? '')) return undefined;
  return { number: Number(digits[0]), from, labelTo: from + digits[0].length, to: from + digits[0].length, linked: false, valid: true };
}

function skipSpace(source: string, from: number): number {
  let p = from;
  while (source[p] === ' ' || source[p] === '\t' || source[p] === '\u00a0') p += 1;
  return p;
}

function readParts(source: string, from: number, index: ReferenceIndex, options: ParseOptions): Parts | undefined {
  const tokens: NumberToken[] = [];
  const separators: string[] = [];
  const separatorRanges: Array<{ from: number; to: number }> = [];
  let p = skipSpace(source, from);
  for (let count = 0; count <= options.maxReferences * 2; count += 1) {
    const token = readToken(source, p, index, options);
    if (!token) return undefined;
    tokens.push(token);
    p = skipSpace(source, token.to);
    const separator = source[p];
    if (!separator || !/[-–—−－,，;；、]/.test(separator)) return { tokens, separators, separatorRanges, to: p };
    separators.push(separator);
    separatorRanges.push({ from: p, to: p + 1 });
    p = skipSpace(source, p + 1);
  }
  return undefined;
}

function expand(parts: Parts, cap: number): number[] | undefined {
  const values: number[] = [];
  const seen = new Set<number>();
  for (let i = 0; i < parts.tokens.length; i += 1) {
    const first = parts.tokens[i].number;
    let last = first;
    if (/[-–—−－]/.test(parts.separators[i] ?? '')) {
      if (i > 0 && /[-–—−－]/.test(parts.separators[i - 1])) return undefined;
      const next = parts.tokens[i + 1];
      if (!next || /[-–—−－]/.test(parts.separators[i + 1] ?? '')) return undefined;
      last = next.number;
      if (last < first || last - first + 1 > cap) return undefined;
      i += 1;
    }
    for (let number = first; number <= last; number += 1) {
      if (seen.has(number)) continue;
      if (values.length >= cap) return undefined;
      seen.add(number);
      values.push(number);
    }
  }
  return values;
}

function groupFromParts(parts: Parts, from: number, to: number, index: ReferenceIndex, options: ParseOptions, outerLinkTarget?: string): CitationGroup | undefined {
  if (parts.tokens.some(token => !token.valid)) return undefined;
  const linked = outerLinkTarget !== undefined || parts.tokens.some(token => token.linked);
  if (!linked && !options.recognizePlainText) return undefined;
  const numbers = expand(parts, options.maxReferences);
  if (!numbers?.length) return undefined;
  const scopes = new Set(parts.tokens.flatMap(token => token.scopeId ? [token.scopeId] : []));
  // A range has no defined intermediate entries when its endpoints belong to different bibliographies.
  if (scopes.size > 1) return undefined;
  let scopeId = scopes.values().next().value;
  let ambiguousScope = false;
  if (!scopeId) {
    const nearest = !linked && index.lists?.length
      ? nearestReferenceList(index.lists, from, to, headingPathAt(index.headingScopes ?? [], from)) : undefined;
    if (nearest) {
      if (!parts.tokens.some(token => nearest.entries.has(token.number) || nearest.duplicates.has(token.number))) return undefined;
      scopeId = nearest.id;
    } else {
      const endpoints = parts.tokens.filter(token => index.entries.has(token.number) || index.duplicates.has(token.number));
      if (!endpoints.length) return undefined;
      const candidates = index.sections.filter(section => endpoints.every(token => section.entries.has(token.number) || section.duplicates.has(token.number)));
      if (!candidates.length) return undefined;
      if (candidates.length === 1) scopeId = candidates[0].id;
      else ambiguousScope = true;
    }
  }
  const label = `[${parts.tokens.map((token, i) => `${token.number}${parts.separators[i] ? (/[-–—−－]/.test(parts.separators[i]) ? '–' : ', ') : ''}`).join('')}]`;
  return { from, to, label, numbers, linked, scopeId, ambiguousScope,
    linkTargets: parts.tokens.flatMap(token => token.target ? [token.target] : []), outerLinkTarget,
    tokens: parts.tokens.map(token => ({ number: token.number, from: token.from, to: token.labelTo,
      linked: !!outerLinkTarget || token.linked, target: outerLinkTarget ?? token.target })),
    visibleRanges: [...parts.tokens.map(token => ({ from: token.from, to: token.labelTo })), ...parts.separatorRanges]
      .sort((left, right) => left.from - right.from) };
}

function bracketGroup(source: string, from: number, index: ReferenceIndex, options: ParseOptions): CitationGroup | undefined {
  const escapedOpen = source.startsWith('\\[', from);
  if (!escapedOpen && source[from] !== '[') return undefined;
  const parts = readParts(source, from + (escapedOpen ? 2 : 1), index, options);
  if (!parts) return undefined;
  let to = parts.to;
  const closeFrom = to + (source.startsWith('\\]', to) ? 1 : 0);
  if (source.startsWith('\\]', to)) to += 2;
  else if (source[to] === ']') to += 1;
  else return undefined;
  if (source[to] === '[') return undefined; // Markdown reference-style links are not numeric citations.
  let outerLinkTarget: string | undefined;
  if (source[to] === '(') {
    const destination = destinationAt(source, to);
    if (!destination) return undefined;
    const resolution = localReferenceLink(destination.target, parts.tokens.length > 1 ? undefined : parts.tokens[0].number, index, options.sourcePath);
    if (!resolution.valid) return undefined;
    parts.tokens[0] = { ...parts.tokens[0], ...resolution, linked: true };
    outerLinkTarget = resolution.target;
    to = destination.to;
  }
  const group = groupFromParts(parts, from, to, index, options, outerLinkTarget);
  if (group && !outerLinkTarget) {
    group.visibleRanges!.unshift({ from: from + (escapedOpen ? 1 : 0), to: from + (escapedOpen ? 2 : 1) });
    group.visibleRanges!.push({ from: closeFrom, to: closeFrom + 1 });
  }
  return group;
}

function unbracketedLinks(source: string, from: number, index: ReferenceIndex, options: ParseOptions): CitationGroup | undefined {
  const parts = readParts(source, from, index, options);
  if (!parts || parts.tokens.length < 2 || parts.tokens.some(token => !token.linked)) return undefined;
  return groupFromParts(parts, from, parts.tokens[parts.tokens.length - 1].to, index, options);
}

function maskRange(chars: string[], from: number, to: number): void {
  for (let p = from; p < to; p += 1) chars[p] = ' ';
}

/** Used in editor mode and reading-mode tests; all offsets refer to the raw source. */
export function findCitationGroups(source: string, index: ReferenceIndex, options: ParseOptions, ignored = ignoredMarkdownRanges(source)): CitationGroup[] {
  if ((!index.entries.size && !index.duplicates.size && !index.lists?.length) || !Number.isFinite(options.maxReferences) || options.maxReferences < 1) return [];
  const boundedOptions = { ...options, maxReferences: Math.min(1000, Math.floor(options.maxReferences)) };
  const chars = source.split('');
  for (const range of [...ignored, ...index.referenceRanges, ...(index.lists?.flatMap(list => list.items) ?? [])]) maskRange(chars, range.from, range.to);
  // A Markdown link can wrap its destination in angle brackets, including local block links.
  // Preserve those destinations while masking HTML attributes and raw code containers.
  const markup = /\]\([ \t]*<[^<>\r\n]*>(?=[ \t]*(?:\)|["'(]))|<(pre|code|script|style)\b[^>]*>[\s\S]*?<\/\1\s*>|<[^>\n]*>/gi;
  for (const match of source.matchAll(markup)) {
    if (match[0].startsWith('](')) continue;
    maskRange(chars, match.index, match.index + match[0].length);
  }
  const visibleSource = chars.join('');
  const groups: CitationGroup[] = [];
  // Both cursors only move forward. In particular, a line of unmatched opening
  // brackets is skipped once instead of retrying link parsing at every bracket.
  let nextClosingBracket = visibleSource.indexOf(']');
  let lineEnd = -1;
  for (let p = 0; p < visibleSource.length;) {
    if (visibleSource[p] !== '[' && !visibleSource.startsWith('\\[', p)) { p += 1; continue; }
    if (nextClosingBracket < p) nextClosingBracket = visibleSource.indexOf(']', p);
    if (nextClosingBracket < 0) break;
    if (p > lineEnd) {
      const newline = visibleSource.indexOf('\n', p);
      lineEnd = newline < 0 ? visibleSource.length : newline;
    }
    if (nextClosingBracket > lineEnd) { p = lineEnd + 1; continue; }
    if (p > 0 && visibleSource[p - 1] === '!') {
      // Do not reinterpret an image's alt text or an embedded note.
      const relativeClose = visibleSource.slice(p + 1, p + 4097).indexOf(']');
      const close = relativeClose < 0 ? -1 : p + 1 + relativeClose;
      const destination = close >= 0 ? destinationAt(visibleSource, close + 1) : undefined;
      p = destination?.to ?? (close >= 0 ? close + 1 : p + 1);
      continue;
    }
    const initialLink = readToken(visibleSource, p, index, boundedOptions);
    if (initialLink?.linked) {
      const chain = readParts(visibleSource, p, index, boundedOptions);
      if (chain && chain.tokens.length > 1 && chain.tokens.every(token => token.linked)) {
        const group = unbracketedLinks(visibleSource, p, index, boundedOptions);
        if (group) groups.push(group);
        p = chain.to;
        continue;
      }
      if (chain?.tokens.length === 1 && visibleSource.startsWith('[[', p)) {
        const group = groupFromParts(chain, p, chain.to, index, boundedOptions);
        if (group) groups.push(group);
        p = chain.to;
        continue;
      }
    }
    const group = bracketGroup(visibleSource, p, index, boundedOptions);
    if (group) {
      groups.push(group);
      p = group.to;
      continue;
    }
    // A failed link must be consumed whole: its numeric label is not a fallback citation.
    const token = readToken(visibleSource, p, index, boundedOptions);
    if (token?.linked) { p = token.to; continue; }
    const openingWidth = visibleSource.startsWith('\\[', p) ? 2 : 1;
    const rejected = readParts(visibleSource, p + openingWidth, index, boundedOptions);
    if (rejected && (visibleSource[rejected.to] === ']' || visibleSource.startsWith('\\]', rejected.to))) {
      const close = rejected.to + (visibleSource.startsWith('\\]', rejected.to) ? 2 : 1);
      p = destinationAt(visibleSource, close)?.to ?? close;
      continue;
    }
    if (visibleSource.startsWith('[[', p)) {
      const relativeClose = visibleSource.slice(p + 2, p + 2050).indexOf(']]');
      if (relativeClose >= 0) { p += relativeClose + 4; continue; }
    }
    const relativeClose = visibleSource.slice(p + 1, p + 4097).indexOf(']');
    const close = relativeClose < 0 ? -1 : p + 1 + relativeClose;
    if (close >= 0 && !visibleSource.slice(p, close).includes('\n')) {
      const destination = destinationAt(visibleSource, close + 1);
      if (destination) { p = destination.to; continue; }
    }
    p += visibleSource.startsWith('\\[', p) ? 2 : 1;
  }
  return groups;
}
