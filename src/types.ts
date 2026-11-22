/** A reference number is local to an anchor namespace (ref, sref, ...). Offsets are UTF-16. */
export interface ReferenceEntry {
  number: number;
  sectionId: string;
  markdown: string;
  from: number;
  to: number;
  line: number;
  /** Existing reference block ID including ^, without the leading #. */
  anchor?: string;
}

export interface ReferenceSection {
  /** Namespace from the block ID, independent of headings or document position. */
  id: string;
  title: string;
  from: number;
  to: number;
  entries: Map<number, ReferenceEntry>;
  duplicates: Set<number>;
}

/** A physical bibliography, kept separate from explicit anchor namespaces. */
export interface ReferenceList extends ReferenceSection {
  /** All entries, including duplicated numbers, in source order. */
  items: ReferenceEntry[];
  /** Heading evidence is optional; explicit anchors never depend on it. */
  supplemental: boolean;
  /** Structural heading identities, independent of their displayed wording. */
  headingPath?: number[];
}

export interface HeadingScope {
  from: number;
  path: number[];
}

export interface ReferenceIndex {
  /** File-wide lookup, used only when a citation cannot select a bibliography. */
  entries: Map<number, ReferenceEntry>;
  /** Ambiguous numbers must never silently resolve to the wrong reference. */
  duplicates: Set<number>;
  /** Independent anchor namespaces; headings never determine reference membership. */
  sections: ReferenceSection[];
  /** Actual reference blocks, not the prose between references in the same namespace. */
  referenceRanges: Array<{ from: number; to: number }>;
  /** Exact, unique anchors take precedence over numeric naming conventions. */
  anchors: Map<string, ReferenceEntry>;
  duplicateAnchors: Set<string>;
  /** Conservative bibliography detection used only for unlinked numeric citations. */
  lists?: ReferenceList[];
  /** Precomputed structural contexts for plain-citation lookup. */
  headingScopes?: HeadingScope[];
}

export interface CitationToken {
  number: number;
  /** The visible number's UTF-16 source range, excluding link syntax. */
  from: number;
  to: number;
  linked: boolean;
  target?: string;
}

export interface CitationGroup {
  from: number;
  to: number;
  label: string;
  numbers: number[];
  /** True if the citation contains explicit links to numbered reference anchors. */
  linked: boolean;
  /** Anchor namespace selected by explicit links or unique number evidence. */
  scopeId?: string;
  /** More than one anchor namespace could supply a plain numeric group. */
  ambiguousScope?: boolean;
  /** Exact same-note anchors in source order, for aligning rendered links safely. */
  linkTargets?: string[];
  /** Displayed numbers before range expansion and deduplication. */
  tokens?: CitationToken[];
  /** Visible citation characters only, never link destinations or escape backslashes. */
  visibleRanges?: Array<{ from: number; to: number }>;
  /** Explicit destination of a link wrapping a whole group, including ^ but not #. */
  outerLinkTarget?: string;
}

export interface ParseOptions {
  maxReferences: number;
  recognizePlainText: boolean;
  /** Path of the source note for validating same-note links. */
  sourcePath?: string;
}

export interface PluginSettings {
  maxReferences: number;
  recognizePlainText: boolean;
  requireModifier: boolean;
  enableEditor: boolean;
  citationLinks: boolean;
  citationColor: 'blue' | 'theme';
}

export const DEFAULT_SETTINGS: PluginSettings = {
  maxReferences: 100,
  recognizePlainText: true,
  requireModifier: false,
  enableEditor: true,
  citationLinks: true,
  citationColor: 'blue'
};
