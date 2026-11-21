import { ignoredMarkdownRanges, parseReferences, sourceLines } from './bibliography';
import { findCitationGroups } from './citations';
import type { GroupPreview } from './popover';
import type { CitationGroup, PluginSettings, ReferenceIndex } from './types';

/** Parsed once per document revision, shared by all hover targets in that revision. */
export class CitationDocument {
  readonly previewGroups = new Map<string, GroupPreview>();
  readonly references: ReferenceIndex;
  readonly groups: CitationGroup[];
  readonly lineStarts: number[] = [0];

  constructor(
    readonly source: string,
    readonly sourcePath: string,
    settings: PluginSettings
  ) {
    const lines = sourceLines(source);
    const ignored = ignoredMarkdownRanges(source, lines);
    this.references = parseReferences(source, lines, ignored);
    this.groups = findCitationGroups(source, this.references, {
      maxReferences: settings.maxReferences,
      recognizePlainText: settings.recognizePlainText,
      sourcePath
    }, ignored);
    for (let i = source.indexOf('\n'); i !== -1; i = source.indexOf('\n', i + 1)) {
      this.lineStarts.push(i + 1);
    }
  }

  at(position: number): CitationGroup | undefined {
    let low = 0;
    let high = this.groups.length - 1;
    while (low <= high) {
      const middle = (low + high) >>> 1;
      const group = this.groups[middle];
      if (position < group.from) { high = middle - 1; continue; }
      if (position >= group.to) { low = middle + 1; continue; }
      return group;
    }
    return undefined;
  }

  inLines(first: number, last: number): CitationGroup[] {
    const from = this.lineStarts[Math.max(0, first)] ?? this.source.length;
    const to = this.lineStarts[last + 1] ?? this.source.length;
    let low = 0;
    let high = this.groups.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (this.groups[middle].from < from) low = middle + 1;
      else high = middle;
    }
    const groups: CitationGroup[] = [];
    for (let i = low; i < this.groups.length && this.groups[i].from < to; i++) {
      if (this.groups[i].to <= to) groups.push(this.groups[i]);
    }
    return groups;
  }
}
