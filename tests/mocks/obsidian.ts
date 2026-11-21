import { StateField } from '@codemirror/state';
import type {
  App, Command, MarkdownFileInfo, MarkdownPostProcessor, PluginManifest
} from 'obsidian';

/** Minimal host boundary for lifecycle tests; CodeMirror itself is not mocked. */
export const editorInfoField = StateField.define<MarkdownFileInfo | undefined>({
  create: () => undefined,
  update: value => value
});

export class Component {
  private readonly callbacks: Array<() => void> = [];
  private readonly children = new Set<Component>();
  private unloaded = false;

  onload(): void { /* Host hook. */ }
  onunload(): void { /* Host hook. */ }
  load(): void { this.unloaded = false; this.onload(); }
  unload(): void {
    if (this.unloaded) return;
    this.unloaded = true;
    this.onunload();
    for (const child of [...this.children]) this.removeChild(child);
    for (const callback of this.callbacks.splice(0).reverse()) callback();
  }
  addChild<T extends Component>(child: T): T { this.children.add(child); child.load(); return child; }
  removeChild<T extends Component>(child: T): T { this.children.delete(child); child.unload(); return child; }
  register(callback: () => void): void { this.callbacks.push(callback); }
  registerEvent(ref: { off(): void }): void { this.register(() => ref.off()); }
  registerDomEvent(element: EventTarget, type: string, listener: EventListener, options?: boolean | AddEventListenerOptions): void {
    element.addEventListener(type, listener, options);
    this.register(() => element.removeEventListener(type, listener, options));
  }
}

export class MarkdownRenderChild extends Component {
  constructor(readonly containerEl: HTMLElement) { super(); }
}

const processors = new WeakMap<object, MarkdownPostProcessor[]>();
const commands = new WeakMap<object, Command[]>();
export function registeredProcessors(plugin: object): MarkdownPostProcessor[] { return processors.get(plugin) ?? []; }
export function registeredCommands(plugin: object): Command[] { return commands.get(plugin) ?? []; }

export class Plugin extends Component {
  constructor(readonly app: App, readonly manifest: PluginManifest) { super(); }
  loadData(): Promise<null> { return Promise.resolve(null); }
  saveData(_value: unknown): Promise<void> { return Promise.resolve(); }
  addSettingTab(_tab: unknown): void { /* Settings UI is not needed for these host-boundary tests. */ }
  addCommand(command: Command): Command {
    const list = commands.get(this) ?? [];
    list.push(command);
    commands.set(this, list);
    return command;
  }
  registerEditorExtension(_extension: unknown): void { /* Editor integration is tested with real EditorView separately. */ }
  registerMarkdownPostProcessor(processor: MarkdownPostProcessor): MarkdownPostProcessor {
    const list = processors.get(this) ?? [];
    list.push(processor);
    processors.set(this, list);
    this.register(() => processors.set(this, list.filter(value => value !== processor)));
    return processor;
  }
}

export class PluginSettingTab {
  readonly containerEl = document.createElement('div');
  constructor(readonly app: App, readonly plugin: object) {}
}
export class Setting { /* This test suite does not invoke settings display(). */ }
export class TFile { path = ''; }
export class MarkdownView { /* Only instanceof is used by the integration under test. */ }
export class Notice { constructor(readonly message: string) {} }
export class MarkdownRenderer {
  static render(_app: App, markdown: string, container: HTMLElement, _sourcePath: string, _owner: Component): Promise<void> {
    // Use text by default. A test can provide a formatted list to exercise the native embed.
    container.textContent = markdown;
    return Promise.resolve();
  }
}

type ElementOptions = { cls?: string; text?: string; attr?: Record<string, string> };

/** The few Obsidian DOM helpers used to build a card; no arbitrary HTML is interpreted. */
export function installTestDomMethods(doc: Document): void {
  const prototype = Object.getPrototypeOf(doc.createElement('div')) as object;
  const create = (parent: HTMLElement, tag: string, options: ElementOptions = {}): HTMLElement => {
    const child = parent.ownerDocument.createElement(tag);
    if (options.cls) child.className = options.cls;
    if (options.text) child.textContent = options.text;
    for (const [name, value] of Object.entries(options.attr ?? {})) child.setAttribute(name, value);
    parent.appendChild(child);
    return child;
  };
  // Install on HTMLElement, not HTMLDivElement, to include ol/li/button content creation.
  const htmlPrototype = Object.getPrototypeOf(prototype) as object;
  Object.defineProperties(htmlPrototype, {
    createDiv: { configurable: true, value: function(this: HTMLElement, options?: ElementOptions) { return create(this, 'div', options); } },
    createEl: { configurable: true, value: function(this: HTMLElement, tag: string, options?: ElementOptions) { return create(this, tag, options); } },
    setText: { configurable: true, value: function(this: HTMLElement, text: string) { this.textContent = text; } },
    addClass: { configurable: true, value: function(this: HTMLElement, cls: string) { this.classList.add(cls); } },
    empty: { configurable: true, value: function(this: HTMLElement) { this.replaceChildren(); } }
  });
}
