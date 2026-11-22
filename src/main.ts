import { MarkdownRenderChild, MarkdownView, Plugin, type MarkdownPostProcessorContext } from 'obsidian';
import type { Extension } from '@codemirror/state';
import { CitationDocument } from './model';
import { citationEditorExtension } from './editor';
import { decorateReadingCitations } from './reading';
import { installPreviewContent, isPagePreviewEnabled, requestPreview, type GroupPreview, type NativeHoverParent } from './popover';
import { CitationSettingsTab, normalizeSettings } from './settings';
import { DEFAULT_SETTINGS, type CitationGroup, type PluginSettings } from './types';

interface ReadingTarget {
  model: CitationDocument;
  group: CitationGroup | undefined;
  key: string;
}

/** Visible numbers can repeat in independently numbered bibliographies. */
function groupKey(group: CitationGroup): string {
  return JSON.stringify([group.scopeId ?? null, group.linkTargets ?? [], group.numbers, group.ambiguousScope ?? false]);
}

export default class CitationPreview extends Plugin {
  settings: PluginSettings = { ...DEFAULT_SETTINGS };
  private readonly cache = new Map<string, CitationDocument>();
  private readonly readingByPath = new Map<string, Set<ReadingTarget>>();
  private readonly readingCleanup = new Set<() => void>();
  private readonly editorExtensions: Extension[] = [];
  readonly hoverParent: NativeHoverParent = { hoverPopover: null };
  private previewPath?: string;
  private stopped = false;

  async onload(): Promise<void> {
    this.settings = normalizeSettings(await this.loadData());
    this.addSettingTab(new CitationSettingsTab(this.app, this));
    if (!installPreviewContent(this.app, this)) return;
    this.registerMarkdownPostProcessor((element, context) => this.processReading(element, context));
    this.editorExtensions[0] = citationEditorExtension(this);
    this.registerEditorExtension(this.editorExtensions);
    this.registerEvent(this.app.workspace.on('file-open', () => this.closePreview()));
    this.registerEvent(this.app.vault.on('delete', file => this.invalidate(file.path)));
    this.registerEvent(this.app.vault.on('rename', (_file, oldPath) => this.invalidate(oldPath)));
    this.registerEvent(this.app.metadataCache.on('changed', (file, source) => this.refreshReferences(file.path, source)));
    this.app.workspace.onLayoutReady(() => { if (!this.stopped) this.rerender(); });
  }

  onunload(): void {
    this.stopped = true;
    this.closePreview();
    for (const dispose of [...this.readingCleanup]) dispose();
    this.cache.clear();
  }

  parse(source: string, path: string): CitationDocument {
    const cached = this.cache.get(path);
    if (cached?.source === source) return cached;
    const model = new CitationDocument(source, path, this.settings);
    this.cache.delete(path);
    this.cache.set(path, model);
    if (this.cache.size > 12) {
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) this.cache.delete(oldest);
    }
    return model;
  }

  async saveSettings(reparse = false): Promise<void> {
    this.settings = normalizeSettings(this.settings);
    await this.saveData(this.settings);
    this.closePreview();
    if (!reparse) return;
    this.cache.clear();
    if (this.editorExtensions.length) {
      this.editorExtensions[0] = citationEditorExtension(this);
      this.app.workspace.updateOptions();
    }
    this.rerender();
  }

  hover(event: MouseEvent, anchor: HTMLElement, model: CitationDocument, group: CitationGroup, editor = false): boolean {
    if (!isPagePreviewEnabled(this.app)) return false;
    if (!editor && this.settings.requireModifier && !event.ctrlKey && !event.metaKey) return false;
    const key = groupKey(group);
    let preview = model.previewGroups.get(key);
    if (!preview) {
      preview = this.buildPreview(model, group);
      model.previewGroups.set(key, preview);
    }
    this.previewPath = model.sourcePath;
    this.app.workspace.trigger('hover-link', {
      event,
      source: editor ? 'editor' : 'preview',
      hoverParent: this.hoverParent,
      targetEl: anchor,
      linktext: preview.linktext,
      sourcePath: model.sourcePath,
      state: requestPreview(this, model.sourcePath, preview)
    });
    return true;
  }

  private buildPreview(model: CitationDocument, group: CitationGroup): GroupPreview {
    let linktext: string | undefined;
    const references = group.scopeId === undefined ? model.references
      : model.references.sections.find(section => section.id === group.scopeId);
    const entries = group.numbers.map(number => {
      if (group.ambiguousScope) return 'Ambiguous bibliography';
      const reference = references?.entries.get(number);
      if (!linktext && reference?.anchor?.startsWith('^')) linktext = '#' + reference.anchor;
      if (!reference) return references?.duplicates.has(number) ? 'Duplicate reference' : 'Reference not found';
      return reference.markdown.replace(/!\[\[/g, '[[').replace(/!\[([^\]]*)\]\(/g, '[$1](');
    });
    const markdown = entries.map(entry => '1. ' + (entry || '\u00a0').replace(/\n/g, '\n   ')).join('\n');
    // A subpath also keeps missing or ambiguous reference previews in block mode.
    return { linktext: linktext ?? '#^crp-preview', markdown, entries, numbers: group.numbers };
  }

  closePreview(path?: string): void {
    if (path && path !== this.previewPath) return;
    this.hoverParent.hoverPopover?.hide();
  }

  private invalidate(path: string): void {
    this.cache.delete(path);
    this.closePreview(path);
  }

  private processReading(element: HTMLElement, context: MarkdownPostProcessorContext): void {
    if (this.stopped || element.closest('.markdown-embed, .hover-popover')) return;
    const info = context.getSectionInfo(element);
    if (!info || !context.sourcePath) return;
    const path = context.sourcePath;
    const model = this.parse(info.text, path);
    const groups = model.inLines(info.lineStart, info.lineEnd).filter(group => !group.linked || group.numbers.length > 1);
    const triggers = decorateReadingCitations(element, groups, { sourcePath: path });
    if (!triggers.length) return;
    const owner = new MarkdownRenderChild(element);
    context.addChild(owner);
    const targets = this.readingByPath.get(path) ?? new Set<ReadingTarget>();
    this.readingByPath.set(path, targets);
    const registered: ReadingTarget[] = [];
    for (const trigger of triggers) {
      const anchor = trigger.element;
      anchor.setAttribute('aria-haspopup', 'dialog');
      const target: ReadingTarget = { model, group: trigger.group, key: groupKey(trigger.group) };
      targets.add(target);
      registered.push(target);
      let handled = false;
      owner.registerDomEvent(anchor, 'mouseover', event => {
        if (!target.group) return;
        if (!anchor.contains(event.relatedTarget as Node | null)) {
          handled = this.hover(event, anchor, target.model, target.group);
        }
        if (handled) event.stopPropagation();
      }, true);
      owner.registerDomEvent(anchor, 'keydown', event => {
        if (!target.group || event.target !== anchor || (event.key !== 'Enter' && event.key !== ' ')) return;
        const win = anchor.ownerDocument.defaultView;
        if (!win) return;
        const mouse = new win.MouseEvent('mouseover', { ctrlKey: true, metaKey: true });
        if (this.hover(mouse, anchor, target.model, target.group)) event.preventDefault();
      });
    }
    const unload = (): void => owner.unload();
    this.readingCleanup.add(unload);
    owner.register(() => {
      for (const target of registered) targets.delete(target);
      for (const trigger of triggers) trigger.dispose();
      if (!targets.size) this.readingByPath.delete(path);
      this.readingCleanup.delete(unload);
    });
  }

  private refreshReferences(path: string, source: string): void {
    const first = this.readingByPath.get(path)?.values().next().value;
    if (!first) {
      if (this.cache.get(path)?.source !== source) this.invalidate(path);
      return;
    }
    if (first.model.source === source) return;
    this.closePreview(path);
    const model = this.parse(source, path);
    const byKey = new Map(model.groups.map(group => [groupKey(group), group]));
    for (const target of this.readingByPath.get(path) ?? []) {
      target.group = byKey.get(target.key);
      target.model = model;
    }
  }

  private rerender(): void {
    for (const leaf of this.app.workspace.getLeavesOfType('markdown')) {
      if (leaf.view instanceof MarkdownView) leaf.view.previewMode.rerender(true);
    }
  }
}
