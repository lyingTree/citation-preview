/** A reference number is local to exactly one Markdown file. Offsets are UTF-16. */
export interface ReferenceEntry {
  number: number;
  markdown: string;
  from: number;
  to: number;
  line: number;
  /** Existing ^block-id or #heading/HTML anchor, without the leading #. */
  anchor?: string;
}

export interface ReferenceIndex {
  entries: Map<number, ReferenceEntry>;
  /** Ambiguous numbers must never silently resolve to the wrong reference. */
  duplicates: Set<number>;
  /** UTF-16 ranges occupied by bibliography sections. */
  sections: Array<{ from: number; to: number }>;
}

export interface CitationGroup {
  from: number;
  to: number;
  label: string;
  numbers: number[];
  /** True if the citation contains explicit links to numbered reference anchors. */
  linked: boolean;
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
