import { MarkdownRenderer, type App, type Component } from 'obsidian';

export interface GroupPreview {
  linktext: string;
  markdown: string;
  entries: readonly string[];
  numbers: readonly number[];
}

export interface NativeHoverParent {
  hoverPopover: { hide(): void } | null;
}

interface MarkdownEmbed extends Component {
  containerEl: HTMLElement;
  previewMode?: { renderer?: { previewEl?: HTMLElement } };
  editable: boolean;
  loadContents(): void;
  loadFile(): Promise<void>;
  requestEdit(): void;
}

type EmbedFactory = (context: { state?: object }, ...args: unknown[]) => MarkdownEmbed;

// The core plugin forwards the hover state object to its private Markdown embed factory.
type NativeApp = App & {
  embedRegistry?: { embedByExtension?: { md?: EmbedFactory } };
  internalPlugins?: { getPluginById(id: string): { enabled: boolean } | undefined };
};

const requests = new WeakMap<object, { owner: Component; path: string; preview: GroupPreview }>();

export function requestPreview(owner: Component, path: string, preview: GroupPreview): object {
  const state = {};
  requests.set(state, { owner, path, preview });
  return state;
}

export function isPagePreviewEnabled(app: App): boolean {
  return (app as NativeApp).internalPlugins?.getPluginById('page-preview')?.enabled === true;
}

export function installPreviewContent(app: App, owner: Component): boolean {
  const factories = (app as NativeApp).embedRegistry?.embedByExtension;
  const create = factories?.md;
  if (!factories || typeof create !== 'function') return false;

  function createMarkdownEmbed(this: unknown, context: { state?: object }, ...args: unknown[]): MarkdownEmbed {
    const embed = create!.call(this, context, ...args);
    const request = context.state && requests.get(context.state);
    if (!request || request.owner !== owner || typeof embed?.loadFile !== 'function') return embed;
    const previewView = embed.previewMode?.renderer?.previewEl;
    if (!previewView) return embed;

    embed.containerEl.classList.add('crp-native-preview');
    embed.containerEl.dataset.type = 'block';
    embed.loadContents = () => {};
    embed.loadFile = async () => {
      embed.editable = false;
      embed.requestEdit = () => {};
      // The native virtualized sizer only renders indexed file sections.
      const section = previewView.createDiv({ cls: 'markdown-preview-sizer markdown-preview-section crp-native-content' });
      const content = section.createDiv({ cls: 'el-ol' });
      const { markdown, entries, numbers } = request.preview;
      try {
        await MarkdownRenderer.render(app, markdown, content, request.path, embed);
      } catch {
        content.replaceChildren();
      }
      let list = content.querySelector<HTMLOListElement>(':scope > ol');
      if (!list || list.children.length !== numbers.length) {
        content.replaceChildren();
        list = content.createEl('ol');
        for (const entry of entries) list.createEl('li', { text: entry });
      }
      list.querySelectorAll<HTMLLIElement>(':scope > li').forEach((item, index) => { item.value = numbers[index]; });
    };
    return embed;
  }

  factories.md = createMarkdownEmbed;
  owner.register(() => {
    if (factories.md === createMarkdownEmbed) factories.md = create;
  });
  return true;
}
