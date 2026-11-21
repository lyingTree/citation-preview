import type { CitationGroup } from './types';

export interface ReadingTrigger {
  element: HTMLElement;
  group: CitationGroup;
  /** Idempotent: remove only this wrapper and preserve every original child. */
  dispose(): void;
}

export interface ReadingOptions {
  /** Used to distinguish a link to this note from an identically numbered other note. */
  sourcePath?: string;
}

interface TextSegment {
  node: Text;
  from: number;
  to: number;
}

interface TextRun {
  text: string;
  segments: TextSegment[];
}

interface Candidate {
  run: TextRun;
  from: number;
  to: number;
  key: string;
  bracketed: boolean;
}

const EXCLUDED = [
  'pre', 'code', 'script', 'style', 'textarea', 'input', 'select', 'button',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'svg', 'math', 'mjx-container',
  '.math', '.math-inline', '.math-block', '.katex', '.MathJax',
  '.internal-embed', '.markdown-embed', '.crp-native-content', '.crp-citation',
  '.callout-title', '[data-crp-ignore]', '[aria-hidden="true"]'
].join(',');

const BLOCK_ELEMENTS = new Set([
  'P', 'LI', 'DIV', 'SECTION', 'ARTICLE', 'BLOCKQUOTE', 'UL', 'OL',
  'TABLE', 'TBODY', 'THEAD', 'TFOOT', 'TR', 'TD', 'TH', 'DL', 'DT', 'DD',
  'FIGURE', 'FIGCAPTION', 'HR', 'BR'
]);

const BRACKETS: Record<string, string> = { '[': ']', '［': '］', '【': '】' };

function signature(label: string): string {
  let text = label.trim();
  const last = BRACKETS[text[0] ?? ''];
  if (last && text.endsWith(last)) text = text.slice(1, -1);
  return text
    .replace(/[０-９]/g, digit => String(digit.charCodeAt(0) - 0xff10))
    .replace(/\s+/g, '')
    .replace(/[–—−－]/g, '-')
    .replace(/[，、;；]/g, ',');
}

/** Keep text flowing through inline elements, but never across paragraphs or excluded content. */
function collectRuns(root: HTMLElement): TextRun[] {
  const result: TextRun[] = [];
  let run: TextRun = { text: '', segments: [] };
  const flush = (): void => {
    if (run.text) result.push(run);
    run = { text: '', segments: [] };
  };
  const visit = (node: Node): void => {
    if (node.nodeType === 3) {
      const text = node as Text;
      if (!text.data) return;
      const from = run.text.length;
      run.text += text.data;
      run.segments.push({ node: text, from, to: run.text.length });
      return;
    }
    if (node.nodeType !== 1) {
      flush();
      return;
    }
    const element = node as HTMLElement;
    if (element.matches(EXCLUDED)) {
      flush();
      return;
    }
    const boundary = BLOCK_ELEMENTS.has(element.tagName);
    if (boundary) flush();
    for (const child of Array.from(element.childNodes)) visit(child);
    if (boundary) flush();
  };
  visit(root);
  flush();
  return result;
}

function candidates(run: TextRun): Candidate[] {
  const result: Candidate[] = [];
  // Source parsing decides what is a citation. Here we only align known source groups with visible text.
  const bracketed = /([[［【])\s*[0-9０-９]+(?:\s*[-–—−－,，、;；]\s*[0-9０-９]+)*\s*([\]］】])/g;
  for (const match of run.text.matchAll(bracketed)) {
    if (BRACKETS[match[1]] !== match[2]) continue;
    const from = match.index;
    result.push({ run, from, to: from + match[0].length, key: signature(match[0]), bracketed: true });
  }
  // Explicit Markdown links can render as 1–10 without outer brackets.
  const bare = /[0-9０-９]+(?:\s*[-–—−－,，、;；]\s*[0-9０-９]+)+/g;
  for (const match of run.text.matchAll(bare)) {
    const from = match.index;
    const to = from + match[0].length;
    if (result.some(candidate => from >= candidate.from && to <= candidate.to)) continue;
    if (/[\p{L}\p{N}_]/u.test(run.text[from - 1] ?? '') || /[\p{L}\p{N}_]/u.test(run.text[to] ?? '')) continue;
    result.push({ run, from, to, key: signature(match[0]), bracketed: false });
  }
  return result.sort((left, right) => left.from - right.from);
}

function normalizeNotePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\.md$/i, '');
}

function isLocalReferenceLink(anchor: HTMLAnchorElement, sourcePath?: string): boolean {
  const target = anchor.getAttribute('data-href') ?? anchor.getAttribute('href') ?? '';
  if (!target || /^[a-z][a-z\d+.-]*:/i.test(target) || target.startsWith('//')) return false;
  const hash = target.indexOf('#');
  if (hash < 0 || hash === target.length - 1) return false;
  const path = target.slice(0, hash);
  if (!path) return true;
  if (!sourcePath) return false;
  let decoded = path;
  try { decoded = decodeURIComponent(path); } catch { return false; }
  const normalized = normalizeNotePath(decoded);
  const current = normalizeNotePath(sourcePath);
  return normalized === current || (!normalized.includes('/') && normalized === current.split('/').pop());
}

function candidateLinks(candidate: Candidate): Set<HTMLAnchorElement> {
  const links = new Set<HTMLAnchorElement>();
  for (const segment of candidate.run.segments) {
    if (segment.to <= candidate.from || segment.from >= candidate.to) continue;
    const anchor = segment.node.parentElement?.closest('a');
    if (anchor) links.add(anchor);
  }
  return links;
}

/**
 * Expand whole-element edge selections so surroundContents never clones an existing link.
 * A partial inline-element selection is skipped instead of splitting somebody else's markup.
 */
function safeRange(candidate: Candidate, document: Document): Range | null {
  const start = candidate.run.segments.find(segment => segment.from <= candidate.from && segment.to > candidate.from);
  const end = candidate.run.segments.find(segment => segment.from < candidate.to && segment.to >= candidate.to);
  if (!start || !end) return null;
  const startOffset = candidate.from - start.from;
  const endOffset = candidate.to - end.from;
  if (startOffset > start.node.length || endOffset > end.node.length) return null;
  const range = document.createRange();
  range.setStart(start.node, startOffset);
  range.setEnd(end.node, endOffset);
  const common = range.commonAncestorContainer;
  if (common.nodeType === 3) return range;

  if (startOffset === 0) {
    let edge: Node = start.node;
    while (edge.parentNode && edge.parentNode !== common && !edge.previousSibling) edge = edge.parentNode;
    range.setStartBefore(edge);
  }
  if (endOffset === end.node.length) {
    let edge: Node = end.node;
    while (edge.parentNode && edge.parentNode !== common && !edge.nextSibling) edge = edge.parentNode;
    range.setEndAfter(edge);
  }
  const safeBoundary = (node: Node): boolean => node === common || (node.nodeType === 3 && node.parentNode === common);
  if (!safeBoundary(range.startContainer) || !safeBoundary(range.endContainer)) return null;
  return range;
}

/**
 * Decorate only groups belonging to this rendered Markdown section. The caller must filter
 * source groups with MarkdownPostProcessorContext.getSectionInfo; global groups are ambiguous.
 * This function never changes Markdown and never replaces existing anchors or their listeners.
 */
export function decorateReadingCitations(
  root: HTMLElement,
  groups: CitationGroup[],
  options: ReadingOptions = {}
): ReadingTrigger[] {
  if (!groups.length || root.closest(EXCLUDED)) return [];
  const available = new Map<string, CitationGroup[]>();
  for (const group of [...groups].sort((left, right) => left.from - right.from)) {
    const key = signature(group.label);
    const bucket = available.get(key) ?? [];
    bucket.push(group);
    available.set(key, bucket);
  }
  const plans: Array<{ candidate: Candidate; group: CitationGroup }> = [];
  for (const run of collectRuns(root)) {
    for (const candidate of candidates(run)) {
      const bucket = available.get(candidate.key);
      if (!bucket?.length) continue;
      const links = candidateLinks(candidate);
      const localLinks = links.size > 0 && Array.from(links).every(link => isLocalReferenceLink(link, options.sourcePath));
      const match = bucket.findIndex(group => group.linked ? localLinks : candidate.bracketed && links.size === 0);
      if (match < 0) continue;
      const group = bucket.splice(match, 1)[0];
      plans.push({ candidate, group });
    }
  }

  const triggers: ReadingTrigger[] = [];
  // Later offsets are modified first so an earlier range's original Text node still exists.
  for (const { candidate, group } of plans.reverse()) {
    const range = safeRange(candidate, root.ownerDocument);
    if (!range) continue;
    const wrapper = root.ownerDocument.createElement('span');
    wrapper.className = 'crp-citation';
    wrapper.setAttribute('tabindex', '0');
    wrapper.setAttribute('role', 'group');
    wrapper.setAttribute('aria-label', `Preview references ${group.label}`);
    wrapper.setAttribute('data-crp-label', group.label);
    try {
      range.surroundContents(wrapper);
    } catch {
      // Unusual plugin-rendered inline structures are safer to leave untouched.
      continue;
    }
    let disposed = false;
    triggers.push({
      element: wrapper,
      group,
      dispose(): void {
        if (disposed) return;
        disposed = true;
        const parent = wrapper.parentNode;
        if (!parent) return;
        const fragment = root.ownerDocument.createDocumentFragment();
        while (wrapper.firstChild) fragment.appendChild(wrapper.firstChild);
        parent.replaceChild(fragment, wrapper);
      }
    });
  }
  return triggers.reverse();
}
