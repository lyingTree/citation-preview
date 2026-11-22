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
}

export const DEFAULT_SETTINGS: PluginSettings = {
  maxReferences: 100,
  recognizePlainText: true,
  requireModifier: false,
  enableEditor: true
};
