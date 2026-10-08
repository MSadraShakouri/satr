# Satr

A Markdown editor for Android that writes Persian and English side by side. It looks and feels like Obsidian's phone app and works on plain `.md` files in your own folders.

*Satr* (سطر) means "line".

## What it does

- **Both directions in one note.** Prose follows its first strong letter. Numbers and dates infer their direction from surrounding prose, using the same policy in the editor, reading view and PDF. Math and literal code stay LTR and never influence neighbouring prose. The line numbers keep the left edge; only the right sidebar's outline reads the note's majority.
- **Live preview while editing**, with Obsidian's rule: the Markdown syntax shows only on the line you're editing. There's also a separate reading view (double-tap it to edit). Switching between the two keeps the same place: the mapping measures the rendered formulas and tables and compensates. Inside `$…$` or `$$…$$` nothing is Markdown at all — a `**` is never bold, a `[a](b)` never becomes a link, `` `c` `` never becomes code and a `[^1]` never becomes a footnote reference: every one of them is just a character of the formula, in the editor and in the reading view alike.
- **Math with KaTeX.** In the reading view and the PDF, long formulas wrap to the screen at `=`, `<`, `≤` and other relations, never at `+` or `−`, break first at the writer's own line ends, then at commas (which stay put), then at those relations — repeated on the next line — and last at spaces you typed between words, including words inside `\text{...}` and the other text commands. A Persian phrase is the one exception: its words stay a single run, so they read right to left instead of being handed to the page one word at a time, which would lay them out left to right. A group in plain parentheses or brackets is a step behind all of those: it is never broken while the line can hold it, and a group too wide for the line breaks inside itself at its own commas and relations rather than at whatever atom the browser would otherwise split. Overwide display formulas in print can also use KaTeX’s own operator breaks to fit the column. A display formula is as tall as its content, including a large fraction; the Android preview grows the box to what actually painted instead of clipping it to the font strut. The drawn signs (the vector arrow, stretchy brackets, roots) scale with the system font size exactly like the letters, as in the PDF: the app WebView is pinned at 100% text zoom and the phone's font scale is applied in CSS, so the em a sign is laid out in is the size of the letter beside it. The source is never changed.
- **Obsidian's Markdown:**
  - `[[wiki links]]`, with a picker while you type
  - `![[image embeds]]` with `|300` sizes
  - `==highlights==`
  - task lists
  - footnotes, written in a popover
  - folding headings
- **Images** in the reading view and the PDF, centred:
  - `![alt](path)` is relative to the note.
  - `![[name.png]]` finds the image anywhere in your folders.
- **PDF export** through Android's print dialog, as Markor does:
  - Vazirmatn font, A4
  - one or two columns, set in Settings → PDF export and remembered per file on this device
  - automatic column order from the majority of prose letters (math and code ignored), or explicit LTR / RTL
  - centred display equations by default, or aligned to the reading edge; equations themselves always stay LTR
  - export starts directly with the saved options—no configuration popup
  - headings kept with following content, including at column boundaries
  - footnotes at the foot of each page (each column in two-column mode), numbered across the whole sheet
  - page numbers in Persian digits
  - page breaks (`\pagebreak`)
  - your own CSS; two-column mode fixes A4 geometry, 1-inch outer margins and an 8 mm gap
- **Your files, your folders.**
  - *Spaces* are shortcuts to folders; Satr never writes its own config into them.
  - *All files* walks the whole storage.
  - Notes open in tabs you can rearrange. Each file remembers its reading position, view, caret and folds across switches, tab closure/reopening and app restarts. Android files opened by another app keep a bookmark tied to the source URI, not the temporary permission ID, so opening the same file again comes back to the tab it already has.
  - Launch is yours to set: **restore the tabs you had**, **always open a new empty tab**, or **open one after you have been away** for a time you choose (5 minutes to a day, 30 by default). The last tab can be closed — the empty "No file is open" tab is what is left — and the tab switcher's *n tabs* menu closes them all at once. Hold a folder to **open all its notes in tabs**, in order, or to **replace the tabs** with that folder.
  - Undo **and redo** belong to each open tab, in memory. Switching tabs or losing focus keeps both stacks; closing the tab or app ends them. No persistent revision history is added.
- **Discord-style timestamps.** `<t:1700000000>` or `<t:1700000000:R>` in a note reads as a date or a relative time — all seven formats, in your own language and locale — and the relative form keeps counting while you read. The PDF prints them with the same grey chip.
- **Any file opens**, not just Markdown: a `.patch`, a `.json`, a script, a photo. Plain UTF-8 text is editable whatever its extension; anything else is shown as the bytes decode, read-only, so Satr can never write rubbish back over it. Photos open in the reading view as pictures. Only a file too large to load is turned away.
- **Search and outline** in one drawer, for this note or all notes, with regular expressions. Find and replace in the note has one bar. The outline tree flips to the note's majority direction; every heading keeps its own.
- **Typing like Obsidian:**
  - Brackets, quotes, `$`, `*`, `_`, `=` and backticks pair up and wrap a selection.
  - `$$` then `$$` opens a math block. A lone `$$` or `$$$$` with nothing between is just text. Only a `$$ … $$` pair whose dollars sit on different lines is a display block; the empty writing line counts as math.
  - Math source is styled like Obsidian: what's between the dollars is monospace and italic, while the dollars themselves keep the note's font in the accent colour (they mark a formula's edges at a glance). A line holding only `$$` never turns monospace, and a pair a heading, a list, a quote or a fence broke is plain text on both sides — editor and reading view read the same rule.
  - A Markdown character inside a formula belongs to the formula, so it never pairs with one in another formula: in `$*$ foo foo foo $*$` the foos are prose between two formulas and stay in the note's own font.
  - A new to-do box is always empty, whatever the line above it says. And when the line under an item is already an empty item, Enter moves into that one instead of making a second empty item and pushing the numbers below.
  - Ordered lists number themselves while you write. Enter on an item numbers the new one after the item above it, and the numbers below move only as far as they must (`6.` then Enter gives `7.`, and an `8.` under it stays `8.`; `1. 2. 3.` becomes `1. 2. 3. 4.`). A line that leaves the list — deleted, joined to the line above, or emptied — brings the numbers below it down, checked on every edit, so Backspace and a selection work like the toolbar's delete-line. Editing an item's text moves nothing. A blank line, prose or another list ends the run, nested items number themselves and are stepped over, and a note you open or a list you paste keeps the numbers it came with.
  - Markor's keyboard: autocorrect and word suggestions on, but never a spell-check underline in your text. Spaces are never second-guessed: what you type (or what the keyboard's auto-correct sends) goes in as it is, before a `)` as anywhere else.
- **A caret the keyboard can see.** The editor is a plain editable region, not Chrome's EditContext API, so the keyboard, the selection handles and the selection bar all act on the same text the note has: the suggestion strip and auto-correct come back after a backspace, tapping a word brings up what the keyboard suggests for it, and "Select all" takes the whole note. Double tap a word to select it, and drag before lifting the finger to take in more. The arrow keys step one position a press, in the paragraph's own order — so the right arrow mirrors in Persian exactly as it does in any text field — and they answer even while the keyboard is still holding a word.
- **Fast start.** The last screen appears at once, before the app's code has loaded.

Open [demo.md](demo.md) in Satr to see all of it. It's also the first note in a fresh browser install.

## Install

Download `satr-debug-<version>.apk` from [Releases](https://github.com/MSadraShakouri/Satr/releases) and install it. Android 6 or later is required. On first run Satr asks for "All files access" so it can open your notes wherever they are.

Each release is signed with the same key, so a new APK installs over the old one and keeps your settings.

## Develop

```sh
npm install
npm run dev          # the web app at http://localhost:5173 (notes live in the browser's storage)
npm run build        # type-check and build to dist/
```

Browser regression tests cover editor input, selection geometry, pagination and PDF rendering:

```sh
npx playwright install chromium   # once; use --with-deps on Linux if needed
npm test                         # all browser regressions
npm run test:pdf                  # PDF-only regressions
```

Or set `CHROMIUM_EXECUTABLE_PATH` to an installed Chromium. These tests cover context-aware delimiters, non-overlapping selections, three-line widow/orphan protection, stranded headings, per-file PDF options, LTR/RTL columns and the math-heavy Homework 12.2 document (8 pages in one column, 4 in two, at the same font size). They do not test Android's IME or native print dialog.

To build the Android app (JDK 21 and the Android SDK are needed):

```sh
npm run android:sync
cd android
./gradlew assembleDebug
```

### Releases

GitHub Actions (`.github/workflows/build-android.yml`) builds the APK when a `v*` tag matching `package.json`'s version is pushed, and publishes it as a release. It signs with the keystore in the `ANDROID_KEYSTORE_BASE64` secret: PKCS12, alias `satr`, password `android`. Create the keystore once:

```sh
keytool -genkeypair -v -keystore satr-debug.jks -storetype PKCS12 -alias satr -keyalg RSA -keysize 2048 -validity 10000 -storepass android -keypass android -dname "CN=Satr"
base64 -w0 satr-debug.jks > satr-debug.b64
gh secret set ANDROID_KEYSTORE_BASE64 < satr-debug.b64
```

Keep both files out of git; they're already in `.gitignore`.

## Built with

- Vite, TypeScript and CodeMirror 6
- marked, DOMPurify, KaTeX and highlight.js
- Paged.js for the PDF
- Capacitor 7 for Android
- Fonts: Vazirmatn and Vazir Code

## Plans

See [ROADMAP.md](ROADMAP.md).

### Direction of numbers and other neutral text

The note's majority — whichever script has more strong letters, with math and
code ignored — flips the outline tree (the line numbers stay on the left edge).
Arrow keys walk a mixed line in visual order and stop on both sides of an
RTL/LTR junction, so the caret never jumps or doubles back at a boundary; after
any edit the caret keeps the line's side, not the side of the character just
typed or deleted, so a number or an English word inside Persian text never
turns the caret around and the caret never moves back and forth within a line. The outline marks the heading two thirds down the page, where you are
reading, rather than the one that has just left the top edge. Formulas can show
all their digits in one set — English or Persian — in the preview and the PDF
(Settings → Editor, "Math digits"); the note keeps the digits that were typed.

The editor caches whole-document context, rather than guessing from the visible
lines. Preview and print use the same resolver over rendered prose (including
soft source newlines):

1. A block's own first strong letter wins. Digits—including Persian and Arabic
   digits—punctuation, Markdown metadata, math and code are not strong prose.
2. For neutral content, unanimous preceding prose since the current heading or
   file start wins, even when following prose has the opposite direction.
3. In a mixed section, use the nearest strong prose on either side, skipping
   math/code. Agreement wins; disagreement prefers the preceding prose. With
   only one neighbour, use it. Never look through a following heading.
4. With no prose evidence, use the current heading, otherwise LTR. Neutral
   headings inherit a parent heading; without a parent, they look into their own
   section before falling back to LTR. A new section never borrows a later
   heading's direction.
5. A line with no strong letter of its own — a bare number, a date, a `#` or a
   list marker — continues the line above it, so a new line is written in the
   language you are writing in and a heading or a marker never turns it around.

This controls paragraph direction/alignment, not character reversal. Math remains
isolated LTR even inside an RTL paragraph or on an RTL-ordered PDF sheet; a
Persian phrase written inside a formula reads right to left there, word by word —
whether it sits in `\text{…}` or bare in the middle of the expression, in a
fraction's argument or under a root.
