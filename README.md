# Satr

A Markdown editor for Android that writes Persian and English side by side. It looks and feels like Obsidian's phone app and works on plain `.md` files in your own folders.

*Satr* (سطر) means "line".

## What it does

- **Both directions in one note.** Every line takes its direction from its first letter, so there's nothing to set. Lists, quotes, tables, footnotes and the PDF all follow it. Inline math stays left to right inside Persian text.
- **Live preview while editing**, with Obsidian's rule: the Markdown syntax shows only on the line you're editing. There's also a separate reading view (double-tap it to edit).
- **Math with KaTeX.** In the reading view and the PDF, long formulas wrap to the screen at `=`, `<`, `≤` and other relations, never at `+` or `−`, and repeat the relation on the next line. They can also wrap at spaces you typed between words. The source is never changed.
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
  - footnotes at the foot of each page
  - page numbers in Persian digits
  - page breaks (`\pagebreak`)
  - your own CSS
- **Your files, your folders.**
  - *Spaces* are shortcuts to folders; Satr never writes its own config into them.
  - *All files* walks the whole storage.
  - Notes open in tabs you can rearrange. Each note remembers its view, scroll position, caret and folds.
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
