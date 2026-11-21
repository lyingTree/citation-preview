import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Component, MarkdownRenderer, TFile, type App } from 'obsidian';
import { installPreviewContent, isPagePreviewEnabled, requestPreview, type GroupPreview } from '../src/popover';
import { installTestDomMethods } from './mocks/obsidian';

const preview: GroupPreview = {
  linktext: 'Paper.md', markdown: '3. **Third**\n4. Last', entries: ['Third', 'Last'], numbers: [3, 8]
};
const owners: Component[] = [];

function newOwner() {
  const owner = new Component();
  owner.load();
  owners.push(owner);
  return owner;
}

function setup() {
  const owner = newOwner();
  const previewEl = document.createElement('article');
  const renderer: { previewEl?: HTMLElement } = { previewEl };
  const embed = Object.assign(new Component(), {
    containerEl: document.createElement('div'), previewMode: { renderer },
    editable: true, loadContents: vi.fn(), loadFile: vi.fn(async () => {}), requestEdit: vi.fn()
  });
  const create = vi.fn((_context: { state?: object }, _file: TFile, _subpath: string) => embed);
  const factories = { md: create };
  const app = { embedRegistry: { embedByExtension: factories } } as unknown as App;
  expect(installPreviewContent(app, owner)).toBe(true);
  const file = Object.assign(new TFile(), { path: 'Paper.md' });
  return { owner, previewEl, embed, create, factories, app, file };
}

beforeEach(() => installTestDomMethods(document));
afterEach(() => {
  for (const owner of owners.splice(0)) owner.unload();
  vi.restoreAllMocks();
});

describe('native Page preview Markdown embed', () => {
  it('renders Markdown into the native preview once and restores nonconsecutive numbering', async () => {
    const { owner, previewEl, embed, create, factories, app, file } = setup();
    const render = vi.spyOn(MarkdownRenderer, 'render').mockImplementation(async (_app, _source, target) => {
      const list = target.appendChild(document.createElement('ol'));
      const first = list.appendChild(document.createElement('li'));
      first.appendChild(document.createElement('strong')).textContent = 'Third';
      list.appendChild(document.createElement('li')).textContent = 'Last';
    });
    const state = requestPreview(owner, file.path, preview);
    const context = { state };
    const originalLoad = embed.loadFile;
    const originalLoadContents = embed.loadContents;
    const originalEdit = embed.requestEdit;
    const result = factories.md(context, file, '^ref-3');
    expect(create).toHaveBeenCalledExactlyOnceWith(context, file, '^ref-3');
    expect(create.mock.contexts[0]).toBe(factories);
    expect(result).toBe(embed);
    expect(embed.containerEl.classList.contains('crp-native-preview')).toBe(true);

    result.loadContents();
    await result.loadFile();
    result.requestEdit();
    expect(originalLoadContents).not.toHaveBeenCalled();
    expect(originalLoad).not.toHaveBeenCalled();
    expect(originalEdit).not.toHaveBeenCalled();
    expect(result.editable).toBe(false);
    const content = previewEl.querySelector('.crp-native-content .el-ol');
    expect(content).not.toBeNull();
    expect(render).toHaveBeenCalledExactlyOnceWith(app, preview.markdown, content, file.path, embed);
    expect(previewEl.querySelector('li strong')?.textContent).toBe('Third');
    expect(Array.from(previewEl.querySelectorAll('li'), item => item.value)).toEqual([3, 8]);
  });

  it.each(['rejects', 'returns an incomplete list'])('falls back to numbered text when Markdown rendering %s', async outcome => {
    const { owner, previewEl, factories, file } = setup();
    vi.spyOn(MarkdownRenderer, 'render').mockImplementation(async (_app, _source, target) => {
      const list = target.appendChild(document.createElement('ol'));
      list.appendChild(document.createElement('li')).textContent = 'Partial output';
      if (outcome === 'rejects') throw new Error('Renderer failed');
    });
    const result = factories.md({ state: requestPreview(owner, file.path, preview) }, file, '');
    await result.loadFile();
    const items = Array.from(previewEl.querySelectorAll('li'), item => [item.value, item.textContent]);
    expect(items).toEqual([[3, 'Third'], [8, 'Last']]);
  });

  it('leaves untagged embeds, copied state, and a different owner on the original loading path', async () => {
    const { owner, embed, factories, file } = setup();
    const foreignState = requestPreview(newOwner(), file.path, preview);
    const copiedState = { ...requestPreview(owner, file.path, preview) };
    const originalLoad = embed.loadFile;
    const render = vi.spyOn(MarkdownRenderer, 'render');
    for (const state of [undefined, foreignState, copiedState]) {
      const result = factories.md({ state }, file, '');
      expect(result.loadFile).toBe(originalLoad);
      await result.loadFile();
    }
    expect(originalLoad).toHaveBeenCalledTimes(3);
    expect(embed.containerEl.classList.contains('crp-native-preview')).toBe(false);
    expect(render).not.toHaveBeenCalled();
  });

  it('uses the host loader when the preview renderer is unavailable', async () => {
    const { owner, embed, factories, file } = setup();
    const originalLoad = embed.loadFile;
    delete embed.previewMode.renderer.previewEl;
    const result = factories.md({ state: requestPreview(owner, file.path, preview) }, file, '');
    expect(result.loadFile).toBe(originalLoad);
    await result.loadFile();
    expect(originalLoad).toHaveBeenCalledOnce();
    expect(embed.containerEl.classList.contains('crp-native-preview')).toBe(false);
  });

  it('restores its registry hook on unload and preserves a later replacement', () => {
    const { owner, create, factories } = setup();
    expect(factories.md).not.toBe(create);
    owner.unload();
    expect(factories.md).toBe(create);

    const later = setup();
    const replacement = vi.fn(later.create);
    later.factories.md = replacement;
    later.owner.unload();
    expect(later.factories.md).toBe(replacement);
  });

  it('handles a missing registry and checks the current Page preview core-plugin state', () => {
    const owner = newOwner();
    const getPluginById = vi.fn<(id: string) => { enabled: boolean } | undefined>();
    const app = { internalPlugins: { getPluginById } } as unknown as App;
    expect(installPreviewContent(app, owner)).toBe(false);
    expect(isPagePreviewEnabled(app)).toBe(false);
    expect(getPluginById).toHaveBeenCalledWith('page-preview');
    getPluginById.mockReturnValue({ enabled: false });
    expect(isPagePreviewEnabled(app)).toBe(false);
    getPluginById.mockReturnValue({ enabled: true });
    expect(isPagePreviewEnabled(app)).toBe(true);
  });
});
