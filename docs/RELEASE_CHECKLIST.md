# Release checklist

## Validate the source

- Install the locked dependencies with Node.js 24 and run `npm run check`.
- Run `npm run package` and confirm the installation ZIP contains `main.js`, `manifest.json`, and `styles.css` under `citation-range-preview/`.
- Check that the manifest, package metadata, compatibility map, and release tag agree.
- Verify the regression cases for reference blocks with arbitrary or absent headings, compact reference lists, and independent `ref`/`sref` numbering.

## Verify in Obsidian

Enable the core Page preview plugin and open the [demonstration note](../examples/Citation-demo.md).

- Hover a single linked citation and check the direct block preview.
- Hover the ends and separator of a linked range and check the complete group.
- Verify that mixed groups preserve first occurrence order and display each reference number once.
- Check that missing and duplicate reference numbers receive distinct messages.
- Verify close behavior, typography, and list spacing in Reading view and confirm group previews work in the editor using its Page preview modifier.
- Check that editing bibliography text refreshes the next preview without creating helper files.
- Copy the main/supplementary example into a separate note. Hover both linked `[1–3]` groups in either order and confirm that each displays only its own reference set.
- Rename or remove the reference headings and move one entry elsewhere in the note. The same reference IDs and ranges must continue to resolve.
- Edit a title in each bibliography, save the note, and confirm that both existing citation groups refresh without exchanging contents.
- Check that an ambiguous plain `[1–3]` does not silently select either reference set, and that duplicate block IDs never silently resolve to an arbitrary entry.
- Check same-note relative and encoded link destinations in Reading view and the editor. Numeric figure/equation links must retain their ordinary behavior.

## Publish

Create a tag matching the manifest version, without a `v` prefix. Check the release workflow and verify all four assets on the GitHub release. Community directory publication is a separate process.
