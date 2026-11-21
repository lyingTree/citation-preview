import { editorInfoField } from 'obsidian';
import { Decoration, ViewPlugin, type DecorationSet, type EditorView, type ViewUpdate } from '@codemirror/view';
import { RangeSetBuilder, StateEffect } from '@codemirror/state';
import type { CitationDocument } from './model';
import type { CitationGroup } from './types';
import type CitationPreview from './main';

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
  }

  private readonly onMouseOver = (event: MouseEvent): void => {
    const mark = (event.target as Element | null)?.closest?.<HTMLElement>('.crp-editor-citation');
    if (!mark || mark.contains(event.relatedTarget as Node | null)) return;
    const group = this.targets.get(Number(mark.dataset.crpFrom));
    if (this.model && group && this.owner.hover(event, mark, this.model, group, true)) event.stopPropagation();
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
    const builder = new RangeSetBuilder<Decoration>();
    for (const group of this.model.groups) {
      if (group.linked && group.numbers.length === 1) continue;
      this.targets.set(group.from, group);
      builder.add(group.from, group.to, Decoration.mark({
        class: 'crp-editor-citation', attributes: { 'data-crp-from': String(group.from) }
      }));
    }
    this.decorations = builder.finish();
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
  }
}

export function citationEditorExtension(owner: CitationPreview) {
  return ViewPlugin.define(view => new CitationEditor(view, owner), {
    decorations: plugin => plugin.decorations
  });
}
