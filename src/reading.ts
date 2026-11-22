import type { CitationGroup, PluginSettings } from './types';
import type { CitationDocument } from './model';
import { localLinkAnchor } from './links';
import { usesNativeSinglePreview } from './citation-state';

export interface ReadingTrigger {
  element: HTMLElement;
  group: CitationGroup;
  /** Refresh resolution and virtual links without replacing existing native anchors. */
  update(model: CitationDocument, group: CitationGroup | undefined): void;
  /** Idempotent: remove only this wrapper and preserve every original child. */
  dispose(): void;
}

export interface ReadingOptions {
  /** Used to distinguish a link to this note from an identically numbered other note. */
  sourcePath?: string;
  model?: CitationDocument;
  settings?: Pick<PluginSettings, 'citationLinks' | 'citationColor'>;
  onNavigate?(model: CitationDocument, group: CitationGroup, number: number, event: MouseEvent | KeyboardEvent): boolean | void;
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
  // Explicit Markdown links can render as 1 or 1–10 without outer brackets.
  // Plain source groups still require visible brackets when matching below.
  const bracketedCandidates = [...result];
  let bracketIndex = 0;
  const bare = /[0-9０-９]+(?:\s*[-–—−－,，、;；]\s*[0-9０-９]+)*/g;
  for (const match of run.text.matchAll(bare)) {
    const from = match.index;
    const to = from + match[0].length;
    while (bracketIndex < bracketedCandidates.length && bracketedCandidates[bracketIndex].to <= from) bracketIndex += 1;
    const enclosing = bracketedCandidates[bracketIndex];
    if (enclosing && from >= enclosing.from && to <= enclosing.to) continue;
    if (/[\p{L}\p{N}_]/u.test(run.text[from - 1] ?? '') || /[\p{L}\p{N}_]/u.test(run.text[to] ?? '')) continue;
    result.push({ run, from, to, key: signature(match[0]), bracketed: false });
  }
  return result.sort((left, right) => left.from - right.from);
}

function referenceAnchor(anchor: HTMLAnchorElement, sourcePath?: string): string | undefined {
  const target = anchor.getAttribute('data-href') ?? anchor.getAttribute('href') ?? '';
  return localLinkAnchor(target, sourcePath);
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

function unwrap(element: HTMLElement): void {
  const parent = element.parentNode;
  if (!parent) return;
  const fragment = element.ownerDocument.createDocumentFragment();
  while (element.firstChild) fragment.appendChild(element.firstChild);
  parent.replaceChild(fragment, element);
}

/** Read only the visible text; an enclosing native link always keeps its original target. */
function visibleRun(root: HTMLElement): TextRun {
  const run: TextRun = { text: '', segments: [] };
  const walker = root.ownerDocument.createTreeWalker(root, 4 /* SHOW_TEXT */);
  let node: Node | null;
  while ((node = walker.nextNode())) {
    const text = node as Text;
    const from = run.text.length;
    run.text += text.data;
    run.segments.push({ node: text, from, to: run.text.length });
  }
  return run;
}

/** Add links only to displayed number tokens, never to expanded, deduplicated preview numbers. */
function numberRanges(root: HTMLElement, group: CitationGroup): Array<{ candidate: Candidate; number: number }> {
  if (root.closest('a')) return [];
  const run = visibleRun(root);
  const matches = Array.from(run.text.matchAll(/[0-9０-９]+/g));
  const numbers = matches.map(match => Number(signature(match[0])));
  const expected = group.tokens?.map(token => token.number)
    ?? Array.from(group.label.matchAll(/\d+/g), match => Number(match[0]));
  if (numbers.length !== expected.length || numbers.some((number, index) => number !== expected[index])) return [];
  return matches.flatMap((match, index) => {
    const candidate: Candidate = {
      run, from: match.index, to: match.index + match[0].length,
      key: match[0], bracketed: false
    };
    if (candidateLinks(candidate).size) return [];
    return [{ candidate, number: numbers[index] }];
  });
}

function createTrigger(wrapper: HTMLElement, initialGroup: CitationGroup, options: ReadingOptions): ReadingTrigger {
  let currentModel = options.model;
  let currentGroup: CitationGroup | undefined = initialGroup;
  let disposed = false;
  const generated: Array<{ element: HTMLAnchorElement; dispose(): void }> = [];

  const removeLinks = (): void => {
    for (const link of generated.splice(0)) {
      link.dispose();
      unwrap(link.element);
    }
  };

  const refresh = (): void => {
    removeLinks();
    const nativeSingle = currentGroup && usesNativeSinglePreview(currentGroup);
    wrapper.classList.toggle('crp-native-citation', !!nativeSingle);
    if (currentGroup && !nativeSingle) {
      wrapper.setAttribute('tabindex', '0');
      wrapper.setAttribute('role', 'group');
      wrapper.setAttribute('aria-label', `Preview references ${currentGroup.label}`);
    } else {
      wrapper.removeAttribute('tabindex');
      wrapper.removeAttribute('role');
      wrapper.removeAttribute('aria-label');
    }
    const resolved = !!currentModel && !!currentGroup && currentModel.isResolved(currentGroup);
    const enabled = options.settings?.citationLinks ?? true;
    wrapper.classList.toggle('crp-resolved', enabled && resolved);
    wrapper.classList.toggle('crp-link-blue', enabled && resolved && options.settings?.citationColor !== 'theme');
    wrapper.classList.toggle('crp-link-theme', enabled && resolved && options.settings?.citationColor === 'theme');
    if (!enabled || !resolved || !currentModel || !currentGroup || !options.onNavigate) return;

    for (const { candidate, number } of numberRanges(wrapper, currentGroup).reverse()) {
      const reference = currentModel.reference(currentGroup, number);
      if (!reference) continue;
      const range = safeRange(candidate, wrapper.ownerDocument);
      if (!range) continue;
      const link = wrapper.ownerDocument.createElement('a');
      const href = reference.anchor ? `#${reference.anchor}` : currentModel.sourcePath;
      link.className = 'crp-reference-link';
      link.setAttribute('href', href);
      link.setAttribute('data-href', href);
      link.setAttribute('data-crp-number', String(number));
      link.setAttribute('aria-label', `Reference ${number}`);
      try {
        range.surroundContents(link);
      } catch {
        continue;
      }
      const navigate = (event: MouseEvent | KeyboardEvent): void => {
        if (event.type === 'keydown' && (event as KeyboardEvent).key !== 'Enter') return;
        if (event.type === 'click' && (event as MouseEvent).button !== 0) return;
        if (event.type === 'auxclick' && (event as MouseEvent).button !== 1) return;
        // Synthetic links are owned by this plugin, including keyboard and new-pane activation.
        event.preventDefault();
        event.stopPropagation();
        if (currentModel && currentGroup) options.onNavigate?.(currentModel, currentGroup, number, event);
      };
      link.addEventListener('click', navigate);
      link.addEventListener('auxclick', navigate);
      link.addEventListener('keydown', navigate);
      generated.push({ element: link, dispose: () => {
        link.removeEventListener('click', navigate);
        link.removeEventListener('auxclick', navigate);
        link.removeEventListener('keydown', navigate);
      } });
    }
  };

  refresh();
  return {
    element: wrapper,
    group: initialGroup,
    update(model, group): void {
      if (disposed) return;
      currentModel = model;
      currentGroup = group;
      refresh();
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      removeLinks();
      unwrap(wrapper);
    }
  };
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
      const targets = Array.from(links, link => referenceAnchor(link, options.sourcePath));
      const localLinks = targets.length > 0 && targets.every(target => target !== undefined);
      const match = bucket.findIndex(group => {
        if (!group.linked) return candidate.bracketed && links.size === 0;
        if (!localLinks) return false;
        if (!group.linkTargets) return true;
        return group.linkTargets.length === targets.length
          && group.linkTargets.every((target, index) => target === targets[index]);
      });
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
    wrapper.setAttribute('data-crp-label', group.label);
    try {
      range.surroundContents(wrapper);
    } catch {
      // Unusual plugin-rendered inline structures are safer to leave untouched.
      continue;
    }
    triggers.push(createTrigger(wrapper, group, options));
  }
  return triggers.reverse();
}
