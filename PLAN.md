# The plan

The author's list, as it stands after 0.13.0. Web first, then APK. Lint and
GitHub stay deferred. Do not invent extra items. A ticked item is kept only
while something open sits beside it; finished and isolated items live in
ROADMAP.md. Italic notes are the state of play, not new work.

## typing and the keyboard

- [ ] some concept called phantom spaces or something, where a space exists but isn't inserted until a keystroke, apparently keyboard level, but my app fights with it. Where when there's no space between letters and stuff like closed parentheses or quotes or etc, it doesn't insert a space on autocorrect but inserts at the next keystroke, cases like a) or a" and etc (Obsidian never has done this but it works normally and my app is broken, very weird, specifically with parentheses this issue exists, needs research in Obsidian to see why it happens, and possible testing) (important for typing UX) — *not started. The editor already sends the keyboard exactly Obsidian's own attributes (spellcheck on, autocorrect on, autocapitalize on) and no longer second-guesses a typed space, so whatever is left is somewhere else and has never been traced.*
- [ ] Gboard has backspace dragging which deletes words, it spills into the file name if it's at the start, doesn't delete, but it's a bug and doesn't delete the rest, strange but really — *still happening, and nothing has been done about it yet. It needs the device: the swipe is the keyboard's own gesture and arrives as a run of deletions with no key event, so the next step is to watch what the note receives at position 0 and refuse anything that would walk out of it.*

## source mode and the reading view

- [x] source to preview isn't 1:1 of the same space on screen, would be great if the source mode could mimic the display of preview so the switch wouldn't be noticable in normal text and lists and stuff — *0.13: prose, bullets, numbered lists, to-dos, quotes and every level of their nesting start at the same x in both views (the marker hangs in the strip the reading view reserves for it, a nested level steps by the same amount however it was typed, and a row now breaks at the same word in both). Not mimicked, and not planned: tables, math and mermaid (live preview deliberately leaves those as source), the guide line beside a nested list, and the vertical spacing between blocks.*
- [x] nested lists should be easier to make, maybe not > < buttons but in source mode they should align whether two spaces or more, I'm not too sure about it — *0.13: the aligning half is done — two spaces, four or a tab all draw one step, the same step the reading view uses. No > < buttons; say the word if you still want them.*
- [ ] in preview mode, tapping anywhere of a header make it collapse (idea, might be a bad one, but the current hitbox is still a bit small)
- [ ] would be great if in source mode there was a background process that converted the math and tables and stuff (didn't display, just prepare) so the edit to preview mode would switch faster, doesn't need a full page rebuild probably, should definitely be a background process (it got faster in the batches but I think this would make it instantaneous)
- [x] code syntax highlighting like obsidian — *source mode colours a fence now too: the editor fetches a CodeMirror language the first time a fence asks for it (143 of them, each its own file, none of them in the way of the first line of text) and paints it in the same `--code-*` colours the reading view gives the same tokens. Obsidian's own arrangement, two highlighters over one palette: Lezer in the editor, highlight.js still in the reading view and the PDF.*
- [ ] html in preview would be epic, at minimum in export

## math

- [x] math syntax checking while typing would be great, also colors and highlighting, learn from obsidian (maybe change the math things to be closer to Obsidian) — *both halves, on Obsidian's own map. The parts of a formula are told apart by `stexMath`, the face of the `stex` mode that works **inside** the dollars — the plain one only ever sees commands and braces, which is why the first attempt coloured so little next to Obsidian. Commands and the `_` `^` `&` that carry them take `--code-tag`, braces `--code-punctuation`, numbers `--code-value`, variables `--code-property`, `%` comments `--code-comment`, and the mode's own complaints `--text-error`: Obsidian's table, read out of its app.css, with the four palette names it has and we lacked added. And the half Obsidian does not do: a formula KaTeX cannot read turns the colour KaTeX will paint it in the reading view and in the PDF — colour, no squiggle, since a red underline reads as a spelling mistake. It waits for the writing to pause (0.7s) rather than following the caret, so a formula is judged when it is finished, not between two keystrokes.*
- [ ] math split lines needs a bit thought, it's great overall but in some places it's not great
- [ ] maybe remove the spaces thing of math, I usually use \text{} and I believe that handles it, needs feedback

## search

- [x] search doesn't show the current result (like 5/8) highlighted or anything, would be good if that happened
- [x] in-file search highlight is weird, it's too down on the page, it works but the position of it is bad (should be 1/3 top of screen like the source to preview switch)
- [x] search in normal mode isn't 1/3, I think it counts the search bar too because closing and opening it brings the search bar up and down which is undesired
- [x] search in normal mode shouldn't select the text by default
- [ ] search in normal might need thought, the sidebar search is usually better and normal has very little use cases

## sidebar, tabs and files

- [x] obsidian has a settings where in the left sidebar it always shows the file you're in (always focuses on that, regardless of how deep the user is in a folder, always shows the file rather than keeping a random dir, obsidian has the option at the bottom near new file and stuff)
- [x] switching between single file and all files in right sidebar moves some elements down, undesired and needs thought
- [x] subfolder option enabled in space mode should show the name of the folder, probably — *it showed the name of the **space**, not the folder in it. With subfolders off a space searches the open note's own folder (and in All files the walker searches the folder it stands in), while the drawer header named the space either way, so one folder's results looked like the whole space's. The header now names the folder being read, and goes back to the space's name when the whole space is what is being read.*
- [ ] new note creation, currently creates at scope base which is undesirable, would really like an option for it but needs thought, right now I have an alternative way which is holding the folder and pressing new note but that's not enjoyable for me
- [ ] tab number digits aren't vertically centered, in two digits it's touching and in single digits it's not centered, maybe it needs to be smaller though (needs a lot of work)

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

- [x] I think I'm making the RTL LTR rules too complex, they should be much simpler, needs thought, I need to check what Obsidian does for it, or any other oss app, or literally any text field
- [x] in Persian RTL, the numbered lists, the number is on the right of the number, numbers are still LTR for a reason, directly related to the weird long list of RTL rules we have
- [x] the right and left of tables in RTL mode should mirror the left one, sources use ---: to mark right but in RTL that becomes the opposite and is unintuitive, that one aspect should follow LTR while keeping everything else — *done on screen and on paper. The doubt left was source mode, and that is a different thing: live preview shows a table as source text, it doesn't lay it out.*
- [ ] text runs LTR RTL clinging needs thought, in lines with Persian digits RTL for example it's very visible, before and after the digit are both on the left side of it

## launch and scrolling

- [x] app launch is slow on big files even after "away time", I think maybe the order of checking is bad
- [ ] scroll up sometimes is weird, it still bounces, going down a tiny bit fixes it but it bounces when going up (this thing changed so many times but never fully got resolved) — *found, and it was never the page: it is the bars. Reproduced by measurement — a flick up shows them, then a scroll correction of about 130px takes them away again. The editor makes that correction when it re-measures line heights it had only estimated above the viewport, and it moves `scrollTop` precisely so that the text on screen does NOT move, which is why nothing visible ever jumped. Read off `scrollTop` alone it is indistinguishable from turning around. The bars are told from the reader's hand now (a finger on the glass, a wheel, a scrolling key); momentum and corrections cannot turn them around, and a real swipe down still hides them at once. Left unticked until it has had a week on the phone. **Still reported after that**, and now with the shape of it: slowly, upwards, just after the app opens, and after switching tabs — on the website too. Two answers: a slow thumb is never straight, so turning the bars around takes 10px of finger travel the other way now, not the last two pixels; and `?bars=1` on the website puts the last ten decisions on the screen (what was asked, how far the note moved, which way the hand was going, what was refused), because the phone cannot be inspected from here. If the trace shows nothing while the bar still moves, the bar is not ours to move — Chrome's URL bar and Android's transient status bar both come and go on their own, and that is the next thing to rule out.*

## seen once, waiting for it to happen again

Bugs I hit once and have not been able to bring back. Some may already be
fixed by something else; none can be diagnosed until they show up again.

- [ ] caret position becomes unpredictable with `### ` hidden and jumps a bit (important, learn from obsidian) — *could not be reproduced on a one-row heading: the caret lands on the character tapped. What **is** reproducible on a heading that **wraps**: the tap is right (±1 character) but revealing `### ` re-wraps the line under the finger, so a tap near the end of a row ends up one row lower and about 235px to the left. If that is what it was, the fix is a decision — stop revealing the marker on a heading that has text (Obsidian's own exception is a line that is only `###`), or reserve its width so nothing reflows.*
- [ ] some times after being gone, it doesn't open a new tab, I don't know why (happens rarely, it has been a while since it last happened)
- [x] scroll up issue happened again once, happens less but happened once — *believed fixed, still worth watching.*
- [x] source to preview switch once stayed at the bottom, might be a bug, I'm not sure (happened multiple times, maybe it's related to closing app or something) — *believed fixed by 0.13's reading-place work, still worth watching.*

## later

- [ ] text direction incredibly unpredictable with ←→ buttons, needs thought, issue that some lines ← is back while in others it's forward, and can lead to loops, I don't know what to do. Could make lines between math LTR too, would help with predictability
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
