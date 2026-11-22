import { PluginSettingTab, type App, type Setting } from 'obsidian';
import type CitationPreview from './main';
import { DEFAULT_SETTINGS, type PluginSettings } from './types';

/**
 * The subset of Obsidian 1.13's SettingDefinitionRender used by this tab.
 * Keep this structural type local so we can still compile against the 1.8 API.
 */
interface CitationSettingDefinition {
  name: string;
  desc: string;
  render: (setting: Setting) => void;
}

/** Stored settings are untrusted JSON; never let an unbounded range reach expansion. */
export function normalizeSettings(value: unknown): PluginSettings {
  const data = typeof value === 'object' && value !== null ? value as Record<string, unknown> : {};
  const number = (key: keyof PluginSettings, min: number, max: number): number => {
    const v = data[key];
    const fallback = DEFAULT_SETTINGS[key] as number;
    if (typeof v !== 'number' || !Number.isFinite(v)) return fallback;
    return Math.min(max, Math.max(min, Math.round(v)));
  };
  const bool = (key: keyof PluginSettings): boolean => {
    const v = data[key];
    return typeof v === 'boolean' ? v : DEFAULT_SETTINGS[key] as boolean;
  };
  return {
    maxReferences: number('maxReferences', 10, 500),
    recognizePlainText: bool('recognizePlainText'),
    requireModifier: bool('requireModifier'),
    enableEditor: bool('enableEditor'),
    citationLinks: bool('citationLinks'),
    citationColor: data.citationColor === 'theme' ? 'theme' : 'blue'
  };
}

export class CitationSettingsTab extends PluginSettingTab {
  // The pinned typings declare display as abstract. The host uses the definitions below.
  declare display: () => void;

  constructor(app: App, private readonly owner: CitationPreview) { super(app, owner); }

  /** Obsidian 1.13+ indexes these names/descriptions and renders each row on demand. */
  getSettingDefinitions(): CitationSettingDefinition[] {
    return [
      {
        name: 'Show citations as links',
        desc: 'Color resolved citations and enable navigation for plain numeric citations. Existing links and hover previews keep working.',
        render: setting => {
          setting.addToggle(toggle => toggle.setValue(this.owner.settings.citationLinks).onChange(async value => {
            this.owner.settings.citationLinks = value;
            await this.owner.saveSettings(true);
          }));
        }
      },
      {
        name: 'Citation color',
        desc: 'Use blue adapted to light and dark themes, or follow the theme’s link color.',
        render: setting => {
          setting.addDropdown(dropdown => dropdown.addOptions({ blue: 'Blue', theme: 'Follow theme' })
            .setValue(this.owner.settings.citationColor).onChange(async value => {
              this.owner.settings.citationColor = value === 'theme' ? 'theme' : 'blue';
              await this.owner.saveSettings(true);
            }));
        }
      },
      {
        name: 'Maximum references per group',
        desc: 'Larger groups are skipped. This bounds work for malformed or very large ranges.',
        render: setting => {
          setting.addDropdown(dropdown => dropdown.addOptions({ '20': '20', '50': '50', '100': '100', '200': '200', '500': '500' })
            .setValue(String(this.owner.settings.maxReferences)).onChange(async value => {
              this.owner.settings.maxReferences = Number(value);
              await this.owner.saveSettings(true);
            }));
        }
      },
      {
        name: 'Recognize plain numeric citations',
        desc: 'Resolve bracketed numbers using section context and the nearest reference list, including lists without anchors. Turn off if numeric intervals are being mistaken for citations.',
        render: setting => {
          setting.addToggle(toggle => toggle.setValue(this.owner.settings.recognizePlainText).onChange(async value => {
            this.owner.settings.recognizePlainText = value;
            await this.owner.saveSettings(true);
          }));
        }
      },
      {
        name: 'Require modifier key',
        desc: 'Also require Ctrl or Command for groups in reading view.',
        render: setting => {
          setting.addToggle(toggle => toggle.setValue(this.owner.settings.requireModifier).onChange(async value => {
            this.owner.settings.requireModifier = value;
            await this.owner.saveSettings();
          }));
        }
      },
      {
        name: 'Enable editor previews and links',
        desc: 'Show previews and citation link styling in live preview and source mode as well as reading view.',
        render: setting => {
          setting.addToggle(toggle => toggle.setValue(this.owner.settings.enableEditor).onChange(async value => {
            this.owner.settings.enableEditor = value;
            await this.owner.saveSettings(true);
          }));
        }
      }
    ];
  }

}
