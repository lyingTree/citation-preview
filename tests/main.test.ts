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
