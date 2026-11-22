import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Component, TFile, type App, type MarkdownPostProcessorContext, type MarkdownRenderChild, type PluginManifest } from 'obsidian';
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

async function setup(note = source) {
  const workspaceEvents = new HostEvents();
  const vaultEvents = new HostEvents();
  const metadataEvents = new HostEvents();
  const containerEl = document.body.appendChild(document.createElement('div'));
  const file = Object.assign(new TFile(), { path: 'Paper.md' });
  const corePlugin = { enabled: true };
  const trigger = vi.fn<(_name: string, _payload: HoverLink) => void>();
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
      containerEl, trigger, on: workspaceEvents.on.bind(workspaceEvents),
      onLayoutReady: (callback: () => void) => callback(), getLeavesOfType: () => [], updateOptions: vi.fn()
    },
    vault: { on: vaultEvents.on.bind(vaultEvents) },
    metadataCache: { on: metadataEvents.on.bind(metadataEvents) },
    internalPlugins: { getPluginById: (id: string) => id === 'page-preview' ? corePlugin : undefined },
    embedRegistry: { embedByExtension: factories }
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
  return { plugin, corePlugin, containerEl, process, processPlain, trigger, render, owners, file,
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

  it('does not fill a unique intermediate reference from an ambiguous plain-text bibliography scope', async () => {
    const note = 'Ambiguous [1–3].\n\n1. Main first. ^ref-1\n2. Main second. ^ref-2\n3. Main third. ^ref-3'
      + '\n\n## Any title\n1. Supplement first. ^sref-1\n3. Supplement third. ^sref-3';
    const { processPlain, render } = await setup(note);
    mouseover(anchor(await processPlain()));
    expect(Array.from((await render()).querySelectorAll('li'), item => [item.value, item.textContent])).toEqual([
      [1, 'Ambiguous bibliography'], [2, 'Ambiguous bibliography'], [3, 'Ambiguous bibliography']
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
    expect(single.closest('.crp-citation')).toBeNull();
    expect(anchor(paragraph).contains(first)).toBe(true);

    const nativeEvent = mouseover(single);
    expect(outerHover).toHaveBeenCalledExactlyOnceWith(nativeEvent);
    expect(trigger).not.toHaveBeenCalled();
    const groupEvent = mouseover(first);
    mouseover(last, { relatedTarget: first });
    expect(trigger).toHaveBeenCalledExactlyOnceWith('hover-link', expect.objectContaining({
      event: groupEvent, targetEl: anchor(paragraph)
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
    expect(registeredCommands(plugin)).toHaveLength(0);
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
});
