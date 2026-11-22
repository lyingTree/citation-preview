// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { decorateReadingCitations } from '../src/reading';
import { CitationDocument } from '../src/model';
import { DEFAULT_SETTINGS } from '../src/types';
import type { CitationGroup } from '../src/types';

function group(label = '[1–10]', linked = false, from = 0): CitationGroup {
  return { from, to: from + label.length, label, numbers: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], linked };
}

function fixture(html: string): HTMLElement {
  const root = document.createElement('div');
  // Test fixtures below are fixed strings owned by this test suite, never note or user content.
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  root.append(...Array.from(parsed.body.childNodes));
  return root;
}

describe('reading view citation decoration', () => {
  it('wraps the complete visible range and preserves surrounding text', () => {
    const root = fixture('<p>Evidence [1–10] supports this result.</p>');
    const original = root.textContent;
    const triggers = decorateReadingCitations(root, [group()]);
    expect(triggers).toHaveLength(1);
    expect(triggers[0].element.textContent).toBe('[1–10]');
    expect(triggers[0].element.getAttribute('tabindex')).toBe('0');
    expect(root.textContent).toBe(original);
    triggers[0].dispose();
    triggers[0].dispose();
    expect(root.querySelector('.crp-citation')).toBeNull();
    expect(root.textContent).toBe(original);
  });

  it('moves actual endpoint links without cloning them or losing their click listeners', () => {
    const root = fixture('<p>See [<a href="#ref-1">1</a>–<a href="#ref-10">10</a>].</p>');
    const anchors = Array.from(root.querySelectorAll('a'));
    const clicked = vi.fn();
    anchors[0].addEventListener('click', clicked);
    const triggers = decorateReadingCitations(root, [group('[1–10]', true)]);
    expect(triggers).toHaveLength(1);
    expect(Array.from(triggers[0].element.querySelectorAll('a'))).toEqual(anchors);
    anchors[0].dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(clicked).toHaveBeenCalledOnce();
    triggers[0].dispose();
    expect(Array.from(root.querySelectorAll('a'))).toEqual(anchors);
    expect(root.textContent).toBe('See [1–10].');
  });

  it('preserves nested superscript and complete inline formatting', () => {
    const root = fixture('<p>Result<sup>[<em><a href="#^ref-1">1</a></em>–<strong><a href="#^ref-10">10</a></strong>]</sup>.</p>');
    const sup = root.querySelector('sup');
    const emphasis = root.querySelector('em');
    const triggers = decorateReadingCitations(root, [group('[1–10]', true)]);
    expect(triggers).toHaveLength(1);
    expect(triggers[0].element.parentElement).toBe(sup);
    expect(triggers[0].element.querySelector('em')).toBe(emphasis);
    triggers[0].dispose();
    expect(root.querySelector('em')).toBe(emphasis);
  });

  it('aligns multiple ranges in the same text node and disposes in either order', () => {
    const root = fixture('<p>Early [1–10], late [2–4], repeated [1–10].</p>');
    const groups = [group('[1–10]', false, 6), group('[2–4]', false, 20), group('[1–10]', false, 36)];
    const triggers = decorateReadingCitations(root, groups);
    expect(triggers.map(trigger => trigger.group.from)).toEqual([6, 20, 36]);
    triggers[1].dispose();
    triggers[0].dispose();
    triggers[2].dispose();
    expect(root.textContent).toBe('Early [1–10], late [2–4], repeated [1–10].');
  });

  it('ignores code, math, headings, embeds, and popovers even with identical text', () => {
    const root = fixture('<h2>[1–10]</h2><pre>[1–10]</pre><p><code>[1–10]</code></p><div class="math">[1–10]</div><div class="internal-embed"><p>[1–10]</p></div><div class="crp-native-content">[1–10]</div><p class="target">Real [1–10].</p>');
    const triggers = decorateReadingCitations(root, [group()]);
    expect(triggers).toHaveLength(1);
    expect(triggers[0].element.parentElement?.className).toBe('target');
  });

  it('never joins two paragraphs or crosses excluded inline content', () => {
    const root = fixture('<p>[1–</p><p>10]</p><p>[1–<code>x</code>10]</p>');
    expect(decorateReadingCitations(root, [group(), group()])).toEqual([]);
  });

  it('does not confuse a foreign endpoint range with local reference links', () => {
    const root = fixture('<p>[<a href="https://example.com/#ref-1">1</a>–<a href="https://example.com/#ref-10">10</a>] then [<a href="#ref-1">1</a>–<a href="#ref-10">10</a>].</p>');
    const triggers = decorateReadingCitations(root, [group('[1–10]', true)]);
    expect(triggers).toHaveLength(1);
    expect(triggers[0].element.querySelector('a')?.getAttribute('href')).toBe('#ref-1');
    expect(root.querySelector('a[href^="https"]')?.closest('.crp-citation')).toBeNull();
  });

  it('accepts explicit same-note paths and rejects another note', () => {
    const root = fixture('<p>[<a class="internal-link" data-href="Other#^ref-1">1</a>–<a data-href="Other#^ref-10">10</a>] then [<a data-href="Notes/Paper.md#^ref-1">1</a>–<a data-href="Paper#^ref-10">10</a>].</p>');
    const triggers = decorateReadingCitations(root, [group('[1–10]', true)], { sourcePath: 'Notes/Paper.md' });
    expect(triggers).toHaveLength(1);
    expect(triggers[0].element.querySelector('a')?.getAttribute('data-href')).toBe('Notes/Paper.md#^ref-1');
  });

  it('aligns reference targets rather than consuming equal-numbered figure links', () => {
    const root = fixture('<p>Figures [<a href="#^fig-1">1</a>–<a href="#^fig-10">10</a>], references [<a href="#^ref-1">1</a>–<a href="#^ref-10">10</a>].</p>');
    const citation = { ...group('[1–10]', true), scopeId: 'main', linkTargets: ['^ref-1', '^ref-10'] };
    const triggers = decorateReadingCitations(root, [citation]);
    expect(triggers).toHaveLength(1);
    expect(triggers[0].element.querySelector('a')?.getAttribute('href')).toBe('#^ref-1');
    expect(root.querySelector('a[href="#^fig-1"]')?.closest('.crp-citation')).toBeNull();
  });

  it('uses exact linked targets to distinguish equal visible numbers from different bibliographies', () => {
    const root = fixture('<p>[<a href="#^sref-1">1</a>–<a href="#^sref-10">10</a>] then [<a href="#^ref-1">1</a>–<a href="#^ref-10">10</a>].</p>');
    const main = { ...group('[1–10]', true, 0), scopeId: 'main', linkTargets: ['^ref-1', '^ref-10'] };
    const supplement = { ...group('[1–10]', true, 50), scopeId: 'supplement', linkTargets: ['^sref-1', '^sref-10'] };
    const triggers = decorateReadingCitations(root, [main, supplement]);
    expect(triggers.map(trigger => trigger.group.scopeId)).toEqual(['supplement', 'main']);
    expect(triggers.map(trigger => trigger.element.querySelector('a')?.getAttribute('href'))).toEqual(['#^sref-1', '#^ref-1']);
  });

  it('resolves relative same-note paths and encoded anchors using the source parser rules', () => {
    const root = fixture('<p>[<a data-href="../Notes/Paper%20one.md#%5Eref-1">1</a>–<a href="./Paper%20one.md#^ref-10">10</a>].</p>');
    const citation = { ...group('[1–10]', true), linkTargets: ['^ref-1', '^ref-10'] };
    const triggers = decorateReadingCitations(root, [citation], { sourcePath: 'Notes/Paper one.md' });
    expect(triggers).toHaveLength(1);
    expect(triggers[0].element.textContent).toBe('[1–10]');
  });

  it('requires the complete ordered target sequence while preserving repeated endpoint links', () => {
    const root = fixture('<p>[<a href="#^ref-10">1</a>–<a href="#^ref-1">10</a>] then [<a href="#^ref-1">1</a>–<a href="#^ref-10">10</a>, <a href="#^ref-1">1</a>].</p>');
    const range = { ...group('[1–10]', true), linkTargets: ['^ref-1', '^ref-10'] };
    const repeated = { ...group('[1–10, 1]', true, 30), linkTargets: ['^ref-1', '^ref-10', '^ref-1'] };
    const triggers = decorateReadingCitations(root, [range, repeated]);
    expect(triggers).toHaveLength(1);
    expect(triggers[0].group).toBe(repeated);
    expect(triggers[0].element.querySelectorAll('a')).toHaveLength(3);
  });

  it('supports endpoint links without outer brackets but does not decorate bare numbers', () => {
    const root = fixture('<p>Temperature 1–10 then <a href="#ref-1">1</a>–<a href="#ref-10">10</a>.</p>');
    const triggers = decorateReadingCitations(root, [group('[1–10]', true)]);
    expect(triggers).toHaveLength(1);
    expect(triggers[0].element.textContent).toBe('1–10');
    expect(root.firstElementChild?.firstChild?.textContent).toBe('Temperature 1–10 then ');
  });

  it('normalizes whitespace, dash variants, fullwidth digits and mixed groups', () => {
    const root = fixture('<p>［１—３，５，８–１０］</p>');
    const triggers = decorateReadingCitations(root, [group('[1–3, 5, 8–10]')]);
    expect(triggers).toHaveLength(1);
    expect(triggers[0].element.textContent).toBe('［１—３，５，８–１０］');
  });

  it('leaves partially selected inline elements intact', () => {
    const root = fixture('<p><em>prefix [1–</em>10]</p>');
    const before = root.innerHTML;
    expect(decorateReadingCitations(root, [group()])).toEqual([]);
    expect(root.innerHTML).toBe(before);
  });

  it('supports an entire range within one existing anchor without changing the anchor', () => {
    const root = fixture('<p><a href="#ref-1">[1–10]</a></p>');
    const anchor = root.querySelector('a');
    const triggers = decorateReadingCitations(root, [group('[1–10]', true)]);
    expect(triggers).toHaveLength(1);
    expect(triggers[0].element.parentElement).toBe(anchor);
    triggers[0].dispose();
    expect(root.querySelector('a')).toBe(anchor);
  });

  it('does not double-decorate or consume unknown groups', () => {
    const root = fixture('<p>[1–10] and [20–25].</p>');
    const first = decorateReadingCitations(root, [group()]);
    expect(first).toHaveLength(1);
    expect(decorateReadingCitations(root, [group()])).toEqual([]);
    expect(root.querySelectorAll('.crp-citation')).toHaveLength(1);
  });

  it('uses the root document rather than assuming the main window', () => {
    const otherDocument = document.implementation.createHTMLDocument('Another window');
    const root = otherDocument.createElement('div');
    root.textContent = '[1–10]';
    const triggers = decorateReadingCitations(root, [group()]);
    expect(triggers).toHaveLength(1);
    expect(triggers[0].element.ownerDocument).toBe(otherDocument);
  });
});

describe('resolved reading links', () => {
  const references = '\n\n' + Array.from({ length: 5 }, (_, index) =>
    `[${index + 1}] Author ${index + 1}. Reference text. ^ref-${index + 1}`).join('\n');
  const modelFor = (citation: string) => new CitationDocument(citation + references, 'Paper.md', DEFAULT_SETTINGS);

  it('links displayed tokens in their original order instead of expanded or deduplicated numbers', () => {
    const model = modelFor('[3,1-5,3]');
    const root = fixture('<p>Evidence <sup>[3,1-5,3]</sup>.</p>');
    const before = root.textContent;
    const onNavigate = vi.fn();
    const [trigger] = decorateReadingCitations(root, model.groups, { model, onNavigate, settings: DEFAULT_SETTINGS });
    expect(trigger.element.classList.contains('crp-resolved')).toBe(true);
    expect(trigger.element.classList.contains('crp-link-blue')).toBe(true);
    const anchors = Array.from(root.querySelectorAll<HTMLAnchorElement>('a'));
    expect(anchors.map(anchor => anchor.textContent)).toEqual(['3', '1', '5', '3']);
    expect(anchors.map(anchor => anchor.getAttribute('href'))).toEqual(['#^ref-3', '#^ref-1', '#^ref-5', '#^ref-3']);
    anchors[2].dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(onNavigate).toHaveBeenCalledExactlyOnceWith(model, model.groups[0], 5, expect.any(MouseEvent));
    expect(root.textContent).toBe(before);
    trigger.dispose();
    expect(root.querySelector('a')).toBeNull();
    expect(root.querySelector('sup')?.textContent).toBe('[3,1-5,3]');
    expect(root.textContent).toBe(before);
  });

  it('styles a single native link without adding a second keyboard stop or intercepting its click', () => {
    const model = modelFor('[1](#^ref-1)');
    const root = fixture('<p>See <a href="#^ref-1">1</a>.</p>');
    const native = root.querySelector<HTMLAnchorElement>('a')!;
    const nativeClick = vi.fn((event: Event) => event.preventDefault());
    native.addEventListener('click', nativeClick);
    const onNavigate = vi.fn();
    const [trigger] = decorateReadingCitations(root, model.groups, { model, onNavigate, settings: DEFAULT_SETTINGS });
    expect(trigger.element.textContent).toBe('1');
    expect(trigger.element.classList.contains('crp-resolved')).toBe(true);
    expect(trigger.element.classList.contains('crp-native-citation')).toBe(true);
    expect(trigger.element.hasAttribute('tabindex')).toBe(false);
    expect(trigger.element.hasAttribute('role')).toBe(false);
    native.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(nativeClick).toHaveBeenCalledOnce();
    expect(onNavigate).not.toHaveBeenCalled();
    trigger.dispose();
    expect(root.querySelector('a')).toBe(native);
  });

  it('does not confuse a bare prose number or a figure link with a single citation link', () => {
    const model = modelFor('[1](#^ref-1)');
    const root = fixture('<p>Value 1, figure <a href="#^fig-1">1</a>, citation <a href="#^ref-1">1</a>.</p>');
    const triggers = decorateReadingCitations(root, model.groups, { model, settings: DEFAULT_SETTINGS });
    expect(triggers).toHaveLength(1);
    expect(triggers[0].element.closest('a')?.getAttribute('href')).toBe('#^ref-1');
    expect(root.querySelector('a[href="#^fig-1"]')?.querySelector('.crp-citation')).toBeNull();
  });

  it('preserves one whole-range native anchor and never creates nested links', () => {
    const model = modelFor('[1-5](#^ref-1)');
    const root = fixture('<p><a href="#^ref-1">1-5</a></p>');
    const native = root.querySelector('a');
    const [trigger] = decorateReadingCitations(root, model.groups, { model, onNavigate: vi.fn(), settings: DEFAULT_SETTINGS });
    expect(trigger.element.classList.contains('crp-resolved')).toBe(true);
    expect(root.querySelectorAll('a')).toHaveLength(1);
    expect(root.querySelector('a')).toBe(native);
    expect(native?.getAttribute('href')).toBe('#^ref-1');
    trigger.dispose();
    expect(root.querySelector('a')).toBe(native);
  });

  it('adds only missing number links around existing linked tokens and preserves formatting', () => {
    const model = modelFor('[1,[3](#^ref-3),5]');
    const root = fixture('<p>[<em>1</em>,<a href="#^ref-3">3</a>,<strong>5</strong>]</p>');
    const native = root.querySelector('a');
    const emphasis = root.querySelector('em');
    const strong = root.querySelector('strong');
    const [trigger] = decorateReadingCitations(root, model.groups, { model, onNavigate: vi.fn(), settings: DEFAULT_SETTINGS });
    expect(root.querySelectorAll('a')).toHaveLength(3);
    expect(root.querySelector('a[href="#^ref-3"]')).toBe(native);
    expect(root.querySelector('em')).toBe(emphasis);
    expect(root.querySelector('strong')).toBe(strong);
    trigger.dispose();
    expect(root.querySelectorAll('a')).toHaveLength(1);
    expect(root.querySelector('a')).toBe(native);
    expect(root.querySelector('em')).toBe(emphasis);
    expect(root.textContent).toBe('[1,3,5]');
  });

  it('keeps a repeated mixed group available for custom hover after preview-number deduplication', () => {
    const model = modelFor('[1,[1](#^ref-1)]');
    expect(model.groups[0].numbers).toEqual([1]);
    const root = fixture('<p>[1,<a href="#^ref-1">1</a>]</p>');
    const native = root.querySelector('a');
    const [trigger] = decorateReadingCitations(root, model.groups, { model, onNavigate: vi.fn(), settings: DEFAULT_SETTINGS });
    expect(trigger.element.classList.contains('crp-native-citation')).toBe(false);
    expect(trigger.element.getAttribute('tabindex')).toBe('0');
    expect(root.querySelectorAll('a')).toHaveLength(2);
    expect(root.querySelectorAll('.crp-reference-link')).toHaveLength(1);
    expect(Array.from(root.querySelectorAll('a'))[1]).toBe(native);
  });

  it('does not present incomplete groups as resolved links', () => {
    const model = new CitationDocument('[1-5]\n\n[1] First. ^ref-1\n[5] Fifth. ^ref-5', 'Paper.md', DEFAULT_SETTINGS);
    const root = fixture('<p>[1-5]</p>');
    const [trigger] = decorateReadingCitations(root, model.groups, { model, onNavigate: vi.fn(), settings: DEFAULT_SETTINGS });
    expect(trigger.element.classList.contains('crp-resolved')).toBe(false);
    expect(root.querySelector('a')).toBeNull();
    expect(trigger.element.getAttribute('tabindex')).toBe('0');
  });

  it('removes stale resolution and generated links after metadata changes, and restores them when valid', () => {
    const model = modelFor('[1-5]');
    const root = fixture('<p>[1-5]</p>');
    const onNavigate = vi.fn();
    const [trigger] = decorateReadingCitations(root, model.groups, { model, onNavigate, settings: DEFAULT_SETTINGS });
    const oldLink = root.querySelector('a')!;
    const changed = new CitationDocument('[1-5]', 'Paper.md', DEFAULT_SETTINGS);
    trigger.update(changed, undefined);
    expect(trigger.element.classList.contains('crp-resolved')).toBe(false);
    expect(trigger.element.classList.contains('crp-link-blue')).toBe(false);
    expect(root.querySelector('a')).toBeNull();
    expect(trigger.element.hasAttribute('tabindex')).toBe(false);
    oldLink.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    expect(onNavigate).not.toHaveBeenCalled();
    trigger.update(model, model.groups[0]);
    expect(trigger.element.classList.contains('crp-resolved')).toBe(true);
    expect(root.querySelectorAll('a')).toHaveLength(2);
    trigger.dispose();
    trigger.update(model, model.groups[0]);
    expect(root.querySelector('a')).toBeNull();
  });

  it('withdraws resolved styling while preserving native anchors and listeners after a reference is removed', () => {
    const citation = String.raw`\[[1](#^ref-1)-[5](#^ref-5)\]`;
    const model = modelFor(citation);
    const root = fixture('<p>[<a href="#^ref-1">1</a>-<a href="#^ref-5">5</a>]</p>');
    const native = Array.from(root.querySelectorAll('a'));
    const clicked = vi.fn((event: Event) => event.preventDefault());
    native[0].addEventListener('click', clicked);
    const [trigger] = decorateReadingCitations(root, model.groups, { model, onNavigate: vi.fn(), settings: DEFAULT_SETTINGS });
    expect(trigger.element.classList.contains('crp-resolved')).toBe(true);
    const changed = new CitationDocument(model.source.replace('^ref-3', '^other-3'), 'Paper.md', DEFAULT_SETTINGS);
    trigger.update(changed, changed.groups[0]);
    expect(trigger.element.classList.contains('crp-resolved')).toBe(false);
    expect(trigger.element.classList.contains('crp-link-blue')).toBe(false);
    expect(Array.from(root.querySelectorAll('a'))).toEqual(native);
    expect(native.map(anchor => anchor.getAttribute('href'))).toEqual(['#^ref-1', '#^ref-5']);
    native[0].dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(clicked).toHaveBeenCalledOnce();
  });

  it('supports keyboard and new-pane activation only on plugin-created anchors', () => {
    const model = modelFor('[1]');
    const root = fixture('<p>[1]</p>');
    const onNavigate = vi.fn();
    decorateReadingCitations(root, model.groups, { model, onNavigate, settings: DEFAULT_SETTINGS });
    const anchor = root.querySelector('a')!;
    const enter = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true, metaKey: true });
    anchor.dispatchEvent(enter);
    expect(enter.defaultPrevented).toBe(true);
    expect(onNavigate).toHaveBeenLastCalledWith(model, model.groups[0], 1, enter);
    const middle = new MouseEvent('auxclick', { button: 1, bubbles: true, cancelable: true });
    anchor.dispatchEvent(middle);
    expect(middle.defaultPrevented).toBe(true);
    expect(onNavigate).toHaveBeenLastCalledWith(model, model.groups[0], 1, middle);
    anchor.dispatchEvent(new MouseEvent('auxclick', { button: 2, bubbles: true, cancelable: true }));
    expect(onNavigate).toHaveBeenCalledTimes(2);
  });

  it('switches color preferences and removes virtual links when the feature is disabled', () => {
    const model = modelFor('[1]');
    const root = fixture('<p>[1]</p>');
    const settings = { ...DEFAULT_SETTINGS, citationColor: 'theme' as const };
    const [trigger] = decorateReadingCitations(root, model.groups, { model, settings, onNavigate: vi.fn() });
    expect(trigger.element.classList.contains('crp-link-theme')).toBe(true);
    expect(trigger.element.classList.contains('crp-link-blue')).toBe(false);
    settings.citationLinks = false;
    trigger.update(model, model.groups[0]);
    expect(trigger.element.classList.contains('crp-resolved')).toBe(false);
    expect(root.querySelector('a')).toBeNull();
    expect(trigger.element.getAttribute('tabindex')).toBe('0');
  });
});
