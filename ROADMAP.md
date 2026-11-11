# Satr roadmap

Where the project stands, what is next, and what is known not to work yet.
What shipped — release by release, with the numbers and the reasons — is
written up on the
[releases page](https://github.com/MSadraShakouri/satr/releases), v0.1.0
through v0.21.0, each release carrying its own description. The working list
behind this file is [PLAN.md](PLAN.md): every open item in the author's own
words, with its state of play. This is the view of it that faces forward.

## Where it stands (November 2026)

Satr runs as a web app (Vite, TypeScript, CodeMirror 6) and as an Android app
(Capacitor 7, with Satr's own print, storage, system-bars and open-file
plugins). Android 6 and up, always — the newest phone gets the best path and
the oldest gets a working one, decided at runtime.

The editor, the reading view, the PDF export and the document reader are built
and in daily use on one phone. Notes are files in folders behind one storage
interface — a virtual file system in IndexedDB on the web, the device's own
files in the app — and a fresh install writes nothing until the first
keystroke. GitHub Actions builds a signed APK for each `v*` tag, one fixed
key, so every build installs over the last.

The work now is speed (launch, tab switches, large documents), images, search,
and the long tail of the caret in mixed-direction text.

## Next

### Typing

- [ ] Persian UI strings
- [ ] Keyboard toolbar: reorder buttons in Settings (show/hide is done)
- [ ] Auto-capitalize happens on a new line but not on a list item — keep it, drop it, or a setting?
- [ ] Gboard's backspace-drag deletes words and spills into the file name at the start of a note
- [ ] The "phantom spaces" around closing brackets and quotes — a keyboard-level thing, reproduced in Obsidian's own APK too; deferred, no fix included

### Search

- [ ] Search index per space — read files lazily, cache the text, refresh on modification time
- [ ] Search is not live enough (the left sidebar especially) and needs word-per-space queries rather than exact substrings

### Tabs and files

- [ ] A recent tab's **editor state** in memory — the reading view is kept already; the editor is rebuilt on every switch
- [ ] The new-tab page is slow to refresh after picking a file — one measured cause fixed (eight sequential recent checks), the rest still open
- [ ] Recent tabs, redesigned — grouping, pinning, frequency rather than recency; parked until the new-tab page's purpose is decided
- [ ] The floating navbar over an `.html` page — pad under it, hide it on scroll, or shrink it; needs a decision, not code

### Images

- [ ] Adding and editing images (mostly crop)
- [ ] Compression on the way in, squoosh-style with the browser's own codecs
- [ ] CamScanner-like filters — monochrome options, an interactive way, smart guessing
- [ ] Interactive size choosing, when inserting and after; related to importing images from PDFs

### Documents and other files

- [ ] Progressive, random-access PDF loading — a 61.5 MB book is read whole for 5–7 seconds before parse and draw; the whole file crosses the bridge today
- [ ] PDF compression — the method, not the tool
- [ ] Dual panes: a document beside the note it is about, an overlay with adjustable size
- [ ] Crop a part of a PDF into a note as an image — mostly select-and-copy, waiting on clipboard paste of images
- [ ] The ⋯ button when the page counter is hidden — needs the steps that show it

### Launch

- [ ] 429 ms of a cold start happen before any of Satr's own code runs — name the three biggest scripts in it, then cut
- [ ] A note's first opening alternates between two landings about a block apart; returns after that hold still

### The log

- [ ] Frames under a finger — the longest frame gap during a gesture, logged when the finger lifts
- [ ] The shelf's hit rate, the other half of `first page on glass`, a tab switch split — instrumentation, each written down when its round needs it

## Waiting on the phone

Fixes the browser cannot check, believed done, waiting to be seen working on
the device — each with its full state of play in PLAN.md:

- The memory the reader holds: `pictureMb` in the tens, coming back down on leaving the tab
- The five-second freezes — one cause found and fixed; whether it was all of them
- A pdf's bytes **kept** on the second open, not read again
- A launch that does not read a document to find out it is there
- A big note's words before its formulas; typing in a big note; two big notes switching without a kill
- The app getting itself out of a launch loop after two bad starts

## Known limitations

- **The caret in mixed text**: Persian inside inline math and cross-direction line boundaries can still jump. 0.21.0 took the caret native and fixed the measured cases; the remaining ones are named in PLAN.md.
- **The reading view turning RTL after a refresh** — reported intermittently in the web app on Chrome for Android 16, never reproduced here; watched, not understood.
- **Large PDF reads are a memory concern** — bounded random reads are the open answer, not yet a proven one.
- **Gboard can insert a space with an accepted suggestion** — reproduced in Obsidian's APK as well; not a thing Satr can fix alone.

## History

Every release from [v0.1.0 to v0.21.0](https://github.com/MSadraShakouri/satr/releases)
is written up on the releases page. The round-by-round narrative this file
used to carry is preserved in git history, where it was written.
