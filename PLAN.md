# The plan

Remaining work for this PR, in the order of the list below. Web first, then
APK. Lint and GitHub stay deferred. Do not invent extra items.

## main

- [ ] some concept called phantom spaces or something, where a space exists but isn't inserted until a keystroke, apparently keyboard level, but my app fights with it. Where when there's no space between letters and stuff like closed parentheses or quotes or etc, it doesn't insert a space on autocorrect but inserts at the next keystroke, cases like a) or a" and etc

- [ ] no dual pane in horizontal, can be done right now, but in big screens text shouldn't cling to the sides of the screen

- [ ] image adding and image editing (mostly crop)

- [ ] image compression when adding, something like squoosh open source project if it isn't huge, it claims to use browser codecs which is exactly what we need

- [ ] image filters like CamScanner, optional, have an interactive way, smart guessing, monochrome options and such

- [ ] maybe add something for image sizes like the table RTL LTR settings which it would add a comment to choose the size. Should size be relative to height? What should the basis even be?

- [ ] tab number digits aren't vertically centered (still yet not) (now a bit down) (the cap-height trim is in this build — the digit has an element of its own inside the square, trimmed to its cap height and the alphabetic baseline, so the box that is centred is the box the digits are drawn in; 0.11.0 is the first APK that carries it, and the measured centre is the icon's own)

- [x] the /folder X files, Y folders doesn't even show, maybe remove it or take it somewhere else, even the folder name truncates, maybe remove it or wrap it? If wrapping, the file and folder count should be something separate and on another line (done in this patch, as asked: the counts are on a line of their own under the path, and a long name or path wraps to two lines instead of pushing them out; a folder browsed in the walker counts what is in it, the space counts everything under it; the fix is in this build)

- [x] at the top of the right sidebar, show word and char count possibly below the file name (done in this patch: "12 words, 340 characters" under the note's name, kept in step with the note; the all-notes search, which names the space and not a note, says nothing; the fix is in this build)

- [ ] outline and file name in one line if fits

- [x] stuff like `![Screenshot_20261014-082559_MiXplorer](_res/Screenshot_20261014-082559_MiXplorer.png)` in RTL, the end of it isn't at the end (like numbers which had this issue) (done in this patch: a link or picture whose label is not Persian is isolated as one LTR run — brackets, address and all — the same way the number runs are, so its end is at the end; a Persian label keeps the line's direction and only its address is isolated)

- [ ] caret position becomes unpredictable with `### ` hidden and jumps a bit

- [ ] pdf compression with something like ghostscript, the method not the tool, tested normal file and 108kb became 98kb, but in files with images it compresses images, if we do something like squoosh we probably won't need to do this

- [ ] in preview mode, tapping anywhere of a header make it collapse (idea, might be a bad one, but the current hitbox is still a bit small)

- [ ] possibly open PDFs too, a great idea would be to have something open dual panes manually so one could both read a PDF or any other file and write it down in the text bar, maybe something at the top, would really help me personally, but would not load the entire pdf at once to keep the app light. Overlay over text area to not touch it would probably be an optimal solution

- [ ] new note creation, currently creates at scope base which is undesirable, would really like an option for it but needs thought, right now I have an alternative way which is holding the folder and pressing new note but that's not enjoyable for me

- [ ] Gboard has backspace dragging which deletes words, it spills into the file name if it's at the start, doesn't delete, but it's a bug and doesn't delete the rest, strange but really

- [x] title collapse and opens has an issue, if at the end of a page and opening the title, it brings you to the end of the page (done in this patch: a fold or an unfold keeps the reader's place — at the foot of a note the height a fold takes is lent back to the page for as long as the reader stands there, and a scroll snapshot stops CodeMirror pinning the view to the document's foot when a section opens; the fix is in this build)

- [x] display math (and maybe code, though I haven't tested that) in new lines when empty, the caret sticks to the right instead of left, when there's $$ $$ with one line between, the empty line caret sticks to right (done in this patch: an empty line whose nearest lines above and below are both not-prose — math, code, indented code — takes their direction and not the line above it, so its caret sits at the left; an empty line against prose still follows the prose)

- [ ] search doesn't show the current result (like 5/8) highlighted or anything, would be good if that happened

- [ ] search in normal might need thought, the sidebar search is usually better and normal has very little use cases

## claimed fixes, needs testing

The fix is in the tree and the phone is what confirms it. Nothing leaves this section until the writer has seen it on the device.

- [ ] when scrolling up, sometimes (less than half, usually on app open and changing files) the android status bar flashes but if you go down a bit, it gets fixed when going up again. Very strange (claim to be fixed, needs testing on APK) (the fix is in this round: the bars move once per beat and only for a real move, and the Android side asks the window before asking for a bar again — tests/navAutoHide.spec.ts)

- [ ] the ✓ button for file name to first line is a bit jumpy, would be great if it were possible for it to work normally (might possibly be a lag with file creation, enter on existing files has no delay, web is smooth but APK lags) (one time I didn't lag, I don't know the reason of it) (claim to be fixed, needs APK testing) (the fix is in this round: the rename is one awaited call, the note is never held read-only, and the save is chained to the move)

- [ ] app launch is still weird, shows the main screen twice, once loading the app itself and once the app loading, one screen twice (claim to be fixed, needs testing) (the fix is in this round: the system splash is held until the web app has booted, so the cover's removal is not a second animation)

- [ ] image sizes in print, huge right now (claims to be fixed, needs testing either on APK or on site after I can add images) (the fix is in the tree: an unsized picture is capped at 9 cm tall in print, a size written in the note still wins, and Settings → PDF custom CSS has the last word)

- [ ] bad handling of opening images, it first tries to open as text then the app gets very slow (claims to be fixed, needs testing on APK) (the fix is in this round: a picture is never decoded as text — the plugin returns it as binary with its data URL, and the page never reads its bytes)

- [ ] opening an image has a very weird bug and never lets you change the page (I think forever stuck), image opening needs proper handling (claims to be fixed, needs testing on APK) (the fix is in this round: a picture tab holds no text, opens read-only in the reading view, and is never written over)

- [ ] opening an already open tab from an external app opens the tab again, ideal to open the already open one (claims fix, needs testing on APK) (the fix is in this round: a hand-over is matched by the plugin's source id first, then by the file's name, size and modification time, and a share by the text itself — the road is native-only, so the APK is the confirmation)

- [ ] obsidian has a setting where in the left sidebar it always shows the file you're in (regardless of folder depth; the option is at the bottom near new file) (diagnosed: a fresh APK has no saved spaces, so its default scope is "All files"; the old implementation deliberately left that walker's folder unchanged, and the existing follow test only covered a space) (fixed: with the switch on, the All files walker now moves to the current note's parent folder; with it off, the chosen folder is preserved. Browser tests cover a fresh no-space scope, deep paths, tab changes and on/off. APK verification is still pending)

## deferred for later

- [ ] text direction incredibly unpredictable with ←→ buttons, needs thought, issue that some lines ← is back while in others it's forward, and can lead to loops, I don't know what to do. Could make lines between math LTR too, would help with predictability

- [ ] normal toolbar hamburger menu icon open it as a growing pop-up like chromium rather than showing up a menu (I'm not sure about this, should I do it?)

- [ ] tablet support later

- [ ] Unix timestamps picker maybe make it floating, fixes many of the issues, don't know if the benefits outweigh the losts

- [ ] possible lint/fixer in the app (deferred for later)

- [ ] later add GitHub connection like my markdown editor site, I don't mean sync, I mean read write access in a scope method way to do so (my project implemented it nicely but the UI of that is bad compared to Satr, and it's desktop first rather than mobile app) (deferred for later)

## note lint criteria

for the in-app lint/fixer above, measured on term_three with the app's own scanner (0 katex errors today, everything else is real):

1. a display `$$` line that is a lazy continuation of a list item — it renders inside the bullet, indented and centered within the `li`, instead of as a page-centered display block. 11 sites now: Probability Theory 03:83,86,89,92,95,121,124,127,130; Mathematics 2 03:32; Linear Algebra 01:18. fix = one blank line before the `$$`

2. `<div dir=ltr>` wrappers are now redundant (direction is computed, math is already forced ltr) — 20 pairs in Mathematics 2 01, all paired, safe to strip. report as "redundant", not "wrong"

3. trailing `:` in a heading, visible in the outline and in search — Accounting 03:5 `## فصل دوم:` , Accounting 03:66 `##### اهداف:`

4. trailing space in heading text, so the outline reads `معرفی`  — Accounting 01:14, Linear Algebra 02:21

5. list indent must be 0/2/4: a 1-space indent reads as a sibling rather than a child, so a bullet that looks like a parent renders as a peer — Probability Theory 02:246

6. empty list item renders as a blank bullet — Probability Theory 01:159

7. run every formula through `renderMath` and fail on any `katex-error` — katex is `throwOnError: false`, so a typo is a silent red formula in the reading view and in the PDF, and there is no other way to notice

8. assert the latex-style converter never fires on a real line break: `\\[6pt]` in Linear Algebra 03:38 is a `\\[6pt]` skip, not a `\[…\]` pair. today correct by two independent guards (the preceding backslash, and the enclosing `$$` span) — worth pinning so neither guard is ever weakened

not criteria, deliberately: callouts/dataview/graph/tags (not supported, would render literally), table separator styles and headerless tables (`ensureTableSeparators` inserts the separator, then the empty header row is removed), persian `۱.` ordered lists (transliterated, then re-rendered as persian), bare emails (gfm autolinks them), math digit style (a settings choice), and unifying `$$ x $$` against bare `$$` (both are `display: true`, they render the same).
