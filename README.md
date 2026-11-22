# Citation Preview

Display numeric citations in Obsidian as blue links and preview their references together. Hover over a citation such as `[1, 3, 5]` or `[1–10]` to see its references in one Page preview popover. Explicit links resolve through the actual reference block IDs; plain numeric citations can use the nearest detected bibliography in the same Markdown note.

## Why Citation Preview?

An Obsidian link points to a single target. To preview a group such as `[1-10]` or `[3,1-10,12]` whose references live in separate blocks, a native block link would need a dedicated block containing that group. Repeating this for each combination adds material to maintain. [Obsidian block links](https://obsidian.md/help/links)

Existing plugins address different workflows. ZotLit draws on a Zotero library, and Citation Suite resolves Pandoc citation keys using Zotero or a separate `.bib` or CSL JSON file. Inline Annotations displays notes attached to selected text. This leaves a gap for readers who want to preview a numeric citation group from the bibliography already in the current Markdown note. [ZotLit](https://github.com/aidenlx/zotlit) · [Citation Suite](https://github.com/pan4ratte/obsidian-citation-suite) · [Inline Annotations](https://github.com/cetrodk/obsidian-inline-annotations)

Citation Preview was built for that workflow. It assembles the cited entries in memory and displays them through Obsidian's native Page preview, so each reference is maintained once in the bibliography. In AI-assisted note writing, the assistant can preserve the original citations and put the numbered references in the same note. Previewing and navigation run locally, without an AI service, network lookup, helper files, or edits to the note. A separate, manually invoked command can add missing reference anchors when you want persistent block links.

## Quick start

1. Enable **Citation Preview** under **Settings → Community plugins** and the built-in **Page preview** under **Settings → Core plugins**.
2. Paste the contents of this example as ordinary Markdown in a note. The bibliography entries are fictional placeholders.

   ```markdown
   These sources discuss the same topic [3, 1–3].

   A single linked citation keeps its normal preview \[[1](#^ref-1)\].

   Linked range endpoints can preview the entries in between \[[1](#^ref-1)–[3](#^ref-3)\].

   [1] Example reference one. ^ref-1

   [2] Example reference two. ^ref-2

   [3] Example reference three. ^ref-3
   ```

3. In Reading view, resolved citations appear blue. Hover over `[3, 1–3]`: the popover shows references 3, 1, and 2. Click a visible citation number to go to its entry.
4. In Live Preview or Source mode, hold **Ctrl** (Windows/Linux) or **Command** (macOS) while hovering, as for Obsidian's standard editor link previews. Use the same modifier while clicking a generated citation link to navigate; ordinary clicks continue to place the editing cursor. [Obsidian Page preview help](https://obsidian.md/help/plugins/page-preview)

See the [demonstration note](examples/Citation-demo.md) for more examples.

## Citation and reference block format

- Put each citation on one line of normal prose. Use positive integers in square brackets, commas for separate numbers, and a hyphen or en dash for an ascending range.
- Identify main reference blocks with `^ref-1`, `^ref-2`, and so on; use `^sref-1`, `^sref-2`, and so on for supplementary references. The numeric suffix identifies the reference number, and the prefix distinguishes the two sets. Each block ID must be unique throughout the note.
- Reference blocks can appear under any heading or with no heading at all. Both compact lists and lists separated by blank lines work, including multiline entries. Entries with the same prefix belong to the same reference set even when they appear in different parts of the note.
- Link each stated number to its own block. Markdown links such as `\[[1](#^ref-1), [3](#^ref-3)\]` and Wikilinks such as `\[[[#^ref-1|1]], [[#^ref-3|3]]\]` keep the visible outer brackets. Angle-bracket destinations such as `[1](<#^ref-1>)` also work.
- Plain citations such as `[1–3]` use a detected numbered reference list when plain numeric recognition is enabled. Lists sharing a closer structural section with the citation take priority, followed by source proximity. Explicit links provide a stable choice of reference set when main and supplementary bibliographies reuse the same numbers.

The compact forms `^ref1` and `^sref1` are also supported. For additional independent sets, use a named prefix such as `^ref-appendix-1` or `^sref-a-1`, with the reference number after the final hyphen. Link to the exact ID used in the note. A visible list number is optional; the block ID supplies the reference number.

Explicit links use the actual anchors as their source of reference identity:

| Reference block | Citation target | Meaning |
| --- | --- | --- |
| `^ref-1` | `#^ref-1` | Main reference 1 |
| `^sref-1` | `#^sref-1` | Supplementary reference 1 |

### Main and supplementary references in one note

Main reference 1 and supplementary reference 1 coexist because `#^ref-1` and `#^sref-1` identify different blocks. A linked range expands only within the reference set selected by its endpoints: `ref-1` to `ref-3` selects `ref-1`, `ref-2`, and `ref-3`; the corresponding `sref` range selects the three supplementary entries. Previews with identical visible numbers keep their contents separate.

```markdown
Main result: \[[1](<#^ref-1>)–[3](<#^ref-3>)\].

1. Main reference one. ^ref-1
2. Main reference two. ^ref-2
3. Main reference three. ^ref-3

## Supplementary notes
Supplementary result: \[[1](<#^sref-1>)–[3](<#^sref-3>)\].

### Sources
1. Supplementary reference one. ^sref-1
2. Supplementary reference two. ^sref-2
3. Supplementary reference three. ^sref-3
```

The main references in this example have no heading, and the supplementary references use the arbitrary heading `Sources`. Changing either heading, including its language or entry count, does not change how the anchors resolve. A group whose explicit links mix `ref` and `sref` targets is left to normal link behavior; split it into one group for each set.

### Plain citations and nearby reference lists

With **Recognize plain numeric citations** enabled, the plugin can also identify a numbered bibliography without block IDs. List structure and bibliographic content provide the evidence, such as DOI/ISBN identifiers, document-type markers, or author/year/publication details. A heading alone does not turn an arbitrary numbered list into references. Code, mathematics, frontmatter, and ordinary numbered instructions are excluded from this discovery.

For example, these fictional entries have no anchors:

```markdown
The two studies report related results [1-2].

## References

[1] Smith A. Coastal observations [J]. Example Journal, 2024, 12: 10-20.
[2] Chen B. Atmospheric waves [J]. Example Journal, 2025, 13: 21-30.
```

The detected list supplies both entries for `[1-2]`. When several lists exist, a list sharing a deeper parent section with the citation takes priority. For example, a citation in a supplementary chapter selects that chapter's bibliography even when the preceding main bibliography is physically closer. Within the same structural context, proximity is measured between the citation and the list in the Markdown source; an equally close list after the citation is preferred. Without heading context, selection falls back to source proximity across the note. This uses heading structure, not a required heading name or language.

Within a recognized citation group, a missing member is reported instead of retrieving the same number from another list. If no physical list is detected, a unique existing reference-anchor set can still supply a plain citation. An explicit `#^ref-1` or `#^sref-1` link always selects its actual reference set independently of section or proximity rules.

Entries without anchors can be previewed and reached by their source position. This does not add block IDs or rewrite citations. Plain numeric recognition is heuristic: an interval such as `[1-5]` can be indistinguishable from a citation. Turn off **Recognize plain numeric citations** to restrict handling to explicit reference links.

### Add missing reference anchors manually

1. Open the target note in an editor.
2. Open the command palette and run **Citation Preview: Add missing reference anchors**.
3. Check the completion notice. You can undo the insertions in one editing step.

Assign your own shortcut to this command under **Settings → Hotkeys** if desired. No default shortcut is reserved.

The command adds block IDs only to entries in recognized reference lists. It preserves existing IDs, uses separate reference prefixes for independent lists, and skips conflicting or ambiguous entries. Running it again does not add another anchor to the same entry. It does not replace inline citations with Markdown links or renumber the bibliography.

A partially anchored list keeps its existing reference prefix. New lists use `ref` by default or `sref` when a supplementary/appendix heading identifies them; additional independent lists use available prefixes such as `ref-list2`. These naming choices apply only to newly generated IDs. Existing explicit links continue to resolve independently of headings.

**This command is the only feature that writes to your note.** Opening a note, hovering over citations, navigating to references, changing display settings, and building previews do not add anchors automatically.

**Upgrading to 1.3.0:** existing `ref` and `sref` links keep their targets. Plain citations gain nearby-list discovery, and resolved citations use the new blue-link display by default. Existing settings are retained; the new display option can be disabled independently of previews.

## Preview behavior

A group opens one native Page preview popover with an ordered list of references. Ranges expand in place, and repeated numbers appear only at their first occurrence. For example, `[3,1-10,12]` shows `3, 1, 2, 4, 5, 6, 7, 8, 9, 10, 12` in that order. Recognized groups flag missing entries and ambiguous reference numbers. The same number in the main and supplementary sets is valid when the citation identifies its target set.

A single linked citation uses Obsidian's normal direct Page preview. A single unlinked citation can also preview its matching entry when plain numeric recognition is on.

An overall link such as `[1-5](#^ref-1)` has two meanings: its explicit target is reference 1, while its label names the range 1–5. Citation Preview shows both in **one popover**: the explicitly targeted entry first, a horizontal rule (`---`), and the complete expanded group underneath. Reference 1 therefore appears once above the divider and again as part of the five-entry group below. Clicking the existing overall link still follows its original target.

### Link display and navigation

- The complete resolved citation is blue, including the visible outer brackets and separators. The optional theme-color mode uses the current theme's link color, which may not be blue.
- Hovering anywhere in a group opens its combined preview. Clicking a generated visible number navigates to that number's entry; brackets and separators remain group-preview areas.
- For `[1-5]`, the displayed endpoints `1` and `5` can be navigated individually. References 2–4 are included in the group preview; the source text stays `[1-5]`.
- Existing Markdown links and Wikilinks keep their original targets and click behavior. In particular, an existing overall link is not split into nested links.
- References with block IDs use their exact targets. Recognized entries without IDs are reached by line position without writing to the note.
- Editing uses source-range decorations, so destinations such as `#^ref-1` and hidden Markdown syntax are not recolored as citation text. Normal selection and cursor placement remain available.
- Missing, duplicate, or ambiguous targets do not receive newly generated valid navigation links. Changes to reference targets refresh the corresponding display state.

| Setting | Default | Effect |
| --- | --- | --- |
| Maximum references per group | 100 | Skip groups larger than the configured limit. |
| Recognize plain numeric citations | On | Resolve bracketed numbers using section context and the nearest detected reference list, including unanchored entries. Turn this off if ordinary numeric intervals are mistaken for citations. |
| Show citations as links | On | Color resolved citations and add navigation for visible plain-text numbers. Turning this off keeps previews and existing Markdown links. |
| Citation color | Blue | Choose blue colors for light/dark themes or follow the current theme's link color. |
| Require modifier key | Off | Require Ctrl or Command while hovering in Reading view. |
| Enable editor previews and links | On | Show previews and link decorations in Live Preview and Source mode, using the standard editor modifier for navigation. |

## Dependencies and limits

- **Obsidian's built-in Page preview must be enabled for previews.** Citation Preview uses Obsidian's private embed registry and renderer to display groups. Changes to those internals can affect compatibility across app versions. The minimum supported version remains **Obsidian 1.15.1**.
- The plugin uses numeric Markdown citations and reference entries in the current note. Author–date citations, general CSL processing, and resolving references from external sources are outside its scope. Citation lookup needs only Obsidian and the current note.
- Automatic bibliography detection is conservative and may skip unusual formats. For deterministic resolution, give entries supported unique block IDs and link to those exact IDs. Explicit anchor-based resolution never depends on a bibliography heading.
- The preview is designed for desktop mouse hover. There is no dedicated touch gesture.
- Automated checks cover parsing, DOM behavior, plugin lifecycle boundaries, and real CodeMirror editing state. They do not replace visual verification in every Obsidian version and theme.

## Install or update

**Manual installation.** Download `citation-preview-<version>.zip` from GitHub Releases or build it below. Extract the `citation-range-preview` folder into the vault's `plugins` directory, usually `<vault>/.obsidian/plugins/`. The files `main.js`, `manifest.json`, and `styles.css` must sit directly inside that folder. Reload Obsidian and enable **Citation Preview**. To update manually, replace those three files in the existing folder and keep `data.json` to retain your settings. [GitHub Releases](https://github.com/lyingTree/citation-preview/releases)

## Development

Use Node.js 24 and the committed lockfile.

```sh
npm ci
npm run check
npm run package
```

`npm run check` builds the plugin, runs the tests, and lints the source. `npm run package` packages the build as `dist/citation-preview-<version>.zip`. Use `npm run dev` to watch for changes during development.

## Report a problem

Include your Obsidian version, view mode, and a minimal note with the citation and matching bibliography. [Open an issue](https://github.com/lyingTree/citation-preview/issues)

## License

[MIT](LICENSE), copyright 2026 Chuangwu Deng.
