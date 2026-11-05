# The plan

The author's list, as it stands after 0.18.6, plus
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

## the phone is being killed for memory

Not reported — found in the log you sent on 4 November, which is the whole
argument for having one. Across twenty runs: six exits the system calls **low
memory**, two spells of *"Input dispatching timed out… Waited 5000ms"* (the app
not answering a touch for five seconds, which is what an ANR dialog is made
of), and a resident set that reached **990 MB**. Nothing in those 544 lines
said what the app was holding, so there was nothing to blame.

- [x] something to blame it on — *the log now says, at every launch, every half
  minute, when a document's first page lands and on the way to the background:
  the JavaScript heap and the pixels behind every canvas. Canvas pixels are the
  half that matters and the half nothing could see — they are not on the JS
  heap, so the heap figure can read 60 MB while the process holds ten times
  that. One full-screen tile on your phone is eleven megabytes.*
- [x] find out what the 990 MB is — *found, and most of it was not a leak but
  a budget. A page's picture on your phone is **7.7 MB**; the app kept about
  seven of them (54 MB), a sharp tile of up to 50 MB, and 24 MB of sketches.
  On top of that the tab switcher read the whole book as text to draw a card,
  which is 80 MB of string on its own. The budgets are now 23 MB of pages, a
  24 MB tile and 8 MB of sketches, and the card reads nothing.*
- [ ] confirm it on the phone — ***this is the one thing I cannot check
  here.*** **To check:** open the book, read a few pages, press the tabs
  button, switch to a note and back, then send the log. The `holding` lines
  carry `pictureMb`; it should stay in the tens now and come back down when
  you leave the tab. If it climbs past a couple of hundred, the pages are not
  being let go and the band is not the whole story.
- [ ] the five-second freezes — *one cause found and fixed by accident: the
  tabs button read the whole book as text on the main thread, which is
  seconds of held thread on a 31 MB file and exactly what "not responding"
  means. Whether that was all of them, only the phone can say. The other
  candidates with numbers against them are `edit to preview` at 231-536 ms
  (rising with the size of the note) and a search reading every note off the
  disk. A long-task watcher is the next rung if they come back.*
- [x] what a held thread was quietly breaking — *the double tap on a scanned
  pdf. It compared wall-clock readings taken inside the handler, so a render
  holding the thread between the two taps made them look 400 ms apart when
  they were 180. Fixed by reading the event's own stamp. Worth keeping here as
  a shape to look for: **any gesture timed by `Date.now()` inside its own
  handler is timing the app's availability, not the finger.***

## waiting on a test on the phone

Fixes the browser cannot check, because the code that was wrong only runs in the
installed app, or because only a phone can say what a saving is worth. Each one
is believed fixed and leaves this list the moment it has been seen working on
the phone — or comes back to life if it has not been.

- [ ] the read that happened every time — *the browser proves the file is not read twice; only the phone can say what that is worth, because only the phone reads at 9 MB/s. **To check:** open the book, switch to a note, switch back, and read the log. The second open should say `pdf bytes kept` where it used to say `pdf bytes read`, and should be about three and a half seconds quicker. If it still says `bytes read`, the modified time the device backend reports is not stable across opens and the cache has to be keyed on something else.*
- [ ] the launch that stopped reading a book to find out it was there — *the saving only exists where there is a big file and a slow read, so it cannot be measured here. **To check:** leave the book's tab as the open one, force-stop the app, and launch it. The log should go from `cold start` to `first file on screen` without a `file read` line for the pdf at all.*
- [ ] the app getting itself out of a launch loop — *a browser tab is not killed in the middle of starting, so the guard can only be proved on the phone by hand. **To check:** force-stop the app twice while the splash is still up, then launch it a third time. It should open on the empty tab with a sentence naming the file, and the log should carry "started on an empty tab after a bad start". If it fires when it should not — after an ordinary force stop of a running app, say — the mark is being left behind somewhere it should not be.*

## typing and the keyboard

- [ ] some concept called phantom spaces or something, where a space exists but isn't inserted until a keystroke, apparently keyboard level, but my app fights with it. Where when there's no space between letters and stuff like closed parentheses or quotes or etc, it doesn't insert a space on autocorrect but inserts at the next keystroke, cases like a) or a" and etc (Obsidian never has done this but it works normally and my app is broken, very weird, specifically with parentheses this issue exists, needs research in Obsidian to see why it happens, and possible testing) (important for typing UX) — *not started. The editor already sends the keyboard exactly Obsidian's own attributes (spellcheck on, autocorrect on, autocapitalize on) and no longer second-guesses a typed space, so whatever is left is somewhere else and has never been traced.*
- [ ] Gboard has backspace dragging which deletes words, it spills into the file name if it's at the start, doesn't delete, but it's a bug and doesn't delete the rest, strange but really — *still happening, and nothing has been done about it yet. It needs the device: the swipe is the keyboard's own gesture and arrives as a run of deletions with no key event, so the next step is to watch what the note receives at position 0 and refuse anything that would walk out of it.*
- [ ] putting caret somewhere when * * icons aren't visible makes it before the * icon rather than after it, this itself isn't an issue but a new line that way inserts the * in the new line, that's the bad behavior rather than having the caret not do what it is doing right now
- [ ] have something for headers and maybe have something to repeat the same header as the last one, would be nice but I don't know how to do it on mobile well (probably an extra button that loops last used header to 6 then back to 1 and continue)

## source mode and the reading view

- [ ] header collapse make it like obsidian where it next to it closes it and remove the current > button next to the name (Obsidian has done it cleanly)
- [ ] would be great if in source mode there was a background process that converted the math and tables and stuff (didn't display, just prepare) so the edit to preview mode would switch faster, doesn't need a full page rebuild probably, should definitely be a background process
- [ ] when a new tab is going to get opened on app launch (not the new tab button, rather the app launch planning to go there), it takes long, I think it's the app trying to open the last used page first then switch to tab, though I can't recall if this has been resolved or not, I believe it has been, I tested locally and it doesn't take longer than other files now
- [ ] app launch is slow and heavily depends on the file, should be made something async or something which displays the light stuff first then the heavier stuff after it instead of making it wait, right now empty tab page opens so much quicker than any other file and that alone matters a lot for UX — *measured on your phone: 610 ms from cold to "ready to read", of which 429 ms is the page fetching and running its scripts before the app's own code starts. The app's share of it is 189 ms. "Heavily depends on the file" had one extreme case and it is gone — launching on a pdf read the whole file as text first — but the general shape of this item is still true and still open, and the 429 ms is the half to attack next.*
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
- [ ] cache tabs and stuff in memory, after adding pdf and stuff I've been switching tabs much more often, a recent X tabs should probably be kept fresh, maybe the choice in settings or something smart (tab switch is slow) — *two thirds done. The open document's bytes are kept while you are in another tab, so coming back to a book does not read it again. And opening the switcher itself no longer reads every tab's file to draw its card — which on a book was the whole file, decoded to text; that was the slow part you could feel. A note is not kept in memory — on your phone a note reads in 14-45 ms, so there is nothing there worth holding yet. The rest of a tab (its editor state, its reading view) is still rebuilt, and that is where the remaining 114-147 ms of a switch goes.*
- [ ] recent tabs needs redesign, a plain 7-8 item list isn't good because I access many different files, just something to think on rather than acting right now — *parked deliberately, no code. What is there is one flat list of the last eight files you opened, newest first, which answers "what did I just have" and nothing else; with dozens of files in play the one you want is rarely in the last eight, and when it is, it is because you opened it a minute ago and could find it anyway. Things to think about before any of it is built: grouping by folder or by kind (books apart from notes), pinning, frequency rather than recency (or the two together, the way a launcher ranks), the day you last opened something as a heading, search being the real answer with recents only as the zero-keystroke case, and what the new-tab page is **for** — a list to pick from, or a place to start typing. No decision yet; it is on this list to be thought about.*
- [x] pdf thumbnails in tabs part — *done, then done properly. The first version drew the card from the hundred-pixel sketch the reader already keeps, because it was free and already in memory; "thumbnail quality is really bad" is exactly what that looks like. A card is now a picture at the card's own size — 520 pixels, its width on your phone at three device pixels — taken from the page's real picture and kept as JPEG at 0.82. Still no file read and no engine: that part was right. **Two more passes since (0.19.0):** the card wears the dark theme's own filter, so a dark app no longer hands back a sheet of white paper (and a page that was authored dark is left alone, as on the page); and the card is the part of the page you were looking at rather than the whole sheet, cut from the zoom tile when there is one — zoomed into a figure or one column of a paper, the card used to show you the very view you had zoomed out of.*

## images

- [ ] image adding and image editing (mostly crop)
- [ ] image compression when adding, something like squoosh open source project if it isn't huge, it claims to use browser codecs which is exactly what we need
- [ ] image filters like CamScanner, optional, have an interactive way, smart guessing, monochrome options and such
- [ ] image size choosing interactively, needs thought, while choosing and after the image is inserted, this related to pdf import of images too

## PDF, and other files beside the note

- [ ] pdf compression with something like ghostscript, the method not the tool, tested normal file and 108kb became 98kb, but in files with images it compresses images, if we do something like squoosh we probably won't need to do this
- [ ] pdf dual panes with notes (like an overlay with adjustable size)
- [ ] opened pdf or other files have the option to crop a part of it and insert that into notes as images, this will mostly be select an image from a PDF and copy to clipboard rather than anything else because I plan to add clipboard paste of images
- [x] the single finger zoom stops partway after a double tap — *fixed. It was never about the zoom: your finger was holding the page's picture, and the viewer takes that picture away and puts a sharper one up every time the zoom changes. The browser cancels a gesture whose element has gone. That is why it needed the double tap first (there is no sharp tile below 1.01 zoom, so there is nothing to remove), and why a scan never did it (65 ms a megapixel to draw against 8, so the new picture lands after you have finished rather than during). The pictures are out of touch handling now and the finger holds the page.*
- [x] coming back to a document should arrive at a good page, not a smear — *the shelf that outlives a closed document kept ten pages at a hundred pixels. It now keeps the page you were on at nine hundred pixels and four rough neighbours for a flick. About a megabyte on disk for four documents.*
- [x] a screenshot or a trip to recents leaves the app showing a still picture of the page that ignores touch, pdf only, every time, cured by reopening — ***fixed in 0.18.9, confirmed on the phone: "Works now".*** *It was not the visibility flag, which was a red herring: that 30 ms of `hidden` happens on every healthy resume too, and 0.18.8's native kick for it changed nothing. Coming back ran a refresh that asked whether the open file had changed on disk, and it asked by reading the file back as text — so a pdf always looked changed, was always adopted, and adopting rebuilt the entire viewer: engine, parse, column, every page rasterised, on every lock and unlock. A main thread busy doing that to a book on a phone short of memory shows its last frame, takes no input and still scrolls, and comes back about a minute later. His log of the fixed build: three resumes, no rebuild, frames in 19 to 38 ms, 62 canvases held throughout. A resume that paints nothing after 600 ms rebuilds the document anyway as a backstop, and it has not had to fire.*
- [ ] a single tap with two fingers reset zoom
- [ ] have a settings for pdf to auto rotate and stuff by user choice (override system rotation option too)
- [ ] maybe hide the bottom part (or both parts) of the pdf header when scrolling, have option for it, right now the top bar and bottom pill take a noticeable space of screen, simple but needs thought
- [ ] pdf opening is very slow, I think it does something for the file before opening it, I want it to be as fast as possible, might be related to file opening and stuff, this is why we need a logger in the app itself — *answered, and half acted on. The "something" was the file being read: 268 ms for a 2.2 MB pdf on your phone against 54 ms for a 31 MB book on this desktop — about 9 MB/s — and it happened again on every switch back to the tab. That is fixed twice over (the bytes are kept between switches; the launch no longer reads a document as text at all). **What is left is the drawing**: `first page on glass` is 360 ms cold and about 205 ms warm on the phone, against 307 ms here, so it is a real cost rather than a slow device, and it is now the largest thing in an open. Not started — it needs its own round.*

## launch and scrolling

- slowness of launch, needs reorganizing notes

## the logger

*"I need logging."* Two items above are really this one — the pdf that is slow
for a reason nobody can see, and the data worth keeping for decisions. The app
wrote nothing at all, not one `console.log`, so this was a new sense rather
than a tidy-up.

Built, released in 0.18.4, and proved on the phone: the author's own log came
back as a file through the share sheet, with the exit reasons in it. One half
is left, ticked below — `logcat`.

- [x] verbose and non verbose logging, and search and filters and stuff too (export is very important to have), I don't know if I need different levels and stuff — *built, then corrected by you and rebuilt: "the buttons should only decide what level of logs is shown rather than how much is logged." **Everything is recorded, always; the dial filters the view and the export.** Worth not deciding twice — a line refused when it is written cannot answer a question asked afterwards, and afterwards is when a log gets read. What keeps it bounded is size instead: a megabyte or five thousand lines in memory, about ten megabytes in the database, oldest out first. Three dials still: detail (quiet, normal, verbose), kind (note, warning, failure), and an area tag on every line (launch, app, file, pdf, tabs, search, storage, native).*
- [ ] something system level for the APK, on every version and not only 11+ — ***`logcat` is the half still missing.*** The other half is built: a launch says how the last run ended — cleanly, or with the heartbeat still running past the last goodbye, which is a kill — on every version and in the browser, and on Android 11 and up `ApplicationExitInfo` adds the reason beside it. The notes below are why it was built that way round. *Two of them, and the second is the better one. `logcat -d` run from inside the app returns our own lines with no root and no permission, which is the only way to see what happens underneath the page — plugins, the renderer, a kill. It was never part of the SDK, so it is not promised; with root, `pm grant READ_LOGS` gives the whole system log to the same plugin. And `ApplicationExitInfo`, which is official and answers **why the last run ended**: crashed, froze, or was killed because the phone wanted the memory. That last one would settle the new-tab item in "seen once" without ever reproducing it. It needs Android 11, so it is the top rung of three and not the mechanism: **that** the app was killed, and when, comes from a heartbeat stamped while it is alive against a clean stamp on the way out — which costs nothing, works on Android 6, and is the only rung that also works in the browser where this gets tested. Android 11 adds the reason, Android 12 adds the trace. `logcat` and the share sheet need no ladder at all: both reach back past our floor. Measured, so it is not a guess — minSdk is 23, and the oldest WebView an Android 6 phone can hold is 105 against the chrome87 we compile for.*
- [x] an app level thing — *built, and it is what everything else sits on. A ring of a megabyte in memory, flushed to IndexedDB in batches and on the way to the background, so it survives a crash as far as the last flush. Not localStorage: that one blocks the screen on every write, which is the crime under investigation.*
- [x] the web version — *built first, and 37 tests of it read the log back and assert on what it says. Gets all of it except the two native sources, and is where the logger is built and tested, because Playwright can read the log back out and assert on what it says.*
- [x] export — *the share sheet on the phone, a downloaded file in the browser, and copy — each carrying what the filters left rather than the whole log, since a log narrowed to the thing being asked about is the useful one to send. Plain text, with ndjson for when something has to parse it. (A fourth way, writing the log into the vault as a note, was built and then removed at your word: "remove the save to notes, i do not need that at all.")*
- [x] what it records on day one — *built, and the pdf one came apart into three numbers rather than one: reading the bytes, the wasm engine coming up (once a run), and the document being parsed (every open). The five already complained about: launch, opening a file, pdf open, tab switch, source to preview. Each one as a duration, so "pdf opening is very slow, I think it does something for the file before opening it" gets a number instead of a suspicion.*
- [x] it must not become the slowness itself — *re-measured now that nothing is refused, which is when it would have started to matter: a line costs under 0.05 ms whatever the dial says, and a verbose measurement — really taken now, rather than skipped — under 0.08 ms. Nothing is formatted when it is written, `performance.now()` only, writes batched off the path being timed, and the weighing that keeps the ring inside its budget reads lengths rather than building text.*

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
