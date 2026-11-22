import { editorInfoField } from 'obsidian';
import { Decoration, ViewPlugin, type DecorationSet, type EditorView, type ViewUpdate } from '@codemirror/view';
import { StateEffect, type Range } from '@codemirror/state';
import type { CitationDocument } from './model';
import type { CitationGroup } from './types';
import type CitationPreview from './main';
import { usesNativeSinglePreview } from './citation-state';

const refreshCitationMarks = StateEffect.define<null>();

export class CitationEditor {
  decorations: DecorationSet = Decoration.none;
  private readonly targets = new Map<number, CitationGroup>();
  private readonly win: Window;
  private model?: CitationDocument;
  private path?: string;
  private timer?: number;

  constructor(readonly view: EditorView, private readonly owner: CitationPreview) {
    this.win = view.dom.ownerDocument.defaultView ?? window;
    this.refresh();
    view.dom.addEventListener('mouseover', this.onMouseOver, true);
    view.dom.addEventListener('click', this.onClick, true);
    view.dom.addEventListener('auxclick', this.onClick, true);
  }

  private readonly onMouseOver = (event: MouseEvent): void => {
    const mark = (event.target as Element | null)?.closest?.<HTMLElement>('.crp-editor-citation');
    if (!mark || mark.contains(event.relatedTarget as Node | null)) return;
    const previous = (event.relatedTarget as Element | null)?.closest?.<HTMLElement>('.crp-editor-citation');
    if (previous?.dataset.crpFrom === mark.dataset.crpFrom) return;
    const group = this.targets.get(Number(mark.dataset.crpFrom));
    if (this.model && group && this.owner.hover(event, mark, this.model, group, true)) event.stopPropagation();
  };

  private readonly onClick = (event: MouseEvent): void => {
    if (event.type === 'click' && (event.button !== 0 || (!event.ctrlKey && !event.metaKey))) return;
    if (event.type === 'auxclick' && event.button !== 1) return;
    const mark = (event.target as Element | null)?.closest?.<HTMLElement>('.crp-editor-number');
    if (!mark || !this.model) return;
    const group = this.targets.get(Number(mark.dataset.crpFrom));
    const number = Number(mark.dataset.crpNumber);
    if (!group || !Number.isFinite(number)) return;
    if (!this.owner.openCitation(this.model, group, number, event)) return;
    event.preventDefault();
    event.stopPropagation();
  };

  private refresh(): void {
    this.path = this.view.state.field(editorInfoField, false)?.file?.path;
    this.targets.clear();
    if (!this.path || !this.owner.settings.enableEditor) {
      this.model = undefined;
      this.decorations = Decoration.none;
      return;
    }
    this.model = this.owner.parse(this.view.state.doc.toString(), this.path);
    const marks: Range<Decoration>[] = [];
    for (const group of this.model.groups) {
      this.targets.set(group.from, group);
      const attributes = { 'data-crp-from': String(group.from) };
      // A native single-link preview stays with Obsidian; its visible label still receives color.
      if (!usesNativeSinglePreview(group)) {
        marks.push(Decoration.mark({ class: 'crp-editor-citation', attributes }).range(group.from, group.to));
      }
      if (!this.owner.settings.citationLinks || !this.model.isResolved(group)) continue;
      const color = this.owner.settings.citationColor === 'theme' ? 'theme' : 'blue';
      for (const range of group.visibleRanges ?? []) {
        if (range.to <= range.from) continue;
        marks.push(Decoration.mark({ class: `crp-editor-link crp-link-${color}`, attributes }).range(range.from, range.to));
      }
      // Explicit Markdown links retain the host's click semantics, including whole-range links.
      if (group.outerLinkTarget) continue;
      for (const token of group.tokens ?? []) {
        if (token.linked || token.to <= token.from) continue;
        marks.push(Decoration.mark({ class: 'crp-editor-number', attributes: {
          ...attributes, 'data-crp-number': String(token.number)
        } }).range(token.from, token.to));
      }
    }
    this.decorations = Decoration.set(marks, true);
  }

  update(update: ViewUpdate): void {
    const path = update.state.field(editorInfoField, false)?.file?.path;
    if (path !== this.path || update.transactions.some(tx => tx.effects.some(effect => effect.is(refreshCitationMarks)))) {
      this.win.clearTimeout(this.timer);
      this.refresh();
    } else if (update.docChanged && this.model) {
      this.targets.clear();
      this.decorations = Decoration.none;
      this.owner.closePreview(path);
      this.win.clearTimeout(this.timer);
      this.timer = this.win.setTimeout(() => this.view.dispatch({ effects: refreshCitationMarks.of(null) }), 120);
    }
  }

  destroy(): void {
    this.win.clearTimeout(this.timer);
    this.view.dom.removeEventListener('mouseover', this.onMouseOver, true);
    this.view.dom.removeEventListener('click', this.onClick, true);
    this.view.dom.removeEventListener('auxclick', this.onClick, true);
  }
}

export function citationEditorExtension(owner: CitationPreview) {
  return ViewPlugin.define(view => new CitationEditor(view, owner), {
    decorations: plugin => plugin.decorations
  });
}
