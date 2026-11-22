import { afterEach, describe, expect, it, vi } from 'vitest';
import { Compartment, EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { editorInfoField, type MarkdownFileInfo } from 'obsidian';
import { citationEditorExtension } from '../src/editor';
import { CitationDocument } from '../src/model';
import { DEFAULT_SETTINGS } from '../src/types';
import type CitationPreview from '../src/main';

const original = 'Evidence [1–3].\n\n## References\n[1] Original first. ^ref-1\n[2] Second. ^ref-2\n[3] Third. ^ref-3';
const path = 'Paper.md';
const views: EditorView[] = [];

function setup(source = original) {
  const settings = { ...DEFAULT_SETTINGS };
  const parse = vi.fn((text: string, sourcePath: string) => new CitationDocument(text, sourcePath, settings));
  const closePreview = vi.fn();
  const hover = vi.fn<CitationPreview['hover']>();
  const openCitation = vi.fn<CitationPreview['openCitation']>(() => true);
  const owner = { settings, parse, closePreview, hover, openCitation } as unknown as CitationPreview;
  const compartment = new Compartment();
  const info = { file: { path } } as MarkdownFileInfo;
  const view = new EditorView({
    parent: document.body,
    state: EditorState.create({ doc: source, extensions: [
      editorInfoField.init(() => info), compartment.of(citationEditorExtension(owner))
    ] })
  });
  views.push(view);
  const marks = () => Array.from(view.dom.querySelectorAll<HTMLElement>('.crp-editor-citation'));
  const reconfigure = () => view.dispatch({ effects: compartment.reconfigure(citationEditorExtension(owner)) });
  const colors = () => Array.from(view.dom.querySelectorAll<HTMLElement>('.crp-editor-link'));
  const numbers = () => Array.from(view.dom.querySelectorAll<HTMLElement>('.crp-editor-number'));
  return { view, settings, marks, colors, numbers, reconfigure, parse, closePreview, hover, openCitation };
}

afterEach(() => {
  for (const view of views.splice(0)) view.destroy();
  document.body.replaceChildren();
  vi.useRealTimers();
});

describe('editor integration with real CodeMirror state', () => {
  it('decorates the exact citation range and sends a mouseover with the current editor model', () => {
    const { view, marks, hover } = setup();
    expect(marks().map(mark => mark.textContent)).toEqual(['[1–3]']);
    const [mark] = marks();
    expect(mark.dataset.crpFrom).toBe(String(original.indexOf('[1–3]')));
    view.contentDOM.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    expect(hover).not.toHaveBeenCalled();

    const event = new MouseEvent('mouseover', { bubbles: true, ctrlKey: true });
    mark.dispatchEvent(event);
    expect(hover).toHaveBeenCalledExactlyOnceWith(event, mark,
      expect.objectContaining({ source: original, sourcePath: path }),
      expect.objectContaining({ numbers: [1, 2, 3] }), true);
  });

  it('decorates linked groups and leaves a single same-note link to Obsidian', () => {
    const source = original.replace('Evidence [1–3].',
      String.raw`Evidence \[[1](#^ref-1)\] and \[[1](#^ref-1)–[3](#^ref-3)\].`);
    const { marks } = setup(source);
    expect(marks().map(mark => mark.textContent)).toEqual([String.raw`\[[1](#^ref-1)–[3](#^ref-3)\]`]);
  });

  it('closes the active path on edits and debounces parsing of the latest unsaved buffer', () => {
    vi.useFakeTimers();
    const { view, marks, parse, closePreview, hover } = setup();
    expect(parse).toHaveBeenCalledOnce();

    const from = original.indexOf('Original first.');
    view.dispatch({ changes: { from, to: from + 'Original first.'.length, insert: 'Draft.' } });
    expect(closePreview).toHaveBeenCalledWith(path);
    vi.advanceTimersByTime(80);
    view.dispatch({ changes: { from, to: from + 'Draft.'.length, insert: 'Unsaved revision.' } });
    vi.advanceTimersByTime(119);
    expect(parse).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(1);
    expect(parse).toHaveBeenCalledTimes(2);
    expect(parse).toHaveBeenLastCalledWith(view.state.doc.toString(), path);

    marks()[0].dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    const model = hover.mock.calls[0]?.[2];
    expect(model?.references.entries.get(1)?.markdown).toBe('Unsaved revision.');
  });

  it('refreshes citation recognition when Obsidian reconfigures the editor extension', () => {
    const { settings, marks, reconfigure } = setup();
    expect(marks()).toHaveLength(1);
    settings.enableEditor = false;
    reconfigure();
    expect(marks()).toHaveLength(0);

    settings.enableEditor = true;
    settings.recognizePlainText = false;
    reconfigure();
    expect(marks()).toHaveLength(0);

    settings.recognizePlainText = true;
    reconfigure();
    expect(marks()).toHaveLength(1);
  });

  it('cancels a pending refresh when the editor is destroyed', () => {
    vi.useFakeTimers();
    const { view, parse } = setup();
    view.dispatch({ changes: { from: 0, insert: 'Revised ' } });
    view.destroy();
    views.splice(views.indexOf(view), 1);
    vi.advanceTimersByTime(120);
    expect(parse).toHaveBeenCalledOnce();
  });

  it('colors visible citation labels without coloring Markdown destinations or escaping', () => {
    const source = original.replace('Evidence [1–3].',
      String.raw`Evidence \[[1](<#^ref-1>)\] and \[[1](#^ref-1)–[3](#^ref-3)\].`);
    const { colors, hover } = setup(source);
    const visible = colors().map(mark => mark.textContent).join('');
    expect(visible).toBe('[1][1–3]');
    expect(visible).not.toMatch(/ref|\^|\\|[<>]/);
    expect(colors().every(mark => mark.classList.contains('crp-link-blue'))).toBe(true);
    colors()[0].dispatchEvent(new MouseEvent('mouseover', { bubbles: true, ctrlKey: true }));
    expect(hover).not.toHaveBeenCalled();
  });

  it('navigates plain visible number tokens on modifier-click and leaves ordinary editing clicks alone', () => {
    const { numbers, openCitation } = setup();
    expect(numbers().map(mark => mark.textContent)).toEqual(['1', '3']);
    const ordinary = new MouseEvent('click', { bubbles: true, cancelable: true });
    numbers()[0].dispatchEvent(ordinary);
    expect(openCitation).not.toHaveBeenCalled();
    expect(ordinary.defaultPrevented).toBe(false);

    const modified = new MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: true });
    numbers()[1].dispatchEvent(modified);
    expect(openCitation).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ source: original, sourcePath: path }),
      expect.objectContaining({ numbers: [1, 2, 3] }), 3, modified);
    expect(modified.defaultPrevented).toBe(true);
  });

  it('leaves explicit links including a whole-range link to native editor navigation', () => {
    const source = original.replace('Evidence [1–3].', 'Evidence [1-3](#^ref-1) and [1](#^ref-1).');
    const { colors, numbers, openCitation } = setup(source);
    expect(colors().map(mark => mark.textContent).join('')).toBe('1-31');
    expect(numbers()).toHaveLength(0);
    for (const mark of colors()) {
      mark.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: true }));
    }
    expect(openCitation).not.toHaveBeenCalled();
  });

  it('keeps custom hover on repeated mixed tokens even when their preview numbers deduplicate to one', () => {
    const source = original.replace('Evidence [1–3].', 'Evidence [1,[1](#^ref-1)].');
    const { marks, numbers, hover } = setup(source);
    expect(marks()).toHaveLength(1);
    expect(numbers().map(mark => mark.textContent)).toEqual(['1']);
    const event = new MouseEvent('mouseover', { bubbles: true, ctrlKey: true });
    numbers()[0].dispatchEvent(event);
    expect(hover).toHaveBeenCalledWith(event, marks()[0],
      expect.objectContaining({ source }), expect.objectContaining({ numbers: [1], linked: true }), true);
  });

  it('removes clickable decoration immediately during an edit before the debounced reparse', () => {
    vi.useFakeTimers();
    const { view, colors, numbers, openCitation } = setup();
    const oldNumber = numbers()[0];
    view.dispatch({ changes: { from: original.indexOf('^ref-3'), to: original.indexOf('^ref-3') + 6, insert: '^other-3' } });
    expect(colors()).toHaveLength(0);
    expect(numbers()).toHaveLength(0);
    oldNumber.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: true }));
    expect(openCitation).not.toHaveBeenCalled();
    vi.advanceTimersByTime(120);
    expect(colors()).toHaveLength(0);
    expect(numbers()).toHaveLength(0);
  });

  it('disables links independently of group previews and applies the theme color preference', () => {
    const { settings, colors, numbers, marks, reconfigure, hover } = setup();
    settings.citationLinks = false;
    reconfigure();
    expect(colors()).toHaveLength(0);
    expect(numbers()).toHaveLength(0);
    expect(marks()).toHaveLength(1);
    marks()[0].dispatchEvent(new MouseEvent('mouseover', { bubbles: true, ctrlKey: true }));
    expect(hover).toHaveBeenCalledOnce();
    settings.citationLinks = true;
    settings.citationColor = 'theme';
    reconfigure();
    expect(colors().length).toBeGreaterThan(0);
    expect(colors().every(mark => mark.classList.contains('crp-link-theme'))).toBe(true);
    expect(colors().some(mark => mark.classList.contains('crp-link-blue'))).toBe(false);
  });
});
