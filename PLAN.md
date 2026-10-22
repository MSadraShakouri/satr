# The plan

Remaining work for this PR, in the order of the list below. Web first, then
APK. Lint and GitHub stay deferred. Do not invent extra items.

## main

- [ ] some concept called phantom spaces or something, where a space exists but isn't inserted until a keystroke, apparently keyboard level, but my app fights with it. Where when there's no space between letters and stuff like closed parentheses or quotes or etc, it doesn't insert a space on autocorrect but inserts at the next keystroke, cases like a) or a" and etc (Obsidian never has done this but it works normally and my app is broken, very weird, specifically with parentheses this issue exists, needs research in Obsidian to see why it happens, and possible testing) (needs doing)

- [x] no dual pane in horizontal, can be done right now, but in big screens text shouldn't cling to the sides of the screen

- [ ] image adding and image editing (mostly crop)

- [ ] image compression when adding, something like squoosh open source project if it isn't huge, it claims to use browser codecs which is exactly what we need

- [ ] image filters like CamScanner, optional, have an interactive way, smart guessing, monochrome options and such

- [ ] maybe add something for image sizes like the table RTL LTR settings which it would add a comment to choose the size. Should size be relative to height? What should the basis even be? (Something like this exists but I don't know how this works)

- [ ] tab number digits aren't vertically centered (still yet not) (now a bit down) (needs a lot of work)

- [x] the /folder X files, Y folders doesn't even show, maybe remove it or take it somewhere else, even the folder name truncates, maybe remove it or wrap it? If wrapping, the file and folder count should be something separate and on another line

- [x] at the top of the right sidebar, show word and char count possibly below the file name

- [ ] outline and file name in one line if fits (no need, the subfolder thing got added and it's good)

- [ ] subfolder option enabled in space mode should show the name of the folder, probably

- [ ] caret position becomes unpredictable with `### ` hidden and jumps a bit

- [ ] pdf compression with something like ghostscript, the method not the tool, tested normal file and 108kb became 98kb, but in files with images it compresses images, if we do something like squoosh we probably won't need to do this

- [ ] in preview mode, tapping anywhere of a header make it collapse (idea, might be a bad one, but the current hitbox is still a bit small)

- [ ] possibly open PDFs too, a great idea would be to have something open dual panes manually so one could both read a PDF or any other file and write it down in the text bar, maybe something at the top, would really help me personally, but would not load the entire pdf at once to keep the app light. Overlay over text area to not touch it would probably be an optimal solution

- [ ] opened pdf or other files have the option to crop a part of it and insert that into notes

- [ ] new note creation, currently creates at scope base which is undesirable, would really like an option for it but needs thought, right now I have an alternative way which is holding the folder and pressing new note but that's not enjoyable for me

- [ ] Gboard has backspace dragging which deletes words, it spills into the file name if it's at the start, doesn't delete, but it's a bug and doesn't delete the rest, strange but really

- [x] search doesn't show the current result (like 5/8) highlighted or anything, would be good if that happened

- [x] in-file search highlight is weird, it's too down on the page, it works but the position of it is bad, needs thought (should be 1/3 top of screen like the source to preview switch) (done: a hit lands a third down now — 52% of the pane before, 33% after — in the find bar and from a result tapped in the drawer)

- [ ] search in normal might need thought, the sidebar search is usually better and normal has very little use cases

- [ ] some times after being gone, it doesn't open a new tab, I don't know why (needs testing, I don't know when this happens)

- [x] the app splash screen launch, I'm not sure it works properly, might need further testing, I think it stays for too long

- [ ] app splash screen shows the secondary icon a flash but it's a lot faster (the second icon is ours: Android's splash was dismissed on a fixed 150 ms timer while the HTML cover under it waited out its own 480 ms beat, so from ~150 ms to ~600 ms the phone was showing Satr's icon-192 at 96×96 instead — which is why it never happens in the browser, where there is no splash above the cover. Done in dev for 0.13.0: on the device the cover is lifted as soon as the note has painted and the splash is dismissed when the cover is actually gone, so there is one hand-over, not two. Android's own splash cannot be removed on 12+, only styled — needs a look on the device)

- [ ] nested lists don't work? (a phone has no Tab key and the toolbar has no indent button, so nesting can only be typed as spaces — 2 under a bullet, 3 under `۱. ` to reach its content column — and a 1-space indent reads as a sibling; needs thought, probably an indent/outdent pair in the toolbar)

- [x] in Persian RTL, the numbered lists, the number is on the right of the number, numbers are still LTR for a reason, directly related to the weird long list of RTL rules we have

- [x] numbers should be RTL, should they not? (No, other things need changes)

- [x] scroll up issue happened again once, happens less but happened once (scroll up issue happens, much less often but at least once a day) (needs testing on APK)

- [x] I think I'm making the RTL LTR rules too complex, they should be much simpler, needs thought, I need to check was Obsidian does for it, or any other oss app, or literally any text field (done between 11.3 and 12.0: the vote tally that decided a letterless line is gone — one expression per line — and the LTR isolate around a number run is only , . : / now, so a plain ۱۴۰۲ or ۵. is left to the browser as Obsidian leaves it)

- [ ] the right and left of tables in RTL mode should mirror the left one, sources use ---: to mark right but in RTL that becomes the opposite and is unintuitive, that one aspect should follow LTR while keeping everything else (claimed fix, I don't recall when it happened) (I'm not sure if it's correct, maybe the source mode is weird in displaying, not an issue with display/print) (source mode was not the culprit: measured character by character, the separator line paints exactly as typed in both directions, and a table is never rendered in the editor at all. The reading view and the print were physical — `---:` on the right — while the columns mirrored, which is the half that was wrong. Done in dev for 0.13.0: an RTL table mirrors its markers with its columns, so `---:` sets the column against the end of the row, the physical left, and a Persian table is the mirror image of the English one, on screen and on paper)

- [ ] opening URLs should have a warning I believe, and ask to open app or site and have a copy option, be nice

- [ ] html in preview would be epic, at minimum in export

- [ ] code syntax highlighting like obsidian

- [x] app launch is slow on big files even after "away time", I think maybe the order of checking is bad

- [ ] would be great if in source mode there was a background process that converted the math and tables and stuff (didn't display, just prepare) so the edit to preview mode would switch faster, doesn't need a full page rebuild probably, should definitely be a background process

- [ ] tab numbers thing is still broken, in two digits it's touching and in single digits it's not centered, maybe it needs to be smaller though

- [ ] math split needs a bit thought, it's great overall but in some places it's not great

- [ ] maybe remove the spaces thing of math, I usually use \text{} and I believe that handles it, needs feedback

- [ ] the folder subsearch icon is a bit too right on the right sidebar, relative to other stuff I mean, maybe it should be a bit left, like the opposite end of the search bar against to the "Search" title, needs good execution

- [ ] text runs LTR RTL clinging needs thought, in lines with Persian digits RTL for example it's very visible, before and after the digit are both on the left side of it

- [ ] source to preview switch once stayed at the bottom, might be a bug, I'm not sure, needs testing it

## claimed fixes, needs testing

- [ ] image sizes in print, huge right now (claims to be fixed, needs testing either on APK or on site after I can add images) (needs thought, and I can't even test it well because I can't add images, I need stuff for image sizes, possibly like table comments)

- [ ] opening an already open tab from an external app opens the tab again, ideal to open the already open one (claims fix, needs testing on APK) (not fixed, no need to add it) (possibly impossible to fix, because we're calling satr-open) (still not fixed on the device: the note keeps the satr-open:// path it arrived under, so All files search shows its name as satr-open, and Reveal current file is greyed out for it because an incoming file has no row in the tree — needs thought: resolve the handed-over file to its real path first) (done in dev for 0.13.0, in two parts: the result rows ask the app for the file's own name instead of shortening the token, so nothing reads “satr-open” any more; and a file the device can actually name — a file:// URI, or a document of com.android.externalstorage.documents, whose id gives /storage/emulated/0/… — is opened as an ordinary note, which brings the tree row, a working Reveal, normal saving and the tab it is already open in. Drive, Keep and shared text have no path to resolve and keep the satr-open one. The resolving is Java: needs testing on the APK)

- [x] obsidian has a settings where in the left sidebar it always shows the file you're in (always focuses on that, regardless of how deep the user is in a folder, always shows the file rather than keeping a random dir, obsidian has the option at the bottom near new file and stuff)  (claims to be done, needs testing on APK) (doesn't work) (unintuitive, can't know if it's on or not, should mimic Obsidian, doesn't open closed folders to show) (claimed fix, needs testing on APK)

## deferred for later

- [ ] text direction incredibly unpredictable with ←→ buttons, needs thought, issue that some lines ← is back while in others it's forward, and can lead to loops, I don't know what to do. Could make lines between math LTR too, would help with predictability

- [ ] normal toolbar hamburger menu icon open it as a growing pop-up like chromium rather than showing up a menu (I'm not sure about this, should I do it?)

- [ ] tablet support later

- [ ] Unix timestamps picker maybe make it floating, fixes many of the issues, don't know if the benefits outweigh the losts

- [ ] possible lint/fixer in the app (deferred for later)

- [ ] later add GitHub connection like my markdown editor site, I don't mean sync, I mean read write access in a scope method way to do so (my project implemented it nicely but the UI of that is bad compared to Satr, and it's desktop first rather than mobile app) (deferred for later)

- [ ] settings into parts, a locale part in it too because right now a lot of the settings are simply locales

- [ ] have option to sort toolbar stuff

- [ ] maybe be able to have a quick note or something, needs thought, I think Obsidian has a daily thing perhaps

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

not criteria, deliberately: callouts/dataview/graph/tags (not supported, would render literally), table separator styles and headerless tables (`ensureTableSeparators` inserts the separator, then the empty header row is removed), persian `۱.` ordered lists (transliterated, then re-rendered as persian), bare emails (gfm autolinks them), math digit style (a settings choice), and unifying `$$ x $$` against bare `$$` (both are `display: true`, they render the same).
