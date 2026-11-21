# Citation Preview demonstration

> All ten references in this note are fictional test fixtures. Their authors, titles, journal, years, and pagination are invented for demonstration. Do not cite them as research or add them to a real bibliography.

Copy this note into an Obsidian vault with Citation Preview and the Page preview core plugin enabled. Start in Reading view and hover over a citation to see its references. In an editor, follow Obsidian's modifier-key setting for Page preview.

All examples use the same References section at the end of this note. Each entry starts with its unique number and ends with its matching block ID.

## Plain citations

A single citation previews one entry: [1].

Multiple citations preview exactly three entries: [1, 3, 5].

A continuous range previews all ten entries: [1-10].

An en dash gives the same ten-entry range: [1–10].

A mixed group previews seven entries: [1–3, 5, 8–10].

This group deliberately includes a missing reference: [1–3, 99]. The card should list the first three entries and report reference 99 as missing, in the preview.

## Markdown links with angle-bracket destinations

These examples keep visible square brackets around the citation and link each stated number to its own reference block. The range examples link their endpoints, while Citation Preview supplies the intermediate entries in the card.

A single linked citation: \[[1](<#^ref-1>)\].

Multiple linked citations: \[[1](<#^ref-1>), [3](<#^ref-3>), [5](<#^ref-5>)\].

A linked range: \[[1](<#^ref-1>)-[10](<#^ref-10>)\].

A linked mixed group: \[[1](<#^ref-1>)-[3](<#^ref-3>), [5](<#^ref-5>), [8](<#^ref-8>)-[10](<#^ref-10>)\].

Hover over each citation to preview its complete group. Clicking a number in the body follows Obsidian's native link behavior for the current mode.

## Other supported link forms

A Markdown range without angle brackets around its destinations: \[[1](#^ref-1)-[10](#^ref-10)\].

A single Wikilink citation: \[[[#^ref-1|1]]\].

Multiple Wikilink citations: \[[[#^ref-1|1]], [[#^ref-3|3]], [[#^ref-5|5]]\].

A Wikilink range: \[[[#^ref-1|1]]-[[#^ref-10|10]]\].

A mixed Wikilink group: \[[[#^ref-1|1]]-[[#^ref-3|3]], [[#^ref-5|5]], [[#^ref-8|8]]-[[#^ref-10|10]]\].

## Additional checks

- Hover over the beginning, separator, and end of a range; each should open the same complete group.
- Confirm a single linked citation uses the standard block preview.
- Copy this note before testing duplicate numbering. Add a second entry numbered 4 to the copied bibliography and confirm that its preview reports the ambiguity.
- Change a fictional title in the bibliography, then hover over its citation again to check that the preview updates.
- Open another note with a different reference 1 and confirm that each note resolves its own bibliography.
- Try reading view, Live Preview, and source mode separately. Editor previews are enabled by default.
- Turn off **Recognize plain numeric citations** and confirm that the explicit linked forms still work. Turn it back on for the plain examples.

## References

[1] Example Author One. (2091). Fictional demonstration of a coastal signal. Journal of Fictional Preview Fixtures, 1, 1–2. **Fictional test reference.** ^ref-1

[2] Example Author Two. (2092). Fictional demonstration of a wave pattern. Journal of Fictional Preview Fixtures, 2, 3–4. **Fictional test reference.** ^ref-2

[3] Example Author Three. (2093). Fictional demonstration of a numerical grid. Journal of Fictional Preview Fixtures, 3, 5–6. **Fictional test reference.** ^ref-3

[4] Example Author Four. (2094). Fictional demonstration of a boundary condition. Journal of Fictional Preview Fixtures, 4, 7–8. **Fictional test reference.** ^ref-4

[5] Example Author Five. (2095). Fictional demonstration of a reference lookup. Journal of Fictional Preview Fixtures, 5, 9–10. **Fictional test reference.** ^ref-5

[6] Example Author Six. (2096). Fictional demonstration of a scaling rule. Journal of Fictional Preview Fixtures, 6, 11–12. **Fictional test reference.** ^ref-6

[7] Example Author Seven. (2097). Fictional demonstration of a time series. Journal of Fictional Preview Fixtures, 7, 13–14. **Fictional test reference.** ^ref-7

[8] Example Author Eight. (2098). Fictional demonstration of a graph connection. Journal of Fictional Preview Fixtures, 8, 15–16. **Fictional test reference.** ^ref-8

[9] Example Author Nine. (2099). Fictional demonstration of an observation. Journal of Fictional Preview Fixtures, 9, 17–18. **Fictional test reference.** ^ref-9

[10] Example Author Ten. (2100). Fictional demonstration of a complete citation range. Journal of Fictional Preview Fixtures, 10, 19–20. **Fictional test reference.** ^ref-10
