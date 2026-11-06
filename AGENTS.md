# Working on Satr

For coding agents. Read this before touching anything; it is the difference
between a round that lands and a round that wastes a day.

Satr is a notes app for a phone: markdown, maths, Persian and English mixed in
the same line, built with Capacitor around a web app. A CodeMirror 6 editor
("source view") and a custom-rendered reading view show the same note. It is
used daily, on one Android phone, by the person you are working for — on
university notes of 100kB+ with over a thousand formulas. Everything below
exists because something went wrong once.

---

## The working agreement

**Never push. Ever.** Every round ends in a patch file he applies himself.
He has unpushed work of his own and a push can bury it.

**One patch per round, named for the commit it applies to** —
`satr-on-<base>-<subject>.patch` in `/home/user/`. Delete the previous one so
there is only ever one file to reach for.

**No patch leaves with a failing test in it.** A patch once went out with three
known failures and a paragraph of explanation in chat; he applied it and it
made his app worse in two visible ways. A caveat is not a substitute for green.
If it cannot be made green, hand over the diagnosis and no patch file.

**Reproduce his complaint locally before fixing it.** He reports in feel —
"it jumps a tiny bit", "it stutters" — and the first guess at which code that
means is usually wrong. A whole round went into the reading view for a bug that
lived in the editor. When a scroll bug will not reproduce, change the *mode*
before changing the timings: a note has two viewers and they share no code.

**Measure, then fix, then measure again, and print both numbers.** "Switching
back: 622ms → 286ms" is the deliverable. A claim without a number is not one.

**Revert-proof every fix.** Remove the change, watch the new test fail, put it
back. A passing test proves nothing until you have seen it fail. Idiom:
`cp src/X /tmp/S`, patch it out with python (`assert s.count(a) == 1`),
rebuild, run, restore, rebuild.

**Ask before designing behaviour he will feel.** A key, a button, a gesture: he
wants the choice, in a short numbered list. He once asked, fairly, "why did you
do that without asking the design?" Bugs with exactly one correct answer — a
drift, a crash, a wrong pixel — go straight to code.

**Never ship a change that makes a user-facing number worse**, even for
correctness. Re-measure the win with the guard in place.

**`package.json` is frozen** at its current version. He cuts tags and decides
releases. Never bump it, never create a `v*` tag.

**Both trailers on every commit:**

```
Co-authored-by: Sadra Shakouri <sadrashakouri@gmail.com>
Co-authored-by: Arena Agent <agent@satr.local>
```

**Never rewrite published history.** Rebase your own work onto his head; never
discard a commit of his that you have not seen applied.

**`PLAN.md` is the shared memory.** Tick items there in his words, with what
landed, what did not, and the numbers. It is how the next session starts
informed instead of guessing. Keep your own invented mechanics in `PLAN.md`,
unmarked — he reverted a conventions section added to `ROADMAP.md` once; do not
re-create it.

**Never commit `books/book.pdf`** (31MB, his own book, used as a fixture) and
never compress it. Test against his real notes in `/home/user/uni-notes/`;
never commit those either.

**Keep it light, and treat smoothness as a feature.** This runs on one phone.
A megabyte of dependency to solve a 20-line problem is not a solution.

**A running server is not a deliverable.** His interface cannot open live
previews. When something must be *seen*, produce a single self-contained HTML
file with the pictures and the numbers written into it — no external URLs.

---

## Setup and the gate

`node_modules` does not survive between messages in the sandbox:

```bash
npm ci
npx playwright install chromium          # ~45s, needed once per session
```

The gate, in order. Run it after every `src/` edit — the tests run the built
bundle, so skipping the rebuild means testing stale code:

```bash
./node_modules/.bin/tsc --noEmit
./node_modules/.bin/vite build --config tests/vite.test.config.ts
SATR_TEST_BUILD=skip ./node_modules/.bin/playwright test tests/<spec>.spec.ts --workers=1
```

Run the specs that touch what you changed, plus their neighbours — usually
three to six files. That is the whole routine.

**Do not run the full suite.** It is ~330 tests across ~56 files, it takes the
best part of ten minutes in two batches, and most of what it reports is noise
from the pre-existing failures listed below. The signal from six relevant specs
is better, and you can run it after every edit instead of once a round.

**Always write a test run to a file and read the file.** Never pipe a run
through `grep` and nothing else: the output is gone the moment you need the
part you did not ask for, and re-running a batch to see which three failed
costs six minutes and tells you nothing new.

```bash
mkdir -p /home/user/testlogs
SATR_TEST_BUILD=skip ./node_modules/.bin/playwright test <specs> \
  --workers=2 --reporter=line > /home/user/testlogs/<name>.log 2>&1
grep -E "✘|passed|failed" /home/user/testlogs/<name>.log | tail -10
```

Then grep that same file as many times as you need — for the failing names,
for an error, for a number printed by the app. **Delete the log when the thing
it was proving is done**, so the folder never becomes a graveyard. Keep logs
out of the repo: `/home/user/testlogs/`, never inside `satr/`.

**The full suite is for a version release**, or for the rare moment you have
genuinely changed something central — the editor's keymap, how a note is
rendered, how files are read — and cannot name which specs that touches. If you
cannot name a reason out loud, that is the answer: do not run it.

Pre-existing failures, not yours: `autoSpace.spec.ts:167` (a mark that has its
space already — 1 run in 3 on a quiet machine, with and without the Enter
change of 0.20.0's round), `uiScale.spec.ts:109` (TypeError),
`pdfDisplayOptions.spec.ts` at `--workers=3`, `mathBreaks.spec.ts:210`
(environment), `pdfFile.spec.ts` 1-in-64 at `--workers=2`,
`session.spec.ts:180` under mixed parallel load.

---

## Git in this sandbox

`.git/config` is stripped between messages. Every round, before anything:

```bash
git config user.name "satr agent"
git config user.email "agent@satr.local"
git remote add origin "$(cat /home/user/satr-origin.txt)"
git fetch origin; echo "EXIT=$?"
```

**Never pipe git plumbing into `tail` or silence it with `-q`.** "Your errors
are quiet" was a real complaint: a failed fetch that scrolled past cost a round.

**Audit his push before rebasing onto it:** list the commits, check both
trailers on each, confirm `git diff --stat <old> origin/dev -- package.json` is
empty, and confirm `git diff work origin/dev` is empty (his applied tree should
be byte-identical to yours). `git am` rewrites SHAs, so compare trees, not IDs.

**Commits:** several focused ones, each with its own tests, never one pile.
Subject is lowercase `area: sentence` — `editor: backspace after a heading
marker takes a level off`. The body explains the behaviour and carries the
numbers. Commit with explicit paths: `git commit -F /tmp/msg.txt -- <paths>`.
The `PLAN.md` tick goes last.

**Splitting one file across two commits:** copy the final version aside,
`git checkout` the file, python-patch only the first change, `tsc`, commit that
path, restore the copy, commit the rest.

**Amending a commit that is not HEAD:** `git commit --fixup <sha>` then
`GIT_SEQUENCE_EDITOR=true GIT_EDITOR=true git rebase --autosquash -i origin/dev`.

**Cut and verify the patch:**

```bash
git format-patch origin/dev --stdout > /home/user/satr-on-<base>-<subject>.patch
git clone --no-local -q . /tmp/v1 && cd /tmp/v1
git config user.name "satr agent" && git config user.email "agent@satr.local"
git checkout -q -B verify <base>
git am /home/user/satr-on-<base>-<subject>.patch
diff -r -q /tmp/v1/src /home/user/satr/src        # must be silent
rm -rf /tmp/v1
```

---

## Writing tests

Playwright, mobile viewport (390×844, `hasTouch`, `isMobile`). Boot a note by
seeding `localStorage` in `addInitScript` before `goto('/')`:
`satr:fs:index`, `satr:fs:file:<path>` (an inbox, drained on first read),
`satr:tabs`, `satr:demoShown`. Duplicate tab paths collapse. The tab switcher
opens in the editor.

- **Park the viewport with `page.mouse.wheel` only.** Setting `scrollTop` from a
  test parks nobody: the app's own logic never sees it.
- **Poll counts** (`.md-section`, `[data-satr-math]`), never `toBeVisible`, on a
  big note.
- `#preview-toggle` must be clicked through `evaluate`, not `.click()`.
- `window.appView` is installed *by the specs that use it*, not by the app. A
  new spec either installs it the same way or drives the real UI with clicks and
  keys — see `tests/headingBackspace.spec.ts`.
- In-page timings: `console.log` in the app, `page.on('console')` in the spec.
- `tsc` does not check `tests/`.
- One assertion per claim, each with its own message naming what moved.

---

## Where things are

- **`src/main.ts`** — the spine, and the biggest file: tabs, modes, the kept-note
  cache, section measurement (`measureSection`, `watchSections`,
  `seedSectionHeights`), view memory (`rememberView` → `writeViewMemory`,
  `restoreView`), the editor hold (`holdEditorPosition`). Line numbers shift
  constantly; grep, never trust a remembered line.
- **`src/scrollSync.ts`** — the two panes agreeing on a place. `editorScroll` /
  `applyEditorScroll` (the exact inverse of each other — the live sync depends
  on that), `editorPlace` (the band, save-path only), `previewScroll` /
  `applyPreviewScroll`.
- **`src/viewMemory.ts`** — what a saved place *is*. It rebuilds the record field
  by field on read; a field you add to the type and forget here is silently
  dropped. That was a whole round.
- **`src/livePreview.ts`** — the source view's rendered markdown, from syntax-tree
  nodes (`Highlight`, `Emphasis`, `Strikethrough`, markers hidden as the caret
  leaves). Modeled on Obsidian's editor.
- **`src/markdown.ts`** — the reading view's renderer (marked extensions,
  `.md-section` blocks, the `==highlight==` tokenizer).
- **`src/editor.ts`** — CodeMirror setup and the keymap. Order matters; the
  markdown keymap is deliberately absent.
- **`src/enterKey.ts`**, **`src/caretMotion.ts`**, **`src/delimiterInput.ts`**,
  **`src/autoSpace.ts`** — typing behaviour, including IME-safe key handling.
- **`src/mathScan.ts` / `mathSource.ts` / `mathLayout.ts` / `mathFill.ts`** —
  finding maths, mapping it through edits, laying it out, and drawing it
  outwards from the reader.
- **`src/style.css`** — note `content-visibility: auto` on `.md-section`; it
  forgets a remembered size, which has caused two scroll bugs.
- **`android/`** — never compiled here; there is no Android SDK in the sandbox.

---

## Dead ends: do not re-run these

- **A pixel is not a place in a settling document.** Five separate designs tried
  to restore a scroll position as a pixel. A place is a line; the pixel is
  derived. (The one exception that works: a line *plus* a measured gap, both
  read in the same breath.)
- **Round-tripping a position through an estimate is a feedback loop.** Saving
  "line + fraction of that line's height" and restoring by multiplying the
  fraction back by CodeMirror's *estimate* of that height has no fixed point; it
  settles into an orbit. The give-away is the document's own height oscillating
  with the pixel.
- **A guard that is almost always armed disables the feature.** Check how often
  your fast path actually fires before believing it works.
- **Before hanging state on a lifecycle hook, log the hook.** `rememberView`
  never runs on a fast tab switch (it returns early while a restore is in
  flight); a fix attached to it logged `null` forever and looked like a bad
  guard.
- **Hunt the later writer, not the write.** When a value is wrong, find
  everything that writes it after you do.
- **A filmstrip cannot show latency.** Print milliseconds; do not photograph
  motion.
- **`content-visibility: auto` forgets its remembered size**; do not rely on a
  section's height surviving a scroll away and back.
- **Live preview as a deliverable** — he cannot open one. Self-contained HTML.

---

## Ending a round

Say what changed, in his words, with the before and after numbers side by side.
List what you did *not* do and what is still wrong — openly, not buried. Give
the patch path, the base it applies to, and the exact tests you ran with their
results. If anything is unresolved, end with a short numbered list so he can
pick the next thing with one word.
