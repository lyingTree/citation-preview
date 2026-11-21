# Release checklist

## Validate the source

- Install the locked dependencies with Node.js 24 and run `npm run check`.
- Run `npm run package` and confirm the installation ZIP contains `main.js`, `manifest.json`, and `styles.css` under `citation-range-preview/`.
- Check that the manifest, package metadata, compatibility map, and release tag agree.

## Verify in Obsidian

Enable the core Page preview plugin and open the [demonstration note](../examples/Citation-demo.md).

- Hover a single linked citation and check the direct block preview.
- Hover the ends and separator of a linked range and check the complete group.
- Verify that mixed groups preserve first occurrence order and display each reference number once.
- Check that missing and duplicate reference numbers receive distinct messages.
- Verify close behavior, typography, and list spacing in Reading view and confirm group previews work in the editor using its Page preview modifier.
- Check that editing bibliography text refreshes the next preview without creating helper files.

## Publish

Create a tag matching the manifest version, without a `v` prefix. Check the release workflow and verify all four assets on the GitHub release. Community directory publication is a separate process.
