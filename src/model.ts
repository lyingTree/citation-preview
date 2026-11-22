import { ignoredMarkdownRanges, parseReferences, sourceLines } from './bibliography';
import { findCitationGroups } from './citations';
import { detectHeadingScopes, detectReferenceLists } from './reference-lists';
import type { GroupPreview } from './popover';
import type { CitationGroup, PluginSettings, ReferenceEntry, ReferenceIndex } from './types';

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
    if (settings.recognizePlainText) {
      this.references.headingScopes = detectHeadingScopes(source, lines);
      this.references.lists = detectReferenceLists(source, this.references, lines);
    }
    this.groups = findCitationGroups(source, this.references, {
      maxReferences: settings.maxReferences,
      recognizePlainText: settings.recognizePlainText,
      sourcePath
    }, ignored);
    for (let i = source.indexOf('\n'); i !== -1; i = source.indexOf('\n', i + 1)) {
      this.lineStarts.push(i + 1);
    }
  }

  /** Resolve only inside the selected list or namespace; never borrow from another bibliography. */
  reference(group: CitationGroup, number: number): ReferenceEntry | undefined {
    if (group.ambiguousScope) return undefined;
    const selected = group.scopeId === undefined ? this.references
      : this.references.lists?.find(list => list.id === group.scopeId)
        ?? this.references.sections.find(section => section.id === group.scopeId);
    const entry = selected?.entries.get(number);
    if (!entry || (entry.anchor && this.references.duplicateAnchors.has(entry.anchor))) return undefined;
    return entry;
  }

  isResolved(group: CitationGroup): boolean {
    return group.numbers.length > 0 && group.numbers.every(number => this.reference(group, number) !== undefined);
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
