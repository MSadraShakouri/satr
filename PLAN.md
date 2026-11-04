# The plan

The author's list, as it stands after 0.18.4, plus
the findings he asked be added from this side (marked *(found here)*) — do not
invent any others. Web first, then APK. Lint and GitHub stay deferred. Italic
notes are the state of play, not new work. **Android 6 and up, always** — the
newest phone gets the best path and the oldest gets a working one, decided at
runtime; never a lowest common denominator for everybody.

Closed cases do not live here. What shipped is written up release by release in
ROADMAP.md. **A tick survives here only while it is still unconfirmed** — a fix
waiting on the phone, a fix that cannot be checked until something else is
built, or a bug believed fixed and being watched for its return — **or while it
records a decision** worth not making twice. Everything else has been removed.

## waiting on a test on the phone

Fixes the browser cannot check, because the code that was wrong only runs in the
installed app. Each one is believed fixed and leaves this list the moment it has
been seen working on the phone — or comes back to life if it has not been.

- [x] the logger's two native halves — *the share sheet and the exit reasons are Java, so this side can only prove the branch that leads to them. **To check:** Settings → Troubleshooting → Log should open on a page of lines with the launch timings at the top; Share should offer the phone's own sheet and send a file called `satr-log-<date>.log` that opens as text wherever it lands; and after a kill (swipe it away from recents, or let the phone reclaim it) the next launch should say the last run ended without a goodbye, with a reason beside it on Android 11 and up. If the sheet refuses to open it will say so in the log itself rather than failing silently.*
- [x] note to pdf switch closes the pdf tab and never opens it actually, just stays on the note tab — *fixed in `7abcb25`, and only the phone can say so. `openTab` read every file as text before showing it, and only the installed app measures first: `DeviceBackend.readText` refuses anything over 8MB and the refusal splices the tab out of the list, while `WebBackend.readText` has no size check at all and so never refused anything. A book is always over 8MB, which is why it went from sometimes to always. The other way in already knew better — `openFile` hands a picture and a document an empty string instead of reading them — and the tab switch now agrees with it. **To check:** a book-sized pdf and a note in two tabs, note tab showing, tap the pdf tab; the tab should still be there with its pages drawn. **Also worth a look while you are there:** a pdf that has been deleted no longer closes its own tab, it leaves an empty view in it. That is the one thing the fix changed that was not the bug, and it has not been chased.*

## typing and the keyboard

- [ ] some concept called phantom spaces or something, where a space exists but isn't inserted until a keystroke, apparently keyboard level, but my app fights with it. Where when there's no space between letters and stuff like closed parentheses or quotes or etc, it doesn't insert a space on autocorrect but inserts at the next keystroke, cases like a) or a" and etc (Obsidian never has done this but it works normally and my app is broken, very weird, specifically with parentheses this issue exists, needs research in Obsidian to see why it happens, and possible testing) (important for typing UX) — *not started. The editor already sends the keyboard exactly Obsidian's own attributes (spellcheck on, autocorrect on, autocapitalize on) and no longer second-guesses a typed space, so whatever is left is somewhere else and has never been traced.*
- [ ] Gboard has backspace dragging which deletes words, it spills into the file name if it's at the start, doesn't delete, but it's a bug and doesn't delete the rest, strange but really — *still happening, and nothing has been done about it yet. It needs the device: the swipe is the keyboard's own gesture and arrives as a run of deletions with no key event, so the next step is to watch what the note receives at position 0 and refuse anything that would walk out of it.*
- [ ] putting caret somewhere when * * icons aren't visible makes it before the * icon rather than after it, this itself isn't an issue but a new line that way inserts the * in the new line, that's the bad behavior rather than having the caret not do what it is doing right now
- [ ] have something for headers and maybe have something to repeat the same header as the last one, would be nice but I don't know how to do it on mobile well (probably an extra button that loops last used header to 6 then back to 1 and continue)

## source mode and the reading view

- [ ] header collapse make it like obsidian where it next to it closes it and remove the current > button next to the name (Obsidian has done it cleanly)
- [ ] would be great if in source mode there was a background process that converted the math and tables and stuff (didn't display, just prepare) so the edit to preview mode would switch faster, doesn't need a full page rebuild probably, should definitely be a background process
- [ ] when a new tab is going to get opened on app launch (not the new tab button, rather the app launch planning to go there), it takes long, I think it's the app trying to open the last used page first then switch to tab, though I can't recall if this has been resolved or not, I believe it has been, I tested locally and it doesn't take longer than other files now
- [ ] app launch is slow and heavily depends on the file, should be made something async or something which displays the light stuff first then the heavier stuff after it instead of making it wait, right now empty tab page opens so much quicker than any other file and that alone matters a lot for UX
- [ ] instead of 1/3 of screen exactly, maybe define a small range and align one of them that are in the range exactly instead of just clinging to whatever exists there (will be better for math heavy or long lines and stuff)
- [x] right now, in app it has a slight fade at the top and bottom, this is good but I don't want this for html rendered, only that — *done. The fade is one rule on the two panes; a note fades out under the floating buttons because it slides under them, and a page does not slide anywhere — it sits inside its own frame, so the fade was a dimmed strip of somebody else's design. The pane already carries `is-page` for an html file and nothing else, and that rule already strips the padding, the width limit and the typography a note is given; the mask is now one more thing it gives up. Source mode keeps it, for the page's own source as for any other text file. Waiting on the phone.*
- [ ] opening is slow for big files, I have an idea for it: don't do it all at once, do the current expected screen and then go upwards and downwards (do one direction with a higher priority if scrolling while still loading), maybe even make loading math a separate thread from text, this alone will do a lot, but I still want the entire thing to load at the end rather than making it load dynamically, though maybe we'll have to make sacrifices for big files over something depending on phone specs or something? or maybe load to a size, or something relative to scrolling (faster than the user can scroll or something) (this is repeated, but explained in more detail)
- [ ] change file takes a moment to sync when at the bottom of file (might be at other places too, not tested) (I can't recall the last time this happened, strange)

## math

- [ ] a long Persian `\text{}` run should wrap at its spaces, like the prose it is — *(found here)* 0.18.0 sets an unbreakable over-wide piece smaller instead, down to a floor, and that fixed all three of the over-wide formulas in the author's 819. Two of the three were not wide maths at all: they are Persian `\text{}` definition lines held apart by `\quad`. `\quad` is already a break point (priority 3, between a relation and an operator, src/math.ts) and those lines do break there; what is left over-wide is a single `\text{}` run of Persian prose, 406px of it in one case. The honest fix for those is to let it wrap at its spaces rather than to shrink it — not started.*
- [ ] math single $ sign have spaces like the $$  $$ case where it inserts spaces, though this needs testing for both $ and $$ cases to see if double dollar signs hasn't broken
- [ ] math break new lines for cases where text exists in the line and stuff, sometimes not breaking have having it in the next line entirely would be better, needs thought and testing — *your correction stands: "it's not a simple rule like that, you'll have to test around many cases and see how they work around… more technical and more creative". So the next step is a campaign, not a threshold: take every one of your 234 inline formulas, set each one inside the paragraph it actually lives in at 390px, and record where the line broke, how much of the formula ended up alone on a row, and how much white was left behind on the row above. The rule comes out of what those cases have in common. Not started.*

## search

- [ ] I believe search isn't too much live, especially for left sidebar
- [ ] search needs thought for text, right now it isn't too reliable unless searching exactly a subset of a string, I have ideas for it such as each word space separated being a query

## sidebar, tabs and files

- [ ] new note creation, currently creates at scope base which is undesirable, would really like an option for it but needs thought, right now I have an alternative way which is holding the folder and pressing new note but that's not enjoyable for me (I have an idea right now: show the current dir at the top of the new tab page, will be really good)
- [ ] cache tabs and stuff in memory, after adding pdf and stuff I've been switching tabs much more often, a recent X tabs should probably be kept fresh, maybe the choice in settings or something smart (tab switch is slow)
- [ ] pdf thumbnails in tabs part

## images

- [ ] image adding and image editing (mostly crop)
- [ ] image compression when adding, something like squoosh open source project if it isn't huge, it claims to use browser codecs which is exactly what we need
- [ ] image filters like CamScanner, optional, have an interactive way, smart guessing, monochrome options and such
- [ ] image size choosing interactively, needs thought, while choosing and after the image is inserted, this related to pdf import of images too

## PDF, and other files beside the note

- [ ] pdf compression with something like ghostscript, the method not the tool, tested normal file and 108kb became 98kb, but in files with images it compresses images, if we do something like squoosh we probably won't need to do this
- [ ] pdf dual panes with notes (like an overlay with adjustable size)
- [ ] opened pdf or other files have the option to crop a part of it and insert that into notes as images, this will mostly be select an image from a PDF and copy to clipboard rather than anything else because I plan to add clipboard paste of images
- [ ] a single tap with two fingers reset zoom
- [ ] have a settings for pdf to auto rotate and stuff by user choice (override system rotation option too)
- [ ] maybe hide the bottom part (or both parts) of the pdf header when scrolling, have option for it, right now the top bar and bottom pill take a noticeable space of screen, simple but needs thought
- [ ] pdf opening is very slow, I think it does something for the file before opening it, I want it to be as fast as possible, might be related to file opening and stuff, this is why we need a logger in the app itself — *the logger now answers the "something" in three numbers: reading the bytes, the engine coming up, the document being parsed. Open your book with the log on and the slow one names itself; nothing is optimised yet, because which of the three it is decides what to do.*

## launch and scrolling

- slowness of launch, needs reorganizing notes

## the logger

*"I need logging."* Two items above are really this one — the pdf that is slow
for a reason nobody can see, and the data worth keeping for decisions. The app
wrote nothing at all, not one `console.log`, so this was a new sense rather
than a tidy-up.

Built, in seven commits, and unreleased. What is left is ticked below; the two
halves that only an APK can prove are in "waiting on a test on the phone".

- [x] verbose and non verbose logging, and search and filters and stuff too (export is very important to have), I don't know if I need different levels and stuff — *built. Three dials rather than five levels: volume (quiet, normal, verbose), kind (note, warning, failure — a failure is never dropped, whatever the volume), and an area tag on every line (launch, file, pdf, tabs, search, storage, native). Every line carries a clock and a timed line carries what it took, so the record and the stopwatch are one stream rather than two features.*
- [ ] something system level for the APK, on every version and not only 11+ — ***`logcat` is the half still missing.*** The other half is built: a launch says how the last run ended — cleanly, or with the heartbeat still running past the last goodbye, which is a kill — on every version and in the browser, and on Android 11 and up `ApplicationExitInfo` adds the reason beside it. The notes below are why it was built that way round. *Two of them, and the second is the better one. `logcat -d` run from inside the app returns our own lines with no root and no permission, which is the only way to see what happens underneath the page — plugins, the renderer, a kill. It was never part of the SDK, so it is not promised; with root, `pm grant READ_LOGS` gives the whole system log to the same plugin. And `ApplicationExitInfo`, which is official and answers **why the last run ended**: crashed, froze, or was killed because the phone wanted the memory. That last one would settle the new-tab item in "seen once" without ever reproducing it. It needs Android 11, so it is the top rung of three and not the mechanism: **that** the app was killed, and when, comes from a heartbeat stamped while it is alive against a clean stamp on the way out — which costs nothing, works on Android 6, and is the only rung that also works in the browser where this gets tested. Android 11 adds the reason, Android 12 adds the trace. `logcat` and the share sheet need no ladder at all: both reach back past our floor. Measured, so it is not a guess — minSdk is 23, and the oldest WebView an Android 6 phone can hold is 105 against the chrome87 we compile for.*
- [x] an app level thing — *built, and it is what everything else sits on. A ring of 2,000 lines in memory, flushed to IndexedDB in batches and on the way to the background, so it survives a crash as far as the last flush. Not localStorage: that one blocks the screen on every write, which is the crime under investigation.*
- [x] the web version — *built first, and 37 tests of it read the log back and assert on what it says. Gets all of it except the two native sources, and is where the logger is built and tested, because Playwright can read the log back out and assert on what it says.*
- [ ] export — ***the vault file is the half still missing***, and it is the one that would land a log in git where it can be read on this side. Built: the share sheet on the phone, a downloaded file in the browser, and copy — each carrying what the filters left rather than the whole log, since a log narrowed to the thing being asked about is the useful one to send. *Was: into the vault as `Logs/<date>.log`; plus the share sheet and the clipboard. Plain text, with ndjson for when something has to parse it.*
- [x] what it records on day one — *built, and the pdf one came apart into three numbers rather than one: reading the bytes, the wasm engine coming up (once a run), and the document being parsed (every open). The five already complained about: launch, opening a file, pdf open, tab switch, source to preview. Each one as a duration, so "pdf opening is very slow, I think it does something for the file before opening it" gets a number instead of a suspicion.*
- [x] it must not become the slowness itself — *measured: a kept line costs under 0.05 ms and a refused one under 0.01 ms. Nothing formatted when written, `performance.now()` only, writes batched off the path being timed, and a quiet log call is one comparison and a return. Its own cost gets measured both ways like everything else.*

## seen once, waiting for it to happen again

Bugs I hit once and have not been able to bring back. Some may already be
fixed by something else; none can be diagnosed until they show up again.

- [ ] some times after being gone, it doesn't open a new tab, I don't know why (happens rarely, it has been a while since it last happened) (happened again, sometimes it stays even after 15 min unless I'm hallucinating) (assumed fixed, I haven't been using the app too much recently)


## later

- [ ] text direction incredibly unpredictable with ←→ buttons, needs thought, issue that some lines ← is back while in others it's forward, and can lead to loops, I don't know what to do. Could make lines between math LTR too, would help with predictability — *measured, and it is two questions wearing one sentence. **Inside a line it was ours, and it is fixed** (0.15.1+): the arrows follow what is drawn, so a press is one drawn position and never 8px the wrong way or a 42px jump across a formula, and a slot two positions share means one of them. **Between lines it is not ours.** The same note was walked with ← in Satr, in a plain `<textarea>` with `unicode-bidi: plaintext`, and in a contenteditable with `dir` per line — the same browser, the same keypresses — and all three give the identical sequence, loop included: `1:1 … 1:9 2:0 1:9 2:0 1:9 2:0`. The loop is the honest answer to the keys, not a fault: ← carries you off the end of a Persian line onto the English line below, and on an English line ← means backward, so it walks straight back. Obsidian does the same — its `app.js` carries CodeMirror's own `cursorCharLeft` / `cursorCharRight` / `moveByChar` and no `rtlMoveVisually` — and its forum says so in your words: "for arrow keys you must go to the beginning of the line & continue pressing left arrow… in summary they are vice versa too". Markor is a plain Android `EditText` and does whatever the platform does. Nor is there a model that would save it: macOS, Firefox and Safari move the caret visually, Windows, Android, Word and Google Docs move it logically, Firefox ships a three-way preference because neither answer satisfied everyone, and **both models decide which key means forward from the line's own direction** — so both flip it when the direction flips. The keys that do cross a direction change cleanly, measured here: ↓ and ↑ keep the goal column and are exactly symmetric (`1:5@761` → `2:16@211` → `3:5@759`, and back), and Home/End are logical in both scripts. **The second half of the item — making the lines between math LTR — was built and withdrawn**: it is in the history as a measurement, not in the app. What shipped instead is that a formula and a code span are one isolated thing, standing on the same side of a Persian line in the editor as in the reading view and the PDF.*
- [ ] normal toolbar hamburger menu icon open it as a growing pop-up like chromium rather than showing up a menu (I'm not sure about this, should I do it?)
- [ ] tablet support later with more than one "tab" being on the screen, like Obsidian
- [ ] possible lint/fixer in the app (criteria below)
- [ ] later add GitHub connection like my markdown editor site, I don't mean sync, I mean read write access in a scope method way to do so (my project implemented it nicely but the UI of that is bad compared to Satr, and it's desktop first rather than mobile app)
- [ ] settings into parts, a locale part in it too because right now a lot of the settings are simply locales
- [ ] have option to sort toolbar stuff
- [ ] maybe be able to have a quick note or something, needs thought, I think Obsidian has a daily thing perhaps
- [ ] maybe have something that logs data and stuff that'll later be needed for decision making (this is more important than thought)

## decided against

- nothing worth keeping here at the moment

## note lint criteria

for the in-app lint/fixer above, measured on term_three with the app's own scanner (0 katex errors today, everything else is real):

1. a display `$$` line that is a lazy continuation of a list item — it renders inside the bullet, indented and centered within the `li`, instead of as a page-centered display block. 11 sites now: Probability Theory 03:83,86,89,92,95,121,124,127,130; Mathematics 2 03:32; Linear Algebra 01:18. fix = one blank line before the `$$`
2. `<div dir=ltr>` wrappers are now redundant (direction is computed, math is already forced ltr) — 20 pairs in Mathematics 2 01, all paired, safe to strip. report as "redundant", not "wrong"
3. trailing `:` in a heading, visible in the outline and in search — Accounting 03:5 `## فصل دوم: `, Accounting 03:66 `##### اهداف:`
4. trailing space in heading text, so the outline reads `معرفی ` — Accounting 01:14, Linear Algebra 02:21
5. list indent must be 0/2/4: a 1-space indent reads as a sibling rather than a child, so a bullet that looks like a parent renders as a peer — Probability Theory 02:246
6. empty list item renders as a blank bullet — Probability Theory 01:159
7. run every formula through `renderMath` and fail on any `katex-error` — katex is `throwOnError: false`, so a typo is a silent red formula in the reading view and in the PDF, and there is no other way to notice
8. assert the latex-style converter never fires on a real line break: `\\[6pt]` in Linear Algebra 03:38 is a `\\[6pt]` skip, not a `\[…\]` pair. today correct by two independent guards (the preceding backslash, and the enclosing `$$` span) — worth pinning so neither guard is ever weakened

not criteria, deliberately: callouts/dataview/graph/tags (not supported, would render literally), table separator styles and headerless tables (`ensureTableSeparators` inserts the separator, then the empty header row is removed), persian `۱.` ordered lists (transliterated, then re-rendered as persian), bare emails (gfm autolinks them), math digit style (a settings choice), and unifying `$$ x $$` against bare `$$` (both are `display: true`, they render the same)
