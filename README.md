# Satr

A Markdown editor for Android that writes Persian and English side by side. It looks and feels like Obsidian's phone app and works on plain `.md` files in your own folders.

*Satr* (سطر) means "line".

## What it does

- **Both directions in one note.** Prose follows its first strong letter. Numbers and dates infer their direction from surrounding prose, using the same policy in the editor, reading view and PDF. Math and literal code stay LTR and never influence neighbouring prose.
- **Live preview while editing**, with Obsidian's rule: the Markdown syntax shows only on the line you're editing. There's also a separate reading view (double-tap it to edit).
- **Math with KaTeX.** In the reading view and the PDF, long formulas wrap to the screen at `=`, `<`, `≤` and other relations, never at `+` or `−`, and repeat the relation on the next line. They can also wrap at spaces you typed between words. Overwide display formulas in print can also use KaTeX’s own operator breaks to fit the column. The source is never changed.
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
  - Notes open in tabs you can rearrange. Each file remembers its reading position, view, caret and folds across switches, tab closure/reopening and app restarts. Android files opened by another app keep a bookmark tied to the source URI, not the temporary permission ID.
  - Undo **and redo** belong to each open tab, in memory. Switching tabs or losing focus keeps both stacks; closing the tab or app ends them. No persistent revision history is added.
- **Any file opens**, not just Markdown: a `.patch`, a `.json`, a script, a photo. Plain UTF-8 text is editable whatever its extension; anything else is shown as the bytes decode, read-only, so Satr can never write rubbish back over it. Photos open in the reading view as pictures. Only a file too large to load is turned away.
- **Search and outline** in one drawer, for this note or all notes, with regular expressions. Find and replace in the note has one bar.
- **Typing like Obsidian:**
  - Brackets, quotes, `$`, `*`, `_`, `=` and backticks pair up and wrap a selection.
  - `$$` then `$$` opens a math block.
  - No spell check, autocorrect or suggestions in your text.
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

This controls paragraph direction/alignment, not character reversal. Math remains
isolated LTR even inside an RTL paragraph or on an RTL-ordered PDF sheet.
