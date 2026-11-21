# Changelog

## 1.0.1

- Explain in the README why Citation Preview uses the current note's bibliography, how it differs from library-backed citation tools and inline annotations, and how it fits AI-assisted note writing.

## 1.0.0

- Use Obsidian Page preview for numeric citation groups, with typography and numbered lists matching standard block previews.
- Assemble groups from the current note's bibliography in memory. Reuse parsed documents and render each preview in one pass.
- Keep single linked citations on Obsidian's direct preview path. Page preview controls opening and closing, and body links retain their usual click behavior.
- Require Page preview and Obsidian 1.15.1. The integration relies on Obsidian's private Markdown embed interface.
