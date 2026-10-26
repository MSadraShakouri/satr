# The plan

The author's list, as it stands after 0.15.1, plus the findings he asked be
added from this side (marked *(found here)*) — do not invent any others. Web
first, then APK. Lint and GitHub stay deferred. Italic notes are the state of
play, not new work.

Closed cases do not live here. An item whose work is finished, and whose
subject has nothing open left beside it, is removed; what shipped is written up
release by release in ROADMAP.md. A ticked item stays only while its tick is
provisional — a fix still waiting on the phone, or a bug believed fixed and
being watched for its return.

## typing and the keyboard

- [ ] some concept called phantom spaces or something, where a space exists but isn't inserted until a keystroke, apparently keyboard level, but my app fights with it. Where when there's no space between letters and stuff like closed parentheses or quotes or etc, it doesn't insert a space on autocorrect but inserts at the next keystroke, cases like a) or a" and etc (Obsidian never has done this but it works normally and my app is broken, very weird, specifically with parentheses this issue exists, needs research in Obsidian to see why it happens, and possible testing) (important for typing UX) — *not started. The editor already sends the keyboard exactly Obsidian's own attributes (spellcheck on, autocorrect on, autocapitalize on) and no longer second-guesses a typed space, so whatever is left is somewhere else and has never been traced.*
- [ ] Gboard has backspace dragging which deletes words, it spills into the file name if it's at the start, doesn't delete, but it's a bug and doesn't delete the rest, strange but really — *still happening, and nothing has been done about it yet. It needs the device: the swipe is the keyboard's own gesture and arrives as a run of deletions with no key event, so the next step is to watch what the note receives at position 0 and refuse anything that would walk out of it.*
- [ ] putting caret somewhere when * * icons aren't visible makes it before the * icon rather than after it, not sure about it really

## source mode and the reading view

- [ ] in preview mode, tapping anywhere of a header make it collapse (idea, might be a bad one, but the current hitbox is still a bit small) (bad idea, forgo it, I'm not doing it but we might need a redesign like how Obsidian does it, at the side not in front of it)
- [ ] would be great if in source mode there was a background process that converted the math and tables and stuff (didn't display, just prepare) so the edit to preview mode would switch faster, doesn't need a full page rebuild probably, should definitely be a background process (it got faster in the batches but I think this would make it instantaneous)
- [x] html in preview would be epic, at minimum in export — *done: HTML a note brings is rendered in the reading view and in the export, with the styling that came with it — a `<style>` block or a `style` attribute — rewritten to reach that note and stop there (src/noteStyles.ts). Inline SVG too. Scripts, frames and `on*` attributes stay out; a note that wants to run code says `live` on a fence and gets a sealed frame (src/liveBlocks.ts).*

## math

- [ ] a formula that is too wide inside a single `\frac` or `\sqrt` still runs off the screen — *(found here)* after 0.14.0 this is what is left: five of your 819 formulas, and nineteen of Wikipedia's 4 477 that are not aligned environments. There is no break point **inside** a fraction or a root — cutting one in half would change what it says — so the piece is handed to the browser whole and paints past the column. The two honest answers are to let such a formula pan sideways on its own, the way `\begin{align}` and the matrices already do, or to scale it down until it fits. Both change how a formula looks, so neither is mine to pick.

## search

- [ ] search in normal might need thought, the sidebar search is usually better and normal has very little use cases

## sidebar, tabs and files

- [ ] new note creation, currently creates at scope base which is undesirable, would really like an option for it but needs thought, right now I have an alternative way which is holding the folder and pressing new note but that's not enjoyable for me
- [x] tab number digits aren't vertically centered, in two digits it's touching and in single digits it's not centered, maybe it needs to be smaller though (needs a lot of work) — *done: the digits are trimmed to their own box (`text-box-trim: trim-both`, cap height to baseline) and set in tabular figures, so one digit and two sit in the same place, centred, at 0.55 of the icon's size.*

## images

- [ ] image adding and image editing (mostly crop)
- [ ] image compression when adding, something like squoosh open source project if it isn't huge, it claims to use browser codecs which is exactly what we need
- [ ] image filters like CamScanner, optional, have an interactive way, smart guessing, monochrome options and such
- [ ] maybe add something for image sizes like the table RTL LTR settings which it would add a comment to choose the size. Should size be relative to height? What should the basis even be? (`|300` and `|300x200` already work, as Obsidian's — this is about a nicer way to say it)
- [x] image sizes in print, huge right now — *fixed and tested on the web; a real check on the phone still waits on being able to add an image.*

## PDF, and other files beside the note

- [ ] pdf compression with something like ghostscript, the method not the tool, tested normal file and 108kb became 98kb, but in files with images it compresses images, if we do something like squoosh we probably won't need to do this
- [ ] possibly open PDFs too, a great idea would be to have something open dual panes manually so one could both read a PDF or any other file and write it down in the text bar, maybe something at the top, would really help me personally, but would not load the entire pdf at once to keep the app light. Overlay over text area to not touch it would probably be an optimal solution
- [ ] opened pdf or other files have the option to crop a part of it and insert that into notes

## direction

- [x] text runs LTR RTL clinging needs thought, in lines with Persian digits RTL for example it's very visible, before and after the digit are both on the left side of it — *done: a run of digits is an isolate of its own (`numberIsolates`, src/caretMotion.ts). Measured in both views on `قیمت ۱۲۳۴ تومان`, `تاریخ ۱۴۰۲/۰۳/۰۵ است`, `قیمت 1234 تومان`, `نسخه 2.0 منتشر شد` and `Satr 2.0 منتشر شد`: in every one, what comes before the number stands on one side of it and what comes after on the other. If you have a line that still clings, paste it and this reopens.*

## launch and scrolling

- [ ] some times after being gone, it doesn't open a new tab, I don't know why (happens rarely, it has been a while since it last happened) (happened again, sometimes it stays even after 15 min unless I'm hallucinating)
- [ ] also sometimes I think it happens under my set 15 mins, not too sure — *both halves have one cause, and it is in the code rather than in your memory of it. The away clock is a single mark written the moment the app is told it is going to the background (`satr:awayAt`), and the gap is measured from that mark on the way back. Nothing else keeps time. So a background Android never delivered — the WebView frozen, the app killed, a lock that fired nothing — leaves **no mark**, and the return cannot be late however long it was: that is "it stays even after 15 min". And a mark is only cleared when a tab is actually opened, so a **stale** one from an earlier trip away can outlive a few minutes of real use and make the next return look older than it was: that is "it happens under my set 15 mins". The fix is to stop trusting one event: write the time every so often while the app is being used, and measure the gap from the last time it was **seen alive** rather than from the last time it was told to leave. A missed pause then costs nothing.* (claimed fix, waiting for it to happen again)
- [x] empty tab remove the demo button — *done: the new-tab page carries no demo row. The tour opens by itself on a fresh browser's first run and is never offered again (src/main.ts).*

## seen once, waiting for it to happen again

Bugs I hit once and have not been able to bring back. Some may already be
fixed by something else; none can be diagnosed until they show up again.

- [ ] caret position becomes unpredictable with `### ` hidden and jumps a bit (important, learn from obsidian) — *could not be reproduced on a one-row heading: the caret lands on the character tapped. What **is** reproducible on a heading that **wraps**: the tap is right (±1 character) but revealing `### ` re-wraps the line under the finger, so a tap near the end of a row ends up one row lower and about 235px to the left. If that is what it was, the fix is a decision — stop revealing the marker on a heading that has text (Obsidian's own exception is a line that is only `###`), or reserve its width so nothing reflows.*
- [ ] a quoted Persian list once drew **random digits, with some numbers repeated** — *(your report, not reproducible on demand: "was a bug I can't reproduce myself right now, the digits were random and some numbers were repeated")* *the note that did it — `> ۱.` to `> ۹.` with a blank quoted line in the middle — renders correctly here in both views, before and after this round's work, at every font size tried. Two things that were wrong in that neighbourhood have since been fixed and either could have been it: the two halves were numbered by two different rules depending on the script, and a loose list was drawn with no air at all. A repeated number specifically would mean two items reading the same source line — a `data-line` that slipped — so if it comes back, the thing to catch is whether the **source** is right while only the page is wrong.*
- [x] scroll up issue happened again once, happens less but happened once — *believed fixed, still worth watching.*
- [x] source to preview switch once stayed at the bottom, might be a bug, I'm not sure (happened multiple times, maybe it's related to closing app or something) — *believed fixed by 0.13's reading-place work, still worth watching. **And now explained**: the reading view was short at the moment of the landing — a page a third of the note's length — and a place below its foot was clamped there. Fixed in 0.15.1, with the note measured before the place is worked out from it.*

## later

- [ ] text direction incredibly unpredictable with ←→ buttons, needs thought, issue that some lines ← is back while in others it's forward, and can lead to loops, I don't know what to do. Could make lines between math LTR too, would help with predictability — *measured, and it is two questions wearing one sentence. **Inside a line it was ours, and it is fixed** (0.15.1+): the arrows follow what is drawn, so a press is one drawn position and never 8px the wrong way or a 42px jump across a formula, and a slot two positions share means one of them. **Between lines it is not ours.** The same note was walked with ← in Satr, in a plain `<textarea>` with `unicode-bidi: plaintext`, and in a contenteditable with `dir` per line — the same browser, the same keypresses — and all three give the identical sequence, loop included: `1:1 … 1:9 2:0 1:9 2:0 1:9 2:0`. The loop is the honest answer to the keys, not a fault: ← carries you off the end of a Persian line onto the English line below, and on an English line ← means backward, so it walks straight back. Obsidian does the same — its `app.js` carries CodeMirror's own `cursorCharLeft` / `cursorCharRight` / `moveByChar` and no `rtlMoveVisually` — and its forum says so in your words: "for arrow keys you must go to the beginning of the line & continue pressing left arrow… in summary they are vice versa too". Markor is a plain Android `EditText` and does whatever the platform does. Nor is there a model that would save it: macOS, Firefox and Safari move the caret visually, Windows, Android, Word and Google Docs move it logically, Firefox ships a three-way preference because neither answer satisfied everyone, and **both models decide which key means forward from the line's own direction** — so both flip it when the direction flips. The keys that do cross a direction change cleanly, measured here: ↓ and ↑ keep the goal column and are exactly symmetric (`1:5@761` → `2:16@211` → `3:5@759`, and back), and Home/End are logical in both scripts. **The second half of the item — making the lines between math LTR — was built and withdrawn**: it is in the history as a measurement, not in the app. What shipped instead is that a formula and a code span are one isolated thing, standing on the same side of a Persian line in the editor as in the reading view and the PDF.*
- [ ] normal toolbar hamburger menu icon open it as a growing pop-up like chromium rather than showing up a menu (I'm not sure about this, should I do it?)
- [ ] tablet support later — *the groundwork is in: no dual pane in landscape, and on a wide screen the text no longer clings to the edges.*
- [ ] Unix timestamps picker maybe make it floating, fixes many of the issues, don't know if the benefits outweigh the losts
- [ ] possible lint/fixer in the app (criteria below)
- [ ] later add GitHub connection like my markdown editor site, I don't mean sync, I mean read write access in a scope method way to do so (my project implemented it nicely but the UI of that is bad compared to Satr, and it's desktop first rather than mobile app)
- [ ] settings into parts, a locale part in it too because right now a lot of the settings are simply locales
- [ ] have option to sort toolbar stuff
- [ ] maybe be able to have a quick note or something, needs thought, I think Obsidian has a daily thing perhaps

## decided against

- [ ] opening an already open tab from an external app opens the tab again, ideal to open the already open one — *forgone: the hand-over carries a token a file manager is free to change, so there is no reliable way back to the tab that already has the file. What it does instead, since 0.13: the tab is named after the file rather than "satr-open", it says it came from another app, and "Show in files" works on it.*
- [x] numbers should be RTL, should they not? — *no. Other things needed changing instead; those are above.*

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
