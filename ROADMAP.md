# Satr roadmap

A to-do roadmap for the complete Satr editor. The original product decisions and phased work are retained below, with actionable items expressed as task checkboxes. Mermaid is postponed until the core editor and preview are stable.

## Current status (September 2026)

Satr runs as a web app (Vite + TypeScript + CodeMirror 6). Notes are files in
folders behind one storage interface: a virtual file system in localStorage on
the web, and a device backend (Capacitor Filesystem, untested until the APK). The Android APK (Capacitor 7) comes after the UI
and the logic below are finished. The `android/` project exists (Capacitor 7, with Satr's own print and storage plugins), and GitHub Actions builds a signed debug APK for each `v*` tag; it hasn't run on a phone yet.

### Done

Editor
- [x] CodeMirror editor: per-line RTL/LTR, line numbers, soft wrap, list continuation (Persian digits too)
- [x] Live preview in the editor (Obsidian rule: syntax shows when the caret enters it): headings, emphasis, lists with a space rule, tasks, quotes, footnotes, links. Inside `$…$` / `$$…$$` source no marker is hidden and no element is styled: a `**` is never bold, `==…==` never highlighted, a `[a](b)` never a link, `` `c` `` never code and a `[^1]` never a footnote reference — all of them are characters of the formula, in one font, one colour and one weight, whatever the theme does with a link or a code span outside it (7, 11)
- [x] Inline file title that renames the note
- [x] Tight character-level selection highlight, clipped between rows so neighbouring highlights meet at the midpoint between them — no gap, no overlap; roomier 1.85 default line spacing. Select-all and widget-heavy lines stay robust: widgets are never painted (the file title included) and rows fall back to the caret geometry when text runs can't be measured (13). Ctrl/Cmd+A selects the whole note even when the note itself hasn't got the focus (a tap on the title or the app chrome leaves it on the page); a field with its own select-all — the find bar, settings — keeps it (9)
- [x] Keyboard toolbar 8px above the keyboard, scrolling like Obsidian's (undo/redo, heading, lists, to-do cycle, footnote, math, delete line, new line below, move line), and a round hide-keyboard button beside it. "New line below" is Enter at the end of the line — it continues a list with the writer's own number, carries a to-do line's checkbox, continues a quote and reveals the marker — never an empty line under the text, and the same chain the Enter key runs, so the two cannot drift apart
- [x] Context-aware pairs: brackets, quotes, backticks, `$`, `*`, `_`, `=`, `~`, `%`; code, math, escapes and existing closers are distinguished. Keyboard and math toolbar share the same policy. `$$` on an empty line opens a math block; only tracked empty pairs are deleted together.
- [x] Markor's keyboard: word auto-correct and the suggestion strip on, no spell-check underlines (red squiggles) or writing-suggestions underlines anywhere in the note
- [x] ~~A space rule before closing brackets and punctuation~~ — decided against: the editor never second-guesses a space (typed or sent by the keyboard's auto-correct); the rule that dropped one before `)` turned out to be more trouble than it was worth (10)
- [x] Math source styled like Obsidian (the content between the dollars is monospace, italic; the dollars themselves keep the note's font in the accent colour — a `$$`-only line is never monospace), never rendered while editing. Only a `$$ … $$` pair whose dollars sit on different lines is a display block (the empty writing line included); `$$$$` / `$$ $$` with nothing between, a lone unpaired `$$`, and a pair a heading, a list item, a quote, a rule, a footnote definition or a fence broke are plain text — their dollars are ordinary text and nothing between them is styled as math. One policy (src/mathScan.ts) answers that question for the editor, the reading view and the note's direction alike, so the three can never disagree (11, 12)
- [x] Caret arrows walk mixed-direction lines in visual order and stop on both sides of an RTL/LTR junction — no jumping or doubling back at a boundary; shift+arrows extend with the same stepping. On a soft-wrapped line the step stays on the caret's own row (each row of a wrapped line shares its x with the rows above and below), and the caret keeps the side that paints on that row, so stepping back over a line break moves up instead of standing still (3, 7). After any edit the caret keeps the line's side, not the side of the character that was just typed or deleted: the side comes from the line's own direction, so a number or an English word written inside Persian text never pushes the caret to the other side of what you are writing, and within one line the caret never doubles back (17)
- [x] ~~The line-number gutter moves to the note's majority side~~ — decided against: the line numbers keep the left edge, like every editor, and the file name with them. A gutter that changed sides with the note's language was more to explain than it was worth (10, 13)
- [x] Math digits (Settings → Editor): formulas show all their digits in one set — as typed, English, or Persian — in the preview and the PDF alike, and the note keeps the digits that were typed (5)
- [x] Switching between editing and reading keeps the same place: the mapping measures the rendered math and table heights and re-measures as they settle (fonts, the Android grow-box pass, images), compensating the scroll (9)
- [x] Footnotes: insert at the caret, write the note in a popover at the reference
- [x] Wiki links `[[Note]]`, `[[Note|text]]`, `[[Note#Heading]]`: styled in the editor, tap to open, a popup of notes while typing `[[`; broken links dimmed in the reading view
- [x] Images in the reading view and the PDF, centred and at most the text's width: `![alt](path)` relative to the note, `![[name.png]]` found anywhere by name (as Obsidian), optional size `|300` or `|300x200`; a dashed placeholder for a missing picture
- [x] `==Highlight==` as in Obsidian (editor, reading view, PDF)
- [x] The note always has room under its last line: the page scrolls a good deal further than the text, and a tap below the last line puts the caret at the end of the note. The room is for the writer's own scrolling — typing never spends it: the caret walks down through it, and the page moves by a line at most, so writing at the end of a note does not slide the text away under the caret. Enter reveals the line it opens, in the room the note already has (16, 20, 22)
- [x] Undo history per note (never undoes into the previous note)
- [x] Heading folding in the editor and the preview (chevron at the end of the heading line), fold/unfold all, remembered per note
- [x] Find and replace in one bar: regular expressions ignoring case (`$1` in replacements), from the caret, every match highlighted (a setting), a chevron drops down the replace row; the count sits where the query ends (on the left, in Persian digits, for a Persian query)
- [x] Keeps the caret clear of the keyboard without jumping or locking the scroll

Preview
- [x] Ordered lists keep the number the writer typed — a `۲.` is `2.` in the reading view and the PDF, never renumbered to `1.` — while the writer's own `1.` starts a fresh list (19)
- [x] Reading view: sections tagged with source lines, KaTeX with balanced math line breaking (first at the writer's line ends, then commas, then relations repeated on continued lines, then at spaces typed between words, including inside `\text`; never at + or −; a group in plain parentheses or brackets is a step behind all of these, so a group that fits is never broken and one too wide breaks inside itself at its own punctuation instead of at an arbitrary atom) (8), inline math kept left to right inside Persian text, dollar signs in code left alone, code highlighting and copy, tables, footnotes in popovers, title on top. KaTeX's SVG signs (\vec arrow, stretchy brackets, roots) size in CSS ems so Android's text scaling moves them with their letters; Persian inside a formula reads right to left in every case — a `\text{…}` run, and equally a word written bare, or inside a fraction, a root or any other command — while the formula itself stays left to right (23)
- [x] Edit/preview switch keeps the position; double-tap the preview to edit
- [x] Rendered only when visible (about 14x faster typing on long notes)

Chrome
- [x] Obsidian themes: exact neutral colours, light/dark/auto
- [x] Floating top buttons and bottom bar with Obsidian's icons (in Obsidian's order: previous / next tab, find, new note, tabs, and the ≡ menu); they hide while scrolling down, with Obsidian's fade masks. The right drawer has no button, as in Obsidian (swipe from the right edge, or Ctrl/Cmd+Shift+F)
- [x] Both drawers share one implementation of Obsidian's release physics (drag, fling, re-grab mid-animation, same look)
- [x] Right drawer: outline and search in one view, built like the left drawer. A two-option pill (tap only) picks This note / All notes. This note: the outline, and while searching the matching headings with each match under its heading. All notes: every note with its outline, even before you type; searching narrows it to the same heading tree under each note. Each match shows its line number and up to seven lines of context. The outline tree flips to the note's majority direction while every heading keeps its own. Regular expressions; the outline's current heading is the one two thirds down the page, not the one that has just left the top edge (21)
- [x] Tabs: every note opens in its own tab (an open note just switches to its tab); the bottom bar's arrows step through the tabs; switching never opens the keyboard and comes back where you were. A tab button with the count, the full-screen switcher (note previews in two columns, close, "+", "N tabs" menu, Done, press and hold a card to drag it to a new place), an empty tab page ("No file is open" with recent notes), swipe a card away to close, reopen closed tab, kept across restarts
- [x] Left sidebar: filter by name (found files and folders, flat, with their folder); Obsidian-style file tree of the space (folders open in place, sorting, the open note highlighted — and only the open one: the tree is redrawn when the drawer opens if the note changed while it was closed), long-press menu (new note/folder, rename in place, move, delete, use as a space), floating action buttons. Every file opens
- [x] "All files" walker (Markor-style): only the current folder, ".." to go up
- [x] Space switcher (vault-switcher style): spaces are shortcuts to folders; their notes are ordinary files, edited in place. "All files", add or remove a space
- [x] Bottom-sheet menus in Obsidian's phone style
- [x] Settings page (gear in the left drawer): theme, font size, line spacing, line numbers, highlight every match, which toolbar buttons show
- [x] Android back button, Obsidian's order: menus, popovers, the tab switcher, settings and the find bar close first, then the drawers; then "Press back again to exit." (a second press within 5s leaves the app). Works in the browser too, through the page history
- [x] UI chrome can't be selected as text; only the note, footnotes and fields can
- [x] Per-file reading memory: mode, fractional source-line position, caret and folds survive tab closure/reopening and app restarts; late font/image/scroll callbacks are cancelled on navigation or reader intent. Incoming Android files use a stable URI bookmark identity, not their temporary grant ID.
- [x] Session-only per-tab undo/redo: switching tabs or losing focus preserves both stacks; actual tab/app closure discards them. External text reloads remain undoable; no persistent revision manager.
- [x] Shared contextual direction inference in editor, preview and PDF: first strong prose; unanimous preceding section before neighbours; preceding prose breaks a mixed tie; headings are boundaries. Digits are neutral, math/code never vote and remain LTR. Full-document editor context is cached independently of the viewport. A line with no letter of its own — a bare number, a date, a `#`, a list marker — continues the line above it whatever the note's majority says, so an English headline never turns the Persian line under it around (18)
- [x] Cold start: the last screen is painted from a copy before the app's code has loaded, then the real app takes over underneath
- [x] Right drawer, All notes: only the current note starts open; each chevron has a wide tap area

### Remaining before the APK: UI

- [ ] Gesture audit on a phone: every swipe and slide (drawer edges, swipe from over the toolbar, find bar, tab switcher and card swipes, bottom sheets, the scope pill, text selection near the edges)
- [ ] Keyboard toolbar: reorder buttons in Settings (show/hide is done)
- [ ] Wiki links: hide the brackets in live preview when the caret is elsewhere (Obsidian does; needs care so typing never lands in a hidden range)
- [ ] First run on the device: no space yet leads to picking a folder (needs the APK's storage)
- [ ] Persian UI strings (later)

### Remaining before the APK: logic

- [x] Storage layer behind one interface: a web backend (localStorage, as now, for development) and a native backend (device files)
- [x] Spaces: a space is just a folder path saved in the app's own settings. Nothing is ever written into the folder (no `.obsidian`-style config). "All files" is the storage root.
- [x] Rename, move and delete; view memory and history keyed by path (real files: verify in the APK)
- [ ] Autosave to the file (debounced, flushed on background or file switch); check the modification time on resume and before saving, and offer reload or keep if the file changed outside Satr
- [x] Reopen the last tabs on launch; a note that's gone falls back to the first note in the space
- [ ] Search index per space (read files lazily, cache the text, refresh on modification time)

### PDF export (done, September 2026)

- [x] ≡ menu in the bottom bar, as Obsidian's ribbon menu: collapse / expand all headings, reading / editing view, Export to PDF, rename, delete note, settings. Settings → Navigation bar → Menu button picks a quick action: a tap runs it (its icon, with a small chevrons-up-down flair), holding opens the menu
- [x] Export to PDF straight to Android's print dialog (as Markor), where "Save as PDF" writes the file under the note's name; in the browser, the browser's print dialog
- [x] The look: Vazirmatn 15px at 1.8, never justified, each paragraph in its own direction; headings 1.6 / 1.4 / 1.25 / 1.1× in bold with Markor's rule under h1 and h2, kept with what follows; tables centred as in the reading view; code in a light grey box with the preview's colours; blue underlined links (clickable in the PDF); wiki links as plain text; task boxes as in the reading view; no title on top
- [x] Per-file export options in Settings → PDF export (beside page numbers and CSS, not an export popup): one or two columns, centred or reading-edge display math, and automatic/prose-majority or explicit LTR/RTL reading order. Preferences stay in the app, follow file/folder renames and never rewrite Markdown. Two-column layout paginates at column width, then pairs columns onto A4 without scaling text.
- [x] Stranded-heading protection at page/column boundaries (Paged.js overflow hook); consecutive headings travel with following content rather than being left alone at the bottom.
- [x] A4, 1in margins; page numbers at the bottom centre, 12pt, in Persian digits (Settings: Persian / Latin / none)
- [x] Footnotes at the foot of their page (Paged.js), numbered from 1 on every page, under a short Word-style rule on the start side; the call's digits follow its paragraph, the note's its own text
- [x] Long formulas wrapped at the page's width by the same rules as on screen
- [x] Page breaks: `\pagebreak`, `\newpage`, `\clearpage`, `<!-- pagebreak -->`, `<!-- newpage -->`, or any HTML with a page-break style (`page-break-before: always`, `break-after: page`…); hidden on screen, ignored inside code
- [x] Custom CSS (Settings → PDF export), applied after Satr's own; per-file math alignment and fixed two-column page geometry take precedence
- [x] Fonts (Vazirmatn, Vazir Code, KaTeX) embedded as data URIs; Paged.js (≈500 KB) loads only when exporting
- [x] The font-scale override used while measuring is an adopted stylesheet, never a `<style>`: Paged.js takes every style element out of the document and copies its text into the stylesheet it prints with, which once divided every font size in the PDF by the phone's scale and made it tiny
- [x] Images embedded as data URIs, centred, never split across pages
- [x] The pages handed to the app's print WebView are pinned to the A4 geometry Paged.js measured, and that WebView views them at the paper's width: Paged.js's own `@media print` rules tie `html`, `body`, `.pagedjs_pages`, `.pagedjs_page` and `.pagedjs_sheet` to 100% of the print viewport, and the print WebView has the phone's, so every sheet was clipped to the screen's height and the body was capped at its width — the bottom of each page, and in two-column mode the whole second column, never reached the paper. The browser's dialog was never affected (it prints the export iframe, which is A4-tall), which is why only the app's PDFs were cut. Paged.js's letter-sized `@page` is overridden with A4, no margins, as the last word in the cascade; the spent `<template>` and the scripts go out with the string
- [ ] On-device check of the print path (fonts, links, page size), including the new two-column layout

### APK phase

- [x] `npx cap add android`, app id com.msadrashakouri.satr (committed; `MainActivity` registers `PrintPlugin`, `StoragePlugin` and `SystemBarsPlugin`)
- [x] Debug APK from GitHub Actions (`.github/workflows/build-android.yml`, as piecework / lyric-sync / insight): a `v*` tag matching package.json builds `satr-debug-<version>.apk` and publishes a release; "Run workflow" builds one as an artifact. Signed with one fixed key from the `ANDROID_KEYSTORE_BASE64` secret (PKCS12, alias `satr`, password `android`), so each APK installs over the last. versionName from the tag, versionCode = commit count
- [x] App icon (icons/*.svg → `npm run android:icons`): three right-aligned lines and a blue caret on Obsidian's dark grey; adaptive and themed (monochrome) icons; launch screen in the theme's background instead of Capacitor's logo
- [ ] First CI build and install on the phone (a local Gradle build was tried in the dev sandbox but ran out of memory there)
- [x] All-files access on first run (`StoragePlugin` + `src/native.ts`): a page explains and opens Android's "All files access" switch for Satr (Android 11+), or asks for the storage permission (10 and older); re-checks when you come back; sideload only
- [x] `@capacitor/filesystem` installed natively (the backend in `src/vault.ts`); new notes with "All files" go to a Notes folder, not the top of the storage; the phone's Android/ folder is skipped when listing notes
- [ ] Test list, read, write, stat, rename, delete, mkdir on the device
- [x] System bars, edge to edge as Obsidian (`SystemBarsPlugin` "SatrSystemBars", replaces `@capacitor/status-bar`): the page draws behind transparent status and navigation bars, icons follow the theme, and the header / bottom bar keep clear of them through `--safe-area-inset-*` set from the real insets (Android's `env()` is unreliable in the WebView). No black band at the notch, no empty strip under the bottom bar. The keyboard gets a WebView bottom margin, since edge to edge disables adjustResize. The status bar still hides and shows on scroll
- [x] Text size: the app's WebView follows the phone's font size (Android's default text zoom, as Obsidian does); the PDF stays fixed — the export divides font sizes by that scale while Paged.js measures and sends the print WebView the unscaled CSS at `setTextZoom(100)`, so both pagination and the page are exactly A4 at 100%
- [ ] On-device check of the insets (notch, gesture and 3-button navigation, keyboard up / down, rotation)
- [ ] Code keyboard: a small WebView subclass that overrides `onCreateInputConnection` and, while the caret is in code or math, requests `TYPE_TEXT_VARIATION_VISIBLE_PASSWORD | TYPE_TEXT_FLAG_NO_SUGGESTIONS` (Termux's trick: Gboard shows the number row and no suggestions), switched from JS through a bridge call plus `InputMethodManager.restartInput`
- [ ] On-device IME check: Persian and Arabic composition, caret placement, selection handles
- [x] Open from other apps (`OpenFilePlugin`): ACTION_VIEW / ACTION_EDIT / ACTION_SEND, any file type. Plain UTF-8 text (any extension, `.patch` too) is editable; anything else is decoded best effort and shown read-only, pictures also in the reading view; shared text opens read-only. Needs its on-device check
- [x] Print / PDF: the Android side (see Print below); needs its on-device check with the first build

### Obsidian's sizes (done, September 2026)

Measured side by side against Obsidian 1.12.7 mobile at 390×844 and matched: editor (16px / 1.5, 60px top spacing, 24px side margins, 700px line width, line-level headings with Obsidian's sizes, weights, line heights and letter spacing, list and checkbox geometry, 14px code), reading view (heading, paragraph, list, blockquote, code and table spacing), bottom bar (52px pill), header (44px buttons), left drawer (space switcher at the bottom where Obsidian has its vault profile, "N files, M folders"), Settings (cards, rows, dropdowns, toggles) and the ≡ menu sheet. The theme button left the drawer; the theme is chosen in Settings only. That historical 1.5 spacing was subsequently relaxed to 1.85 for readability and selection clearance; the old default is migrated, while other chosen values remain unchanged.

## Original product decisions and phased to-do

Locked decisions


Editor

- [ ] CodeMirror 6, one pane, live preview only (no split view)
- [ ] Line numbers on by default, with a setting to turn off
- [ ] Soft wrap on by default
- [ ] Tab key inserts tabs
- [ ] Live preview updates on every keystroke
- [ ] Per-line RTL/LTR: CM6 `perLineTextDirection` + `dir="auto"` line decorations (Phase 1, not Phase 4 — see References)
- [ ] Mobile typing config (from the markdown-editor repo): `spellcheck:"false"`, `autocorrect:"off"`, `autocapitalize:"off"`, `dir:"auto"` on content; text stays in the DOM, never canvas

Markdown

- [ ] Math delimiters: $...$ and $$...$$
- [ ] Tables render as pipes (raw pipe view with alignment, not a widget)
- [ ] Images show as a link you can tap, not an inline preview
- [ ] Mermaid is postponed; do not implement it in the current release
- [ ] Rendered HTML gets sanitized
- [ ] Flavor: GFM core (tables, task lists, strikethrough, autolinks) + plugins, not pandoc
- [ ] Extensions beyond GFM: footnotes plugin + [[wiki links]], and nothing else
- [ ] [[wiki links]]: resolved and opened — tap finds that .md in the folder tree and opens it; broken links render but do nothing (dimmed)
- [ ] [[wiki links]] UX: type [[ → fuzzy-search popup over the folder tree → pick to insert (Obsidian's rule)
- [ ] Frontmatter: stays in the file, hidden from the preview
- [ ] Math: KaTeX everywhere — one renderer for screen and print
- [ ] marked config: `gfm: true, breaks: false` (single newline is not a hard break — CommonMark)

Files

- [ ] MANAGE_EXTERNAL_STORAGE, sideload only
- [ ] Remember the last file opened and reopen it on launch (not the last dir)
- [ ] Autosave, with undo working normally
- [ ] Unsaved-changes behavior: debounced autosave (~1s after the last keystroke), flushed immediately on background or file switch; silent, no prompts; dirty indicator only for the brief unsaved window
- [ ] File watching: check mtime on app resume and before opening — if the file changed underneath, prompt to reload or keep
- [ ] Custom Capacitor plugin for filesystem (native side is small, ~200 lines Java)

Print

- [x] Custom CSS you control in the print output
- [x] ~~Your own page-setup dialog before handing off to Android's print~~ — decided against: straight to Android's dialog, as Markor
- [x] ~~Spaces after inserted pairs (`$ | $`, `** | **`)~~ — decided against: typing leaves the caret between the pair with nothing added (16); the Markor keyboard's autocorrect brings its own word spacing (3)
- [x] Math: KaTeX output with fonts embedded as data URIs in the print HTML
- [ ] Mermaid export support postponed with Mermaid itself
- [x] Images as data URIs
- [ ] No HTML export — print/PDF is the only export path

App

- [ ] UI in English now, Persian planned later
- [ ] Name: satr
- [ ] TypeScript
- [ ] Shell: vanilla TypeScript, no framework — one screen plus a few small panels, and a framework's component model fights CM6's view system. A small store + DOM. Revisit in Phase 4 only if settings/outline get complicated.
- [ ] Mobile chrome: Obsidian-style. A sidebar revealed by swiping from the screen edge — the content slides aside to make room for it (a real pane that pushes the editor, not an overlay on top, not a hamburger button). One slim top row with two buttons. No stacked panes; everything else appears on demand. Touch targets ≥44px.
- [ ] Dependencies via npm (Vite bundles anyway): marked, marked-footnote, dompurify, @codemirror/* packages
- [ ] Reuse policy: port the logic from MSadraShakouri/markdown-editor near-verbatim (editor surface, markdown pipeline, prefs pattern), rewrite only what is genuinely new (live preview, math, mermaid, wiki links, print, filesystem)

Nothing is open anymore. Everything below is decided.

---

References

Three references, three different jobs. They are not interchangeable.

**MSadraShakouri/markdown-editor (the primary reference — most questions are already answered here)**

- [ ] Proven typing recipe: `contentAttributes` with spellcheck/autocorrect/autocapitalize off + `dir:"auto"` + text in the DOM (no canvas). This is why typing there feels great on mobile.
- [ ] `perLineTextDirection` + a `dir="auto"` line-decoration ViewPlugin gives per-line RTL/LTR. CM5 was rejected for exactly this. In satr it is a Phase 1 item, not Phase 4 polish.
- [ ] The markdown pipeline is already decided in practice: marked@15 + marked-footnote@1.4 + DOMPurify@3, `gfm: true, breaks: false`. Port the tuned sanitizer allowlist verbatim (bans `style` — phishing overlays; forbids svg/math/iframe; allows align/checked/disabled so tables and checkboxes don't break).
- [ ] Port `prefs.mjs`'s pattern: one table, typed fallbacks, never throws, survives blocked storage.
- [ ] CM6 trap list (from its decision doc §4): never read `view.lineWrapping` (stale measure oracle — track your own flag); `setValue()` must re-supply compartments or settings silently reset; `requestMeasure()` after a hidden pane becomes visible; CM6 does not run under jsdom at all, so editor tests need a real browser/device.
- [ ] What it does NOT have: live preview (it is edit/split/preview modes with a 200ms debounce), math, mermaid, wiki links, print, native filesystem. Those are satr's greenfield.
- [ ] Its mobile weaknesses to NOT copy: two-row header, drawer sidebar, 34–38px touch targets. satr's Obsidian-style chrome replaces all three.

**Markor (the native-editor benchmark)**

- [ ] Native EditText + custom highlighter, flexmark-java (CommonMark), WebView preview, KaTeX math. Best-possible IME — and the one thing satr cannot copy (WebView). The typing recipe above is the WebView answer.
- [ ] Worth stealing: share-into (open .md from other apps — already Phase 4), QuickNote-style fast capture, recents/popular files, ToC/outline, keep-screen-on, per-file format memory.
- [ ] Its "no other editing UI" philosophy validates satr's single pane.

**Obsidian (the polish bar for Phase 2)**

- [ ] Live Preview's rule: syntax reappears when the cursor enters the formatted range. satr's decoration list is the implementation; this rule is the UX target.
- [ ] The [[ popup (fuzzy search as you type) — a small addition that makes wiki links feel like Obsidian rather than a parser feature.
- [ ] Deliberately not copied: callouts, embeds, Dataview, graph, canvas. Minimal extensions were chosen.

---

Phase 1 — A working editor

Goal: open the app, it reopens your last file, you edit and it saves.

- [ ] Capacitor Android project, app id com.msadrashakouri.satr
- [ ] Vite + TypeScript SPA shell (vanilla, per above)
- [ ] satr-fs plugin, raw backend: list, read, write, stat
- [ ] MANAGE_EXTERNAL_STORAGE permission flow
- [ ] First-run folder picker (custom browser over the granted permission, not SAF)
- [ ] Remember last file, reopen on launch — with a stat check: if the file is gone, fall back to the file browser
- [ ] File browser: list folders and .md files, create/rename/delete
- [ ] Port the editor surface from markdown-editor: CM6 state, compartments for wrap/read-only/gutter, Persian gutter digits, Enter list continuation, Tab indent, search decorations (in-viewport only, 20k cap), the full mobile typing recipe, perLineTextDirection + dir="auto" decorations
- [ ] Editor wired to file: line numbers on, soft wrap on, tabs
- [ ] Port the markdown pipeline: marked + marked-footnote + DOMPurify, tuned allowlist, sanitize exactly once after render, `breaks: false`
- [ ] Port the prefs pattern (one table, typed fallbacks, never throws)
- [ ] Autosave (debounced, flush on background) + undo
- [ ] Dirty indicator for the unsaved window
- [ ] Soft keyboard / inset handling (env(safe-area-inset-*) + Capacitor Keyboard plugin)
- [ ] Obsidian-style mobile chrome: two-button top row, edge-swipe sidebar with content sliding aside (not an overlay), ≥44px touch targets
- [ ] Dark and light theme, follow system
- [ ] One on-device IME check in the Capacitor WebView: Persian, Arabic, CJK composition, cursor placement. The config is known-good from the repo; this verifies it in Android's WebView specifically.

Ship this and use it for a week before Phase 2.

Phase 2 — Rendering and live preview

Goal: the Obsidian-feel editing that's the whole point.

- [ ] Markdown render pipeline (ported in Phase 1; verify KaTeX/mermaid survive the sanitizer here)
- [ ] Sanitize output
- [ ] Fixture tests: markdown in → sanitized HTML out. The one test suite worth writing — this is where bugs compound silently.
- [ ] Live preview decorations, in order:
  - [ ] Bold / italic / strikethrough
  - [ ] Inline code
  - [ ] Headings
  - [ ] Blockquotes, HR
  - [ ] Links (hide syntax, make text tappable)
  - [x] Images (shown inline in the reading view instead)
  - [ ] Checkboxes (click to toggle)
  - [ ] Fenced code blocks
  - [ ] Math (inline and display)
  - [ ] Mermaid placeholder (postponed) (postponed)
  - [ ] Tables — pipes only, no widget
  - [ ] Footnotes
  - [ ] Wiki links (resolve against folder tree)
- [ ] Obsidian's cursor rule: syntax becomes visible when the cursor enters the formatted range
- [ ] [[ popup: fuzzy search over the folder tree, insert on pick
- [ ] Math: $...$ and $$...$$ with KaTeX (screen)
- [ ] Mermaid support (postponed)
- [ ] Frontmatter stripped from preview

Phase 3 — Print / PDF

Goal: your own print dialog, your own CSS, Android handles the final save.

- [x] satr-print plugin (`android/…/PrintPlugin.java`, `SatrPrint` in JS)
- [x] Print WebView attached to the window (full size, behind the app's WebView), removed when the job finishes
- [x] Build self-contained print HTML from rendered markdown (laid out in the app by Paged.js, then handed over)
- [x] Your custom CSS (page size and margins fixed: A4, 1in)
- [x] Images as data URIs
- [x] Math as KaTeX HTML with fonts embedded as data URIs (decided: KaTeX everywhere)
- [ ] Mermaid export is postponed with Mermaid itself
- [x] ~~Custom dialog~~ — decided against (see above)
- [x] Page-break CSS for tables and figures (rows, formulas and images don't split; headings stay with the next paragraph)
- [x] Wait for real render completion — the pages are fully laid out in the app before the hand-off, so the print WebView only shows static HTML (scripts off); a short delay after onPageFinished lets the embedded fonts decode

Phase 4 — Polish

- [ ] IME / composition deep testing (Persian, Arabic, CJK) — the Phase 1 check de-risked this; here we go deep
- [ ] Recents list (+ popular files, Markor-style)
- [ ] Search in file
- [ ] Outline / TOC panel
- [ ] Settings screen (font, size, line height, line numbers toggle)
- [ ] Persian UI translation (planned, not now)
- [ ] Share intent: open .md from other apps
- [ ] QuickNote-style fast capture (Markor)
- [ ] Keep-screen-on (Markor)

Phase 5 — Maybe

- [ ] Search across folder
- [ ] Command palette (Obsidian)
- [ ] Anything else that comes up once you're using it daily

---

Known traps (worth remembering)

- [ ] Async widgets in CM6 aren't natural. Write the placeholder-then-update pattern once, reuse it for math and mermaid.
- [x] Offscreen WebView for printing must be attached to the window, or images and fonts render inconsistently.
- [ ] onPageFinished doesn't mean "content is ready." Use an explicit signal. (Print sidesteps it: static, pre-laid-out HTML.)
- [x] Paged.js in a right-to-left page silently drops text: it looks for overflow to the right, but RTL columns grow to the left. The print page stays LTR (each paragraph has its own direction), as the reading view's article does.
- [ ] IME inside a WebView is a known weak spot. The typing recipe from markdown-editor is the mitigation; the Phase 1 on-device check is the verification.
- [ ] The last-opened file can vanish between sessions — stat it on launch, fall back to the browser.
- [ ] Autosave can clobber external edits — that's why mtime-on-resume exists.
- [ ] Live preview tables as pipes is way cheaper than as a widget. You already chose pipes, which is the right call.
- [ ] GFM has no footnotes — resolved by the footnotes plugin, worth remembering when the flavor question resurfaces.
- [ ] CM6 state lies if you ask the DOM: `view.lineWrapping` is a measure pass behind, so wrap/gutter state must be tracked as your own flags, and a hidden pane needs `requestMeasure()` before it measures correctly.
- [ ] KaTeX emits `style` attributes in places (array and rule sizing), and the ported DOMPurify config bans `style` outright. Verify KaTeX's output survives sanitization — if it doesn't, allow `style` only on `.katex` descendants via a sanitizer hook, never globally.
- [ ] Mermaid is intentionally postponed; do not reintroduce its dependency or renderer until a later phase.
- [ ] CM6 does not run under jsdom (it throws in `measure`), so editor tests belong in a real browser/device suite, separate from `node --test`.
- [ ] Two equally-specific `!important` rules race on load order, not specificity: the markdown-editor repo shipped a hidden-editor bug for months because `[hidden]` and `.editor-pane` both declared `!important`. Don't use `!important` for layout state.

---

Effort shape: Phase 1 is mostly a port — low risk. Phase 2 decorations are the bulk of the real work. Phase 3 is fiddly but well-trodden.
