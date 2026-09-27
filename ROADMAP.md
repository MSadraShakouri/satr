Good, that's plenty. Here's the roadmap built only from what you said, with your unknowns marked as open questions instead of me guessing.

Satr — Roadmap

com.msadrashakouri.satr · MIT · Android only · GitHub debug APK, no Play Store

Locked decisions

Editor

· CodeMirror 6, one pane, live preview only (no split view)
· Line numbers on by default, with a setting to turn off
· Soft wrap on by default
· Tab key inserts tabs
· Live preview updates on every keystroke
· Per-line RTL/LTR: CM6 `perLineTextDirection` + `dir="auto"` line decorations (Phase 1, not Phase 4 — see References)
· Mobile typing config (from the markdown-editor repo): `spellcheck:"false"`, `autocorrect:"off"`, `autocapitalize:"off"`, `dir:"auto"` on content; text stays in the DOM, never canvas

Markdown

· Math delimiters: $...$ and $$...$$
· Tables render as pipes (raw pipe view with alignment, not a widget)
· Images show as a link you can tap, not an inline preview
· Mermaid shows a placeholder with a render button, not inline
· Rendered HTML gets sanitized
· Flavor: GFM core (tables, task lists, strikethrough, autolinks) + plugins, not pandoc
· Extensions beyond GFM: footnotes plugin + [[wiki links]], and nothing else
· [[wiki links]]: resolved and opened — tap finds that .md in the folder tree and opens it; broken links render but do nothing (dimmed)
· [[wiki links]] UX: type [[ → fuzzy-search popup over the folder tree → pick to insert (Obsidian's rule)
· Frontmatter: stays in the file, hidden from the preview
· Math: KaTeX everywhere — one renderer for screen and print
· marked config: `gfm: true, breaks: false` (single newline is not a hard break — CommonMark)

Files

· MANAGE_EXTERNAL_STORAGE, sideload only
· Remember the last file opened and reopen it on launch (not the last dir)
· Autosave, with undo working normally
· Unsaved-changes behavior: debounced autosave (~1s after the last keystroke), flushed immediately on background or file switch; silent, no prompts; dirty indicator only for the brief unsaved window
· File watching: check mtime on app resume and before opening — if the file changed underneath, prompt to reload or keep
· Custom Capacitor plugin for filesystem (native side is small, ~200 lines Java)

Print

· Custom CSS you control in the print output
· Your own page-setup dialog before handing off to Android's print
· Math: KaTeX output with fonts embedded as data URIs in the print HTML
· Mermaid already SVG, inline as-is
· Images as data URIs
· No HTML export — print/PDF is the only export path

App

· UI in English now, Persian planned later
· Name: satr
· TypeScript
· Shell: vanilla TypeScript, no framework — one screen plus a few small panels, and a framework's component model fights CM6's view system. A small store + DOM. Revisit in Phase 4 only if settings/outline get complicated.
· Mobile chrome: Obsidian-style. A sidebar revealed by swiping from the screen edge — the content slides aside to make room for it (a real pane that pushes the editor, not an overlay on top, not a hamburger button). One slim top row with two buttons. No stacked panes; everything else appears on demand. Touch targets ≥44px.
· Dependencies via npm (Vite bundles anyway): marked, marked-footnote, dompurify, @codemirror/* packages
· Reuse policy: port the logic from MSadraShakouri/markdown-editor near-verbatim (editor surface, markdown pipeline, prefs pattern), rewrite only what is genuinely new (live preview, math, mermaid, wiki links, print, filesystem)

Nothing is open anymore. Everything below is decided.

---

References

Three references, three different jobs. They are not interchangeable.

**MSadraShakouri/markdown-editor (the primary reference — most questions are already answered here)**

· Proven typing recipe: `contentAttributes` with spellcheck/autocorrect/autocapitalize off + `dir:"auto"` + text in the DOM (no canvas). This is why typing there feels great on mobile.
· `perLineTextDirection` + a `dir="auto"` line-decoration ViewPlugin gives per-line RTL/LTR. CM5 was rejected for exactly this. In satr it is a Phase 1 item, not Phase 4 polish.
· The markdown pipeline is already decided in practice: marked@15 + marked-footnote@1.4 + DOMPurify@3, `gfm: true, breaks: false`. Port the tuned sanitizer allowlist verbatim (bans `style` — phishing overlays; forbids svg/math/iframe; allows align/checked/disabled so tables and checkboxes don't break).
· Port `prefs.mjs`'s pattern: one table, typed fallbacks, never throws, survives blocked storage.
· CM6 trap list (from its decision doc §4): never read `view.lineWrapping` (stale measure oracle — track your own flag); `setValue()` must re-supply compartments or settings silently reset; `requestMeasure()` after a hidden pane becomes visible; CM6 does not run under jsdom at all, so editor tests need a real browser/device.
· What it does NOT have: live preview (it is edit/split/preview modes with a 200ms debounce), math, mermaid, wiki links, print, native filesystem. Those are satr's greenfield.
· Its mobile weaknesses to NOT copy: two-row header, drawer sidebar, 34–38px touch targets. satr's Obsidian-style chrome replaces all three.

**Markor (the native-editor benchmark)**

· Native EditText + custom highlighter, flexmark-java (CommonMark), WebView preview, KaTeX math. Best-possible IME — and the one thing satr cannot copy (WebView). The typing recipe above is the WebView answer.
· Worth stealing: share-into (open .md from other apps — already Phase 4), QuickNote-style fast capture, recents/popular files, ToC/outline, keep-screen-on, per-file format memory.
· Its "no other editing UI" philosophy validates satr's single pane.

**Obsidian (the polish bar for Phase 2)**

· Live Preview's rule: syntax reappears when the cursor enters the formatted range. satr's decoration list is the implementation; this rule is the UX target.
· The [[ popup (fuzzy search as you type) — a small addition that makes wiki links feel like Obsidian rather than a parser feature.
· Deliberately not copied: callouts, embeds, Dataview, graph, canvas. Minimal extensions were chosen.

---

Phase 1 — A working editor

Goal: open the app, it reopens your last file, you edit and it saves.

☐ Capacitor Android project, app id com.msadrashakouri.satr
☐ Vite + TypeScript SPA shell (vanilla, per above)
☐ satr-fs plugin, raw backend: list, read, write, stat
☐ MANAGE_EXTERNAL_STORAGE permission flow
☐ First-run folder picker (custom browser over the granted permission, not SAF)
☐ Remember last file, reopen on launch — with a stat check: if the file is gone, fall back to the file browser
☐ File browser: list folders and .md files, create/rename/delete
☐ Port the editor surface from markdown-editor: CM6 state, compartments for wrap/read-only/gutter, Persian gutter digits, Enter list continuation, Tab indent, search decorations (in-viewport only, 20k cap), the full mobile typing recipe, perLineTextDirection + dir="auto" decorations
☐ Editor wired to file: line numbers on, soft wrap on, tabs
☐ Port the markdown pipeline: marked + marked-footnote + DOMPurify, tuned allowlist, sanitize exactly once after render, `breaks: false`
☐ Port the prefs pattern (one table, typed fallbacks, never throws)
☐ Autosave (debounced, flush on background) + undo
☐ Dirty indicator for the unsaved window
☐ Soft keyboard / inset handling (env(safe-area-inset-*) + Capacitor Keyboard plugin)
☐ Obsidian-style mobile chrome: two-button top row, edge-swipe sidebar with content sliding aside (not an overlay), ≥44px touch targets
☐ Dark and light theme, follow system
☐ One on-device IME check in the Capacitor WebView: Persian, Arabic, CJK composition, cursor placement. The config is known-good from the repo; this verifies it in Android's WebView specifically.

Ship this and use it for a week before Phase 2.

Phase 2 — Rendering and live preview

Goal: the Obsidian-feel editing that's the whole point.

☐ Markdown render pipeline (ported in Phase 1; verify KaTeX/mermaid survive the sanitizer here)
☐ Sanitize output
☐ Fixture tests: markdown in → sanitized HTML out. The one test suite worth writing — this is where bugs compound silently.
☐ Live preview decorations, in order:
  ☐ Bold / italic / strikethrough
  ☐ Inline code
  ☐ Headings
  ☐ Blockquotes, HR
  ☐ Links (hide syntax, make text tappable)
  ☐ Images as tappable links
  ☐ Checkboxes (click to toggle)
  ☐ Fenced code blocks
  ☐ Math (inline and display)
  ☐ Mermaid placeholder
  ☐ Tables — pipes only, no widget
  ☐ Footnotes
  ☐ Wiki links (resolve against folder tree)
☐ Obsidian's cursor rule: syntax becomes visible when the cursor enters the formatted range
☐ [[ popup: fuzzy search over the folder tree, insert on pick
☐ Math: $...$ and $$...$$ with KaTeX (screen)
☐ Mermaid: lazy-loaded, renders on button press, not automatically
☐ Frontmatter stripped from preview

Phase 3 — Print / PDF

Goal: your own print dialog, your own CSS, Android handles the final save.

☐ satr-print plugin skeleton
☐ Offscreen WebView (attached to window, 1×1, invisible)
☐ Build self-contained print HTML from rendered markdown
☐ Your custom CSS: page size, margins, fonts, colors
☐ Images as data URIs
☐ Math as KaTeX HTML with fonts embedded as data URIs (decided: KaTeX everywhere)
☐ Mermaid already SVG, inline as-is
☐ Custom dialog: paper size, orientation, margins, plus anything else you want
☐ Map dialog choices onto the print HTML
☐ Page-break CSS for tables and figures
☐ Wait for real render completion, not just onPageFinished — math and mermaid signal done through a JS bridge into the WebView, not load events

Phase 4 — Polish

☐ IME / composition deep testing (Persian, Arabic, CJK) — the Phase 1 check de-risked this; here we go deep
☐ Recents list (+ popular files, Markor-style)
☐ Search in file
☐ Outline / TOC panel
☐ Settings screen (font, size, line height, line numbers toggle)
☐ Persian UI translation (planned, not now)
☐ Share intent: open .md from other apps
☐ QuickNote-style fast capture (Markor)
☐ Keep-screen-on (Markor)

Phase 5 — Maybe

☐ Search across folder
☐ Command palette (Obsidian)
☐ Anything else that comes up once you're using it daily

---

Known traps (worth remembering)

· Async widgets in CM6 aren't natural. Write the placeholder-then-update pattern once, reuse it for math and mermaid.
· Offscreen WebView for printing must be attached to the window, or images and fonts render inconsistently.
· onPageFinished doesn't mean "content is ready." Use an explicit signal.
· IME inside a WebView is a known weak spot. The typing recipe from markdown-editor is the mitigation; the Phase 1 on-device check is the verification.
· The last-opened file can vanish between sessions — stat it on launch, fall back to the browser.
· Autosave can clobber external edits — that's why mtime-on-resume exists.
· Live preview tables as pipes is way cheaper than as a widget. You already chose pipes, which is the right call.
· GFM has no footnotes — resolved by the footnotes plugin, worth remembering when the flavor question resurfaces.
· CM6 state lies if you ask the DOM: `view.lineWrapping` is a measure pass behind, so wrap/gutter state must be tracked as your own flags, and a hidden pane needs `requestMeasure()` before it measures correctly.
· KaTeX emits `style` attributes in places (array and rule sizing), and the ported DOMPurify config bans `style` outright. Verify KaTeX's output survives sanitization — if it doesn't, allow `style` only on `.katex` descendants via a sanitizer hook, never globally.
· Mermaid's output is SVG, which the sanitizer forbids — that's fine only because mermaid renders on demand into its own DOM island, after sanitization. Never route rendered SVG back through the sanitizer.
· CM6 does not run under jsdom (it throws in `measure`), so editor tests belong in a real browser/device suite, separate from `node --test`.
· Two equally-specific `!important` rules race on load order, not specificity: the markdown-editor repo shipped a hidden-editor bug for months because `[hidden]` and `.editor-pane` both declared `!important`. Don't use `!important` for layout state.

---

Effort shape: Phase 1 is mostly a port — low risk. Phase 2 decorations are the bulk of the real work. Phase 3 is fiddly but well-trodden.
