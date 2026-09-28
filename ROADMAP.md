# Satr roadmap

A to-do roadmap for the complete Satr editor. The original product decisions and phased work are retained below, with actionable items expressed as task checkboxes. Mermaid is postponed until the core editor and preview are stable.

## Current status (September 2026)

Satr runs as a web app (Vite + TypeScript + CodeMirror 6). Notes are files in
folders behind one storage interface: a virtual file system in localStorage on
the web, and a device backend (Capacitor Filesystem, untested until the APK). The Android APK (Capacitor 7) comes after the UI
and the logic below are finished. The `android/` project hasn't been created yet.

### Done

Editor
- [x] CodeMirror editor: per-line RTL/LTR, line numbers, soft wrap, list continuation (Persian digits too)
- [x] Live preview in the editor (Obsidian rule: syntax shows when the caret enters it): headings, emphasis, lists with a space rule, tasks, quotes, footnotes, links
- [x] Inline file title that renames the note
- [x] Tight character-level selection highlight
- [x] Keyboard toolbar 8px above the keyboard, scrolling like Obsidian's (undo/redo, heading, lists, to-do cycle, footnote, math, delete line, new line below, move line), and a round hide-keyboard button beside it
- [x] Brackets and `$` pair up; no suggestions or autocorrect inside code and math
- [x] Math source styled like Obsidian (monospace, italic, accent `$`), never rendered while editing
- [x] Footnotes: insert at the caret, write the note in a popover at the reference
- [x] Wiki links `[[Note]]`, `[[Note|text]]`, `[[Note#Heading]]`: styled in the editor, tap to open, a popup of notes while typing `[[`; broken links dimmed in the reading view
- [x] Images shown as tappable links
- [x] Undo history per note (never undoes into the previous note)
- [x] Heading folding in the editor and the preview (chevron at the end of the heading line), fold/unfold all, remembered per note
- [x] Find and replace in one bar: regular expressions ignoring case (`$1` in replacements), from the caret, every match highlighted (a setting), a chevron drops down the replace row; the count sits where the query ends (on the left, in Persian digits, for a Persian query)
- [x] Keeps the caret clear of the keyboard without jumping or locking the scroll

Preview
- [x] Reading view: sections tagged with source lines, KaTeX with balanced math line breaking, code highlighting and copy, tables, footnotes in popovers, title on top
- [x] Edit/preview switch keeps the position; double-tap the preview to edit
- [x] Rendered only when visible (about 14x faster typing on long notes)

Chrome
- [x] Obsidian themes: exact neutral colours, light/dark/auto
- [x] Floating top buttons and bottom bar with Obsidian's icons (previous / next tab, new note, tabs, find, fold all); they hide while scrolling down, with Obsidian's fade masks. The right drawer has no button, as in Obsidian (swipe from the right edge, or Ctrl/Cmd+Shift+F)
- [x] Both drawers share one implementation of Obsidian's release physics (drag, fling, re-grab mid-animation, same look)
- [x] Right drawer: outline and search in one view, built like the left drawer. A two-option pill (tap only) picks This note / All notes. This note: the outline, and while searching the matching headings with each match under its heading. All notes: the same heading tree under each note. Each match shows its line number and up to seven lines of context. Regular expressions
- [x] Tabs: every note opens in its own tab (an open note just switches to its tab); the bottom bar's arrows step through the tabs; switching never opens the keyboard and comes back where you were. A tab button with the count, the full-screen switcher (note previews in two columns, close, "+", "N tabs" menu, Done, press and hold a card to drag it to a new place), an empty tab page ("No file is open" with recent notes), swipe a card away to close, reopen closed tab, kept across restarts
- [x] Left sidebar: filter by name (found files and folders, flat, with their folder); Obsidian-style file tree of the space (folders open in place, sorting, the open note highlighted), long-press menu (new note/folder, rename in place, move, delete, use as a space), floating action buttons
- [x] "All files" walker (Markor-style): only the current folder, ".." to go up
- [x] Space switcher (vault-switcher style): spaces are shortcuts to folders; their notes are ordinary files, edited in place. "All files", add or remove a space
- [x] Bottom-sheet menus in Obsidian's phone style
- [x] Settings page (gear in the left drawer): theme, font size, line spacing, line numbers, highlight every match, which toolbar buttons show
- [x] Android back button, Obsidian's order: menus, popovers, the tab switcher, settings and the find bar close first, then the drawers; then "Press back again to exit." (a second press within 5s leaves the app)
- [x] UI chrome can't be selected as text; only the note, footnotes and fields can
- [x] Per-note memory: mode, scroll position, caret, folds; history for back/forward

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

### APK phase

- [ ] `npx cap add android`, app id com.msadrashakouri.satr
- [ ] All-files permission (MANAGE_EXTERNAL_STORAGE) flow on first run; sideload only
- [ ] Install `@capacitor/filesystem` natively (the JS backend in `src/vault.ts` is written against it) and test list, read, write, stat, rename, delete, mkdir on the device
- [ ] Status bar hide/show wired to auto-hide (the JS side is done)
- [ ] Code keyboard: a small WebView subclass that overrides `onCreateInputConnection` and, while the caret is in code or math, requests `TYPE_TEXT_VARIATION_VISIBLE_PASSWORD | TYPE_TEXT_FLAG_NO_SUGGESTIONS` (Termux's trick: Gboard shows the number row and no suggestions), switched from JS through a bridge call plus `InputMethodManager.restartInput`
- [ ] On-device IME check: Persian and Arabic composition, caret placement, selection handles
- [ ] Share intent (open .md from other apps)
- [ ] Print / PDF (Phase 3 below)

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

- [ ] Custom CSS you control in the print output
- [ ] Your own page-setup dialog before handing off to Android's print
- [ ] Math: KaTeX output with fonts embedded as data URIs in the print HTML
- [ ] Mermaid export support postponed with Mermaid itself
- [ ] Images as data URIs
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
  - [ ] Images as tappable links
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

- [ ] satr-print plugin skeleton
- [ ] Offscreen WebView (attached to window, 1×1, invisible)
- [ ] Build self-contained print HTML from rendered markdown
- [ ] Your custom CSS: page size, margins, fonts, colors
- [ ] Images as data URIs
- [ ] Math as KaTeX HTML with fonts embedded as data URIs (decided: KaTeX everywhere)
- [ ] Mermaid export is postponed with Mermaid itself
- [ ] Custom dialog: paper size, orientation, margins, plus anything else you want
- [ ] Map dialog choices onto the print HTML
- [ ] Page-break CSS for tables and figures
- [ ] Wait for real render completion, not just onPageFinished — math and mermaid signal done through a JS bridge into the WebView, not load events

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
- [ ] Offscreen WebView for printing must be attached to the window, or images and fonts render inconsistently.
- [ ] onPageFinished doesn't mean "content is ready." Use an explicit signal.
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
