# Citation Preview

Preview numeric citations in Obsidian using the bibliography already in the same Markdown note. Hover over a citation such as `[1, 3, 5]` or `[1–10]` to see the corresponding references together in a Page preview popover.

## Why Citation Preview?

An Obsidian link points to a single target. To preview a group such as `[1-10]` or `[3,1-10,12]` whose references live in separate blocks, a native block link would need a dedicated block containing that group. Repeating this for each combination adds material to maintain. [Obsidian block links](https://obsidian.md/help/links)

Existing plugins address different workflows. ZotLit draws on a Zotero library, and Citation Suite resolves Pandoc citation keys using Zotero or a separate `.bib` or CSL JSON file. Inline Annotations displays notes attached to selected text. This leaves a gap for readers who want to preview a numeric citation group from the bibliography already in the current Markdown note. [ZotLit](https://github.com/aidenlx/zotlit) · [Citation Suite](https://github.com/pan4ratte/obsidian-citation-suite) · [Inline Annotations](https://github.com/cetrodk/obsidian-inline-annotations)

Citation Preview was built for that workflow. It assembles the cited entries in memory and displays them through Obsidian's native Page preview, so each reference is maintained once in the bibliography. In AI-assisted note writing, the assistant can preserve the original citations and put the numbered references in the same note. Previewing them runs locally, without an AI service, network lookup, helper files, or edits to the note.

## Quick start

1. Enable **Citation Preview** under **Settings → Community plugins** and the built-in **Page preview** under **Settings → Core plugins**.
2. Paste the contents of this example as ordinary Markdown in a note. The bibliography entries are fictional placeholders.

   ```markdown
   These sources discuss the same topic [3, 1–3].

   A single linked citation keeps its normal preview \[[1](#^ref-1)\].

   Linked range endpoints can preview the entries in between \[[1](#^ref-1)–[3](#^ref-3)\].

   ## References

   [1] Example reference one. ^ref-1

   [2] Example reference two. ^ref-2

   [3] Example reference three. ^ref-3
   ```

3. In Reading view, hover over `[3, 1–3]`. With the default settings, the popover shows references 3, 1, and 2. In Live Preview or Source mode, hold **Ctrl** (Windows/Linux) or **Command** (macOS) while hovering, as for Obsidian's standard editor link previews. [Obsidian Page preview help](https://obsidian.md/help/plugins/page-preview)

See the [demonstration note](examples/Citation-demo.md) for more examples.

## Citation and bibliography format

- Put each citation on one line of normal prose. Use positive integers in square brackets, commas for separate numbers, and a hyphen or en dash for an ascending range.
- Put the bibliography under a supported heading such as `## References` or `## Bibliography` in the same note. Start each entry with its explicit number, such as `[1]`, `[2]`, `[3]`, and separate entries with a blank line. Explicitly numbered Markdown list entries such as `1.`, `2.`, `3.` also work. A list using `1.` for every item contains duplicate reference numbers in the source, even if it renders as a sequential list.
- For linked citations, give each target entry a unique block ID and link the matching number to it. Markdown links such as `\[[1](#^ref-1), [3](#^ref-3)\]` and Wikilinks such as `\[[[#^ref-1|1]], [[#^ref-3|3]]\]` keep the visible outer brackets and link the numbers to their own entries. Plain citations do not require block IDs.

## Preview behavior

A group opens one native Page preview popover with an ordered list of references. Ranges expand in place, and repeated numbers appear only at their first occurrence. For example, `[3,1-10,12]` shows `3, 1, 2, 4, 5, 6, 7, 8, 9, 10, 12` in that order. Recognized groups flag missing entries and duplicate numbers in the bibliography.

A single linked citation uses Obsidian's normal direct Page preview. A single unlinked citation can also preview its matching entry when plain numeric recognition is on. Body links keep their normal Obsidian click behavior, and the preview adds no jump buttons.

| Setting | Default | Effect |
| --- | --- | --- |
| Maximum references per group | 100 | Skip groups larger than the configured limit. |
| Recognize plain numeric citations | On | Preview bracketed numbers without links. Turn this off if ordinary numeric intervals are mistaken for citations. |
| Require modifier key | Off | Require Ctrl or Command while hovering in Reading view. |
| Enable editor previews | On | Preview in Live Preview and Source mode with the standard editor modifier. |

## Dependencies and limits

- **Obsidian's built-in Page preview must be enabled.** Citation Preview uses Obsidian's private embed registry and renderer to display groups. Changes to those internals can affect compatibility across app versions. The minimum supported version is **Obsidian 1.15.1**, tested on desktop.
- The plugin uses numeric Markdown citations and explicitly numbered references in the current note. Author–date citations, general CSL processing, and resolving references from external sources are outside its scope. Citation lookup needs only Obsidian and the current note.
- Plain numeric recognition is heuristic. A bracketed interval can look like a citation when the note has matching numbered references. Check the heading, explicit numbering, and block targets if a preview is missing.
- The preview is designed for desktop mouse hover. There is no dedicated touch gesture.

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
