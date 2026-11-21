// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { decorateReadingCitations } from '../src/reading';
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
