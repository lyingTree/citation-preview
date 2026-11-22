import { describe, expect, it } from 'vitest';
import { normalizeSettings } from '../src/settings';
import { DEFAULT_SETTINGS } from '../src/types';

describe('persisted citation display settings', () => {
  it('migrates existing settings without losing their preview preferences', () => {
    expect(normalizeSettings({ maxReferences: 50, recognizePlainText: false, requireModifier: true, enableEditor: false }))
      .toEqual({ ...DEFAULT_SETTINGS, maxReferences: 50, recognizePlainText: false, requireModifier: true, enableEditor: false });
  });

  it('accepts explicit link display preferences and rejects invalid stored values', () => {
    expect(normalizeSettings({ citationLinks: false, citationColor: 'theme' })).toEqual({ ...DEFAULT_SETTINGS, citationLinks: false, citationColor: 'theme' });
    expect(normalizeSettings({ citationLinks: 'false', citationColor: '<script>' })).toEqual(DEFAULT_SETTINGS);
    expect(normalizeSettings(null)).toEqual(DEFAULT_SETTINGS);
  });
});
