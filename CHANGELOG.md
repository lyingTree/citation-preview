# Changelog

## 1.3.0

- Display resolved citations as blue links, including their outer brackets and separators, with an option to use the current theme's link color. Keep existing links and native single-reference previews; add navigation for resolved plain-text citation numbers without rewriting the note.
- Keep editor syntax and link destinations in their normal colors. Ordinary editor clicks still place the cursor; modified clicks navigate to the corresponding reference.
- Show an explicitly linked citation group such as `[1-5](#^ref-1)` in one preview with the specified reference first, a horizontal rule, and the full expanded group below. Preserve the existing link's click target.
- Recognize nearby numbered reference lists for plain numeric citations, including lists without block anchors. Prefer the same structural section, then the nearest detected list; report missing entries there instead of borrowing from another list. Exact `ref` and `sref` links continue to use their actual anchors independently of bibliography headings.
- Add the manually invoked **Add missing reference anchors** command. It adds missing block IDs to recognized reference entries in the current note, keeps existing IDs, avoids collisions, and applies edits as one undoable editor transaction. Normal previewing and navigation do not write to the note.
- Add regression coverage for list selection, anchor insertion, visible citation ranges, link preservation, grouped previews, and editor interactions. Keep the plugin ID `citation-range-preview` and minimum Obsidian version `1.15.1`.

## 1.2.0

- Identify references directly from their `^ref-N` and `^sref-N` block IDs, without requiring a bibliography heading. References work under arbitrary headings or with no heading, including notes whose headings contain section numbers or entry counts.
- Also support compact IDs such as `^ref1` and named sets such as `^ref-appendix-1`. Unanchored numbered lists no longer create reference entries; existing plain citations need identifiable reference blocks.
- Keep independent indexes for main and supplementary anchor prefixes, even when entries appear in different parts of a note. Resolve linked citations by their actual targets and expand ranges only within the selected reference set.
- Separate previews and refreshes for groups with identical visible numbers but different reference targets. Check the exact rendered link targets so figure or equation links cannot consume a citation's preview.
- Use the same local-link validation in Reading view and the editor, including relative and encoded note paths.
- Preserve compact and spaced reference lists and multiline reference blocks. Retain ambiguity reporting when a plain numeric citation does not identify a unique reference set.
- Add regression coverage and a copyable main/supplementary demonstration. Keep the plugin ID `citation-range-preview` and minimum Obsidian version `1.15.1`.

## 1.1.1

- Make the native Page preview implementation available as an update for the existing Obsidian Community listing. The plugin keeps its existing ID, settings, and same-note bibliography format.

## 1.0.1

- Explain in the README why Citation Preview uses the current note's bibliography, how it differs from library-backed citation tools and inline annotations, and how it fits AI-assisted note writing.

## 1.0.0

- Use Obsidian Page preview for numeric citation groups, with typography and numbered lists matching standard block previews.
- Assemble groups from the current note's bibliography in memory. Reuse parsed documents and render each preview in one pass.
- Keep single linked citations on Obsidian's direct preview path. Page preview controls opening and closing, and body links retain their usual click behavior.
- Require Page preview and Obsidian 1.15.1. The integration relies on Obsidian's private Markdown embed interface.
