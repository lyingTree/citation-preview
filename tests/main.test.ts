import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Component, TFile, type App, type Editor, type EditorTransaction, type MarkdownFileInfo, type MarkdownPostProcessorContext, type MarkdownRenderChild, type PluginManifest } from 'obsidian';
import CitationPreview from '../src/main';
import type { NativeHoverParent } from '../src/popover';
import { installTestDomMethods, registeredCommands, registeredProcessors } from './mocks/obsidian';

class HostEvents {
  private readonly listeners = new Map<string, Set<(...args: unknown[]) => void>>();
  on(name: string, callback: (...args: unknown[]) => void) {
    const set = this.listeners.get(name) ?? new Set<(...args: unknown[]) => void>();
    set.add(callback);
    this.listeners.set(name, set);
    return { off: () => set.delete(callback) };
  }
  emit(name: string, ...args: unknown[]): void {
    for (const callback of this.listeners.get(name) ?? []) callback(...args);
  }
  count(): number { return Array.from(this.listeners.values()).reduce((sum, set) => sum + set.size, 0); }
}

interface HoverLink {
  event: MouseEvent;
  source: string;
  hoverParent: NativeHoverParent;
  targetEl: HTMLElement;
  linktext: string;
  sourcePath: string;
  state: object;
}

const bibliography = '## References\n[1] Original first. ^ref-1\n[2] Second reference. ^ref-2\n[3] Third reference. ^ref-3';
const source = `First [1, 3].\n\nSecond [2–3].\n\n${bibliography}`;
const multipleBibliographies = String.raw`Main \[[1](<#^ref-1>)–[2](<#^ref-2>)\], supplementary \[[1](<#^sref-1>)–[2](<#^sref-2>)\].`
  + '\n\n## 6 参考文献（2条）\n1. Main first. ^ref-1\n2. Main second. ^ref-2'
  + '\n\n## 7 Supplement\n### 7.7 补充参考文献（2条）\n1. Supplement first. ^sref-1\n2. Supplement second. ^sref-2';
const manifest: PluginManifest = {
  id: 'citation-range-preview', name: 'Citation Preview', version: '1.1.0',
  minAppVersion: '1.8.0', description: 'Test manifest.', author: 'Test', isDesktopOnly: false
};
const plugins: CitationPreview[] = [];

async function setup(note = source, nativeAdapter = true) {
  const workspaceEvents = new HostEvents();
  const vaultEvents = new HostEvents();
  const metadataEvents = new HostEvents();
  const containerEl = document.body.appendChild(document.createElement('div'));
  const file = Object.assign(new TFile(), { path: 'Paper.md' });
  const corePlugin = { enabled: true };
  const trigger = vi.fn<(_name: string, _payload: HoverLink) => void>();
  const openLinkText = vi.fn(async () => {});
  const originalFactory = vi.fn((_context: { state: object }, _file: TFile, _subpath: string) => {
    const previewEl = document.createElement('div');
    const embedEl = document.createElement('div');
    embedEl.appendChild(previewEl);
    return Object.assign(new Component(), {
      containerEl: embedEl, previewMode: { renderer: { previewEl } }, editable: true,
      loadContents: () => {}, loadFile: async () => {}, requestEdit: () => {}
    });
  });
  const factories = { md: originalFactory };
  const app = {
    workspace: {
      containerEl, trigger, openLinkText, on: workspaceEvents.on.bind(workspaceEvents),
      onLayoutReady: (callback: () => void) => callback(), getLeavesOfType: () => [], updateOptions: vi.fn()
    },
    vault: { on: vaultEvents.on.bind(vaultEvents) },
    metadataCache: { on: metadataEvents.on.bind(metadataEvents) },
    internalPlugins: { getPluginById: (id: string) => id === 'page-preview' ? corePlugin : undefined },
    embedRegistry: nativeAdapter ? { embedByExtension: factories } : undefined
  } as unknown as App;
  const plugin = new CitationPreview(app, manifest);
  plugins.push(plugin);
  await plugin.onload();
  const owners: MarkdownRenderChild[] = [];
  const context: MarkdownPostProcessorContext = {
    docId: 'test-document', sourcePath: file.path, frontmatter: null,
    getSectionInfo: () => ({ text: note, lineStart: 0, lineEnd: 0 }),
    addChild: child => { owners.push(child); child.load(); }
  };
  const processor = registeredProcessors(plugin)[0];
  if (!processor) throw new Error('Postprocessor was not registered.');

  const process = async (paragraph: HTMLElement) => {
    containerEl.appendChild(paragraph);
    await processor(paragraph, context);
    return paragraph;
  };
  const processPlain = () => {
    const paragraph = document.createElement('p');
    paragraph.textContent = note.split('\n')[0];
    return process(paragraph);
  };
  const render = async () => {
    const [name, hover] = trigger.mock.lastCall ?? [];
    if (name !== 'hover-link' || !hover) throw new Error('The host did not receive a hover-link event.');
    const embed = factories.md({ state: hover.state }, file, hover.linktext.slice(1));
    await embed.loadFile();
    return embed.containerEl;
  };
  return { plugin, corePlugin, containerEl, process, processPlain, trigger, openLinkText, render, owners, file,
    factories, originalFactory, workspaceEvents, vaultEvents, metadataEvents };
}

function anchor(paragraph: HTMLElement): HTMLElement {
  const result = paragraph.querySelector<HTMLElement>('.crp-citation');
  if (!result) throw new Error('Reading trigger was not created.');
  return result;
}

function mouseover(target: HTMLElement, options?: MouseEventInit): MouseEvent {
  const event = new MouseEvent('mouseover', { bubbles: true, ...options });
  target.dispatchEvent(event);
  return event;
}

function independentlyNumberedCitations(): HTMLElement {
  const paragraph = document.createElement('p');
  for (const [label, prefix] of [['Main', 'ref'], ['supplementary', 'sref']]) {
    paragraph.append(`${label} `);
    const sup = paragraph.appendChild(document.createElement('sup'));
    sup.append('[');
    for (const number of [1, 2]) {
      if (number > 1) sup.append('–');
      const link = sup.appendChild(document.createElement('a'));
      link.setAttribute('href', `#^${prefix}-${number}`);
      link.textContent = String(number);
    }
    sup.append(']');
    paragraph.append(' ');
  }
  return paragraph;
}

beforeEach(() => installTestDomMethods(document));
afterEach(() => {
  for (const plugin of plugins.splice(0)) plugin.unload();
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe('native Page preview host integration', () => {
  it('requests a native preview from the rendered section using references from the full note', async () => {
    const { plugin, processPlain, trigger, render, file } = await setup();
    const paragraph = await processPlain();
    const targetEl = anchor(paragraph);
    const event = mouseover(targetEl);
    expect(paragraph.querySelectorAll('.crp-citation')).toHaveLength(1);
    expect(trigger).toHaveBeenCalledExactlyOnceWith('hover-link', {
      event, source: 'preview', hoverParent: plugin.hoverParent, targetEl,
      sourcePath: file.path, linktext: '#^ref-1', state: expect.any(Object) as object
    });
    const preview = await render();
    expect(preview.classList.contains('crp-native-preview')).toBe(true);
    expect(Array.from(preview.querySelectorAll('li'), item => [item.value, item.textContent])).toEqual([
      [1, 'Original first.'], [3, 'Third reference.']
    ]);
  });

  it('closes stale previews and reads refreshed references without recreating the reading wrapper', async () => {
    const { plugin, processPlain, render, metadataEvents, file } = await setup();
    const paragraph = await processPlain();
    const target = anchor(paragraph);
    mouseover(target);
    expect((await render()).textContent).toContain('Original first.');
    const hide = vi.fn();
    plugin.hoverParent.hoverPopover = { hide };
    metadataEvents.emit('changed', file, source.replace('Original first.', 'Saved replacement.'));
    expect(hide).toHaveBeenCalledOnce();
    expect(anchor(paragraph)).toBe(target);
    mouseover(target);
    expect((await render()).textContent).toContain('Saved replacement.');
  });

  it('keeps equal visible citation ranges in separate bibliography scopes and preview caches', async () => {
    const { plugin, process, render, trigger, file } = await setup(multipleBibliographies);
    const paragraph = await process(independentlyNumberedCitations());
    const targets = Array.from(paragraph.querySelectorAll<HTMLElement>('.crp-citation'));
    expect(targets.map(target => target.textContent)).toEqual(['[1–2]', '[1–2]']);

    for (const index of [0, 1, 0, 1]) {
      mouseover(targets[index]);
      const prefix = index === 0 ? 'Main' : 'Supplement';
      expect(Array.from((await render()).querySelectorAll('li'), item => [item.value, item.textContent])).toEqual([
        [1, `${prefix} first.`], [2, `${prefix} second.`]
      ]);
      expect(trigger.mock.lastCall?.[1].linktext).toBe(index === 0 ? '#^ref-1' : '#^sref-1');
    }
    expect(plugin.parse(multipleBibliographies, file.path).previewGroups.size).toBe(2);
  });

  it('refreshes independently numbered bibliographies without rebinding equal labels to another scope', async () => {
    const { process, render, metadataEvents, file } = await setup(multipleBibliographies);
    const paragraph = await process(independentlyNumberedCitations());
    const targets = Array.from(paragraph.querySelectorAll<HTMLElement>('.crp-citation'));
    expect(targets).toHaveLength(2);
    for (const target of targets) mouseover(target);

    const revised = multipleBibliographies.replace('Main first.', 'Revised main first entry.')
      .replace('Supplement first.', 'Revised supplementary first entry.');
    metadataEvents.emit('changed', file, revised);
    expect(Array.from(paragraph.querySelectorAll('.crp-citation'))).toEqual(targets);
    for (const index of [1, 0]) {
      mouseover(targets[index]);
      const entries = Array.from((await render()).querySelectorAll('li'), item => item.textContent);
      expect(entries).toEqual(index === 0
        ? ['Revised main first entry.', 'Main second.']
        : ['Revised supplementary first entry.', 'Supplement second.']);
    }
  });

  it('keeps reading targets valid when reference namespaces move and change order across arbitrary headings', async () => {
    const { process, render, trigger, metadataEvents, file } = await setup(multipleBibliographies);
    const paragraph = await process(independentlyNumberedCitations());
    const targets = Array.from(paragraph.querySelectorAll<HTMLElement>('.crp-citation'));
    expect(targets).toHaveLength(2);
    const revised = multipleBibliographies.split('\n')[0]
      + '\n\n## Any title\n2. Supplement second. ^sref-2'
      + '\n\n1. Main first moved. ^ref-1'
      + '\n\n### Another title\n1. Supplement first moved. ^sref-1'
      + '\n\n2. Main second. ^ref-2';
    metadataEvents.emit('changed', file, revised);
    expect(Array.from(paragraph.querySelectorAll('.crp-citation'))).toEqual(targets);

    for (const index of [0, 1]) {
      trigger.mockClear();
      mouseover(targets[index]);
      expect(trigger).toHaveBeenCalledOnce();
      expect(Array.from((await render()).querySelectorAll('li'), item => item.textContent)).toEqual(index === 0
        ? ['Main first moved.', 'Main second.']
        : ['Supplement first moved.', 'Supplement second.']);
    }
  });

  it.each(['removed', 'renamed'])('disables a stale reading target after its anchors are %s without borrowing another namespace', async change => {
    const { process, render, trigger, metadataEvents, file } = await setup(multipleBibliographies);
    const paragraph = await process(independentlyNumberedCitations());
    const targets = Array.from(paragraph.querySelectorAll<HTMLElement>('.crp-citation'));
    expect(targets).toHaveLength(2);
    const revised = change === 'renamed' ? multipleBibliographies.replace(/\^ref-/g, '^ref-renamed-')
      : multipleBibliographies.replace('1. Main first. ^ref-1', '1. Removed main first.')
        .replace('2. Main second. ^ref-2', '2. Removed main second.');
    metadataEvents.emit('changed', file, revised);

    trigger.mockClear();
    mouseover(targets[0]);
    expect(trigger).not.toHaveBeenCalled();
    mouseover(targets[1]);
    expect(trigger).toHaveBeenCalledOnce();
    expect(Array.from((await render()).querySelectorAll('li'), item => item.textContent)).toEqual([
      'Supplement first.', 'Supplement second.'
    ]);
  });

  it('uses the same scoped reference lookup for editor hovers', async () => {
    const { plugin, file, render } = await setup(multipleBibliographies);
    const model = plugin.parse(multipleBibliographies, file.path);
    const target = document.createElement('span');
    expect(model.groups).toHaveLength(2);
    for (const index of [1, 0]) {
      plugin.hover(new MouseEvent('mouseover', { ctrlKey: true }), target, model, model.groups[index], true);
      expect(Array.from((await render()).querySelectorAll('li'), item => item.textContent)).toEqual(index === 0
        ? ['Main first.', 'Main second.']
        : ['Supplement first.', 'Supplement second.']);
    }
  });

  it('uses the nearest plain-text bibliography without filling its missing entry from a farther list', async () => {
    const note = 'Nearest [1–3].\n\n1. Main first. ^ref-1\n3. Main third. ^ref-3'
      + '\n\n## Any title\n1. Supplement first. ^sref-1\n2. Supplement second. ^sref-2\n3. Supplement third. ^sref-3';
    const { processPlain, render } = await setup(note);
    mouseover(anchor(await processPlain()));
    expect(Array.from((await render()).querySelectorAll('li'), item => [item.value, item.textContent])).toEqual([
      [1, 'Main first.'], [2, 'Reference not found'], [3, 'Main third.']
    ]);
  });

  it('honors the reading-view modifier and the current core-plugin state', async () => {
    const { plugin, corePlugin, processPlain, trigger } = await setup();
    const target = anchor(await processPlain());
    plugin.settings.requireModifier = true;
    mouseover(target);
    corePlugin.enabled = false;
    mouseover(target, { ctrlKey: true });
    expect(trigger).not.toHaveBeenCalled();

    corePlugin.enabled = true;
    mouseover(target, { ctrlKey: true });
    mouseover(target, { metaKey: true });
    expect(trigger).toHaveBeenCalledTimes(2);
  });

  it('leaves a single linked reference to Obsidian and scopes group handling to its wrapper', async () => {
    const note = String.raw`Single \[[1](#^ref-1)\] and group \[[1](#^ref-1)–[3](#^ref-3)\].` + `\n\n${bibliography}`;
    const { process, trigger, containerEl } = await setup(note);
    const paragraph = document.createElement('p');
    const link = (number: number) => {
      const element = document.createElement('a');
      element.className = 'internal-link';
      element.href = `#^ref-${number}`;
      element.textContent = String(number);
      return element;
    };
    const single = link(1);
    const first = link(1);
    const last = link(3);
    paragraph.append('Single [', single, '] and group [', first, '–', last, '].');
    const outerHover = vi.fn();
    containerEl.addEventListener('mouseover', outerHover);
    await process(paragraph);
    const singleWrapper = single.closest('.crp-citation');
    const groupWrapper = first.closest('.crp-citation');
    expect(singleWrapper).not.toBeNull();
    expect(singleWrapper?.hasAttribute('tabindex')).toBe(false);
    expect(groupWrapper).not.toBeNull();

    const nativeEvent = mouseover(single);
    expect(outerHover).toHaveBeenCalledExactlyOnceWith(nativeEvent);
    expect(trigger).not.toHaveBeenCalled();
    const groupEvent = mouseover(first);
    mouseover(last, { relatedTarget: first });
    expect(trigger).toHaveBeenCalledExactlyOnceWith('hover-link', expect.objectContaining({
      event: groupEvent, targetEl: groupWrapper
    }));
    expect(outerHover).toHaveBeenCalledOnce();
  });

  it('uses the editor hover source and closes only the matching preview path', async () => {
    const { plugin, file, trigger } = await setup();
    const model = plugin.parse(source, file.path);
    const targetEl = document.createElement('span');
    const event = new MouseEvent('mouseover', { ctrlKey: true });
    expect(plugin.hover(event, targetEl, model, model.groups[0], true)).toBe(true);
    expect(trigger).toHaveBeenCalledExactlyOnceWith('hover-link', expect.objectContaining({
      event, source: 'editor', sourcePath: file.path, targetEl
    }));
    const hide = vi.fn();
    plugin.hoverParent.hoverPopover = { hide };
    plugin.closePreview('Another.md');
    expect(hide).not.toHaveBeenCalled();
    plugin.closePreview(file.path);
    expect(hide).toHaveBeenCalledOnce();
  });

  it('restores the host registry and unregisters reading wrappers and listeners on unload', async () => {
    const { plugin, processPlain, trigger, owners, workspaceEvents, vaultEvents, metadataEvents, originalFactory, factories } = await setup();
    const paragraph = await processPlain();
    const target = anchor(paragraph);
    const owner = owners[0];
    if (!owner) throw new Error('Reading renderer did not receive its child component.');
    const ownerTeardown = vi.fn();
    owner.register(ownerTeardown);
    expect(registeredCommands(plugin).map(command => command.id)).toEqual(['add-missing-reference-anchors']);
    plugin.unload();
    plugins.splice(plugins.indexOf(plugin), 1);

    expect(factories.md).toBe(originalFactory);
    expect(ownerTeardown).toHaveBeenCalledOnce();
    expect(paragraph.isConnected).toBe(true);
    expect(paragraph.querySelector('.crp-citation')).toBeNull();
    expect(paragraph.textContent).toBe('First [1, 3].');
    expect(workspaceEvents.count() + vaultEvents.count() + metadataEvents.count()).toBe(0);
    expect(registeredProcessors(plugin)).toHaveLength(0);
    mouseover(target);
    expect(trigger).not.toHaveBeenCalled();
  });

  it('shows the explicit result above the expanded whole-link range in a single native preview', async () => {
    const note = 'See [1-5](#^ref-1).\n\n' + Array.from({ length: 5 }, (_, i) => `${i + 1}. Entry ${i + 1}. ^ref-${i + 1}`).join('\n');
    const { process, render, plugin, file } = await setup(note);
    const paragraph = document.createElement('p');
    paragraph.append('See ');
    const existing = paragraph.appendChild(document.createElement('a'));
    existing.href = '#^ref-1';
    existing.textContent = '1-5';
    paragraph.append('.');
    await process(paragraph);
    mouseover(anchor(paragraph));
    const preview = await render();
    const lists = preview.querySelectorAll('.el-ol > ol');
    expect(lists).toHaveLength(2);
    expect(preview.querySelectorAll('hr')).toHaveLength(1);
    expect(Array.from(lists[0].children, item => item.textContent)).toEqual(['Entry 1.']);
    expect(Array.from(lists[1].children, item => item.textContent)).toEqual(['Entry 1.', 'Entry 2.', 'Entry 3.', 'Entry 4.', 'Entry 5.']);
    expect(existing.getAttribute('href')).toBe('#^ref-1');
    expect(existing.querySelector('a')).toBeNull();
    expect([...plugin.parse(note, file.path).previewGroups.values()][0].markdown).toContain('\n\n---\n\n');
  });

  it('opens resolved anchored references and unanchored entries without writing the note', async () => {
    const { plugin, file, openLinkText } = await setup();
    const anchored = plugin.parse(source, file.path);
    expect(plugin.openCitation(anchored, anchored.groups[0], 3, { ctrlKey: true })).toBe(true);
    expect(openLinkText).toHaveBeenLastCalledWith('#^ref-3', file.path, true, undefined);

    const unanchoredSource = 'Evidence [1,2].\n\n## References\n1. Smith J. Atmospheric waves[J]. Journal of Climate, 2024, 10: 1-9.\n2. Doe A. Coastal flooding[J]. Ocean Science, 2023, 9: 10-20.';
    const unanchored = plugin.parse(unanchoredSource, file.path);
    expect(unanchored.groups).toHaveLength(1);
    expect(plugin.openCitation(unanchored, unanchored.groups[0], 2, {})).toBe(true);
    expect(openLinkText).toHaveBeenLastCalledWith(file.path, file.path, false, { eState: { line: 4 } });
    expect(unanchored.source).toBe(unanchoredSource);
    plugin.settings.citationLinks = false;
    expect(plugin.openCitation(unanchored, unanchored.groups[0], 2, {})).toBe(false);
    expect(openLinkText).toHaveBeenCalledTimes(2);
  });

  it('refuses navigation when the selected group is incomplete', async () => {
    const note = 'Evidence [1-3].\n\n1. First. ^ref-1\n3. Third. ^ref-3';
    const { plugin, file, openLinkText } = await setup(note);
    const model = plugin.parse(note, file.path);
    expect(model.groups).toHaveLength(1);
    expect(plugin.openCitation(model, model.groups[0], 1, {})).toBe(false);
    expect(openLinkText).not.toHaveBeenCalled();
  });

  it('keeps link styling, navigation and the manual command available without the private hover adapter', async () => {
    const { plugin, processPlain, trigger, openLinkText } = await setup(source, false);
    const paragraph = await processPlain();
    const target = anchor(paragraph);
    mouseover(target);
    expect(trigger).not.toHaveBeenCalled();
    expect(target.classList.contains('crp-resolved')).toBe(true);
    const generated = target.querySelector<HTMLAnchorElement>('a[data-crp-number="1"]');
    expect(generated).not.toBeNull();
    generated?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(openLinkText).toHaveBeenCalledWith('#^ref-1', 'Paper.md', false, undefined);
    expect(registeredCommands(plugin).map(command => command.id)).toContain('add-missing-reference-anchors');
  });

  it('previews a mixed repeated-number group whose visible tokens deduplicate to one reference', async () => {
    const note = String.raw`See \[1,[1](#^ref-1)\].` + '\n\n1. First reference. ^ref-1';
    const { process, trigger, render } = await setup(note);
    const paragraph = document.createElement('p');
    paragraph.append('See [1,');
    const native = paragraph.appendChild(document.createElement('a'));
    native.href = '#^ref-1';
    native.textContent = '1';
    paragraph.append('].');
    await process(paragraph);
    const wrapper = anchor(paragraph);
    const added = wrapper.querySelector<HTMLElement>('a.crp-reference-link');
    expect(added).not.toBeNull();
    expect(wrapper.getAttribute('tabindex')).toBe('0');
    mouseover(added!);
    expect(trigger).toHaveBeenCalledOnce();
    expect(Array.from((await render()).querySelectorAll('li'), item => item.textContent)).toEqual(['First reference.']);
  });

  it('rebinds the same plain citation occurrence when the nearest recognized list changes', async () => {
    const firstEntry = '1. Alpha A. First list[J]. Journal of Climate, 2024, 10: 1-9.';
    const note = `See [1].\n\n## First collection\n${firstEntry}\n\n## Second collection\n1. Beta B. Second list[J]. Ocean Science, 2023, 9: 10-20.`;
    const { processPlain, render, metadataEvents, file, openLinkText, plugin } = await setup(note);
    const paragraph = await processPlain();
    const wrapper = anchor(paragraph);
    mouseover(wrapper);
    expect((await render()).textContent).toContain('First list');
    const revised = note.replace(firstEntry, '1. Start an ordinary task.');
    metadataEvents.emit('changed', file, revised);
    expect(anchor(paragraph)).toBe(wrapper);
    mouseover(wrapper);
    expect((await render()).textContent).toContain('Second list');
    const added = wrapper.querySelector<HTMLElement>('a.crp-reference-link');
    added?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    const model = plugin.parse(revised, file.path);
    const entry = model.reference(model.groups[0], 1);
    expect(entry?.markdown).toContain('Second list');
    expect(openLinkText).toHaveBeenLastCalledWith(file.path, file.path, false, { eState: { line: entry?.line } });
  });

  it('adds missing anchors only when the manual command runs and uses one editor transaction', async () => {
    let buffer = 'Evidence [1-2].\r\n\r\n## References\r\n1. Smith J. Atmospheric waves[J]. Journal of Climate, 2024, 10: 1-9.\r\n2. Doe A. Coastal flooding[J]. Ocean Science, 2023, 9: 10-20.\r\n';
    const original = buffer;
    const { plugin, file, processPlain } = await setup(buffer);
    await processPlain();
    const transaction = vi.fn((tx: EditorTransaction) => {
      const toOffset = (position: { line: number; ch: number }) => {
        let offset = 0;
        for (let line = 0; line < position.line; line++) offset = buffer.indexOf('\n', offset) + 1;
        return offset + position.ch;
      };
      const changes = (tx.changes ?? []).map(change => ({ from: toOffset(change.from), to: toOffset(change.to ?? change.from), text: change.text }));
      for (const change of changes.sort((left, right) => right.from - left.from)) buffer = buffer.slice(0, change.from) + change.text + buffer.slice(change.to);
    });
    const editor = {
      getValue: () => buffer,
      offsetToPos: (offset: number) => ({ line: buffer.slice(0, offset).split('\n').length - 1, ch: offset - buffer.lastIndexOf('\n', offset - 1) - 1 }),
      transaction
    } as unknown as Editor;
    expect(buffer).toBe(original);
    const command = registeredCommands(plugin).find(item => item.id === 'add-missing-reference-anchors');
    expect(command?.editorCallback).toBeTypeOf('function');
    command?.editorCallback?.(editor, { file } as MarkdownFileInfo);
    expect(transaction).toHaveBeenCalledOnce();
    expect(buffer).toContain('^ref-1');
    expect(buffer).toContain('^ref-2');
    expect(buffer.replace(/ \^ref-[12]/g, '')).toBe(original);
    expect(plugin.parse(buffer, file.path).references.anchors.size).toBe(2);
    command?.editorCallback?.(editor, { file } as MarkdownFileInfo);
    expect(transaction).toHaveBeenCalledOnce();
  });
});
