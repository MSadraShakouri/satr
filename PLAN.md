# The plan

The finalized batch order for reaching v1.0.0, agreed before work started.
Each batch lands as its own PR into **`dev`** and is iterated on with the
writer before the next begins; **`main` stays frozen as the release line**
and receives the work only when a milestone is called stable (`dev` → `main`,
merges kept — the history stays bisectable). The full item-by-item checklist
lives in ROADMAP.md; this file is the shape of the work.

- [x] **Batch 1 — Tables in print and preview.** Manual `<!-- table: rtl|ltr|auto -->` direction with a tap menu; tables stay LTR in print; horizontal scrolling in the preview without the drawer grabbing the drag; page breaks keep rows together (minimum 3 body rows on either side of a break, the header never repeats, taller-than-page tables still split); images capped at 9 cm in print.
- [x] **Batch 2 — Dates and timestamps.** Timestamps follow the app's language, never the device's; a Dates settings group (language + calendar, Jalali included) with a live sample; the date picker sheet that inserts `<t:unix[:fmt]>` codes — month/year jump box, digit-slot time row with seconds, Today/Now, an in-sheet Gregorian ⇄ شمسی switch, a calendar whose runway grows mid-scroll (the browser owns the fling).
- [ ] **Batch 3 — Caret and direction in the editor.** Arrow keys predictable (right = next in English, left = next in Persian); a date at a line's start stops forcing the caret LTR; the end-of-line caret follows the text's own direction.
- [ ] **Batch 4 — Editor polish.** Title jump on new files; source-to-preview scroll alignment; top-of-view scroll behavior mirrored; notices never covering the panes; the toolbar ≡ as a growing popup.
- [ ] **Batch 5 — In-app lint and fixer.** Report plus "fix all safe": `$$` lazy list continuations, redundant `<div dir=ltr>` pairs (stripped only around English), trailing-`:` and trailing-space headings, list indent and empty-item slips, every formula through renderMath. The spec is frozen; see ROADMAP.
- [ ] **Batch 6 — Images.** Adding and editing images in the note, with crop. The writer tests this batch only when its pickers exist.
- [ ] **Batch 7 — Launch and opening (browser half).** A new tab at launch lands on its own page without a flash of the old one. The APK-side halves (opening an already-open tab from an external app, the white splash) wait for the APK.
- [ ] **Batch 8 — Tablet layout.** Single pane, explicitly chosen. Blocked on the official Obsidian APK.
- [ ] **Batch 9 — GitHub connection.** Later, by design.

When every batch has been through the writer's hands and feels right → **v1.0.0**: `dev` merges into `main`, and `main` gets its tag.
