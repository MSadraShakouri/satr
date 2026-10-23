# The plan

Remaining work for this PR, in the order of the list below. Web first, then
APK. Lint and GitHub stay deferred. Do not invent extra items.

## main

- [ ] some concept called phantom spaces or something, where a space exists but isn't inserted until a keystroke, apparently keyboard level, but my app fights with it. Where when there's no space between letters and stuff like closed parentheses or quotes or etc, it doesn't insert a space on autocorrect but inserts at the next keystroke, cases like a) or a" and etc (Obsidian never has done this but it works normally and my app is broken, very weird, specifically with parentheses this issue exists, needs research in Obsidian to see why it happens, and possible testing) (needs doing) (important for typing UX)
- [x] no dual pane in horizontal, can be done right now, but in big screens text shouldn't cling to the sides of the screen
- [ ] image adding and image editing (mostly crop)
- [ ] image compression when adding, something like squoosh open source project if it isn't huge, it claims to use browser codecs which is exactly what we need
- [ ] image filters like CamScanner, optional, have an interactive way, smart guessing, monochrome options and such
- [ ] maybe add something for image sizes like the table RTL LTR settings which it would add a comment to choose the size. Should size be relative to height? What should the basis even be? (Something like this exists but I don't know how this works)
- [ ] tab number digits aren't vertically centered (still yet not) (now a bit down) (needs a lot of work)
- [x] the /folder X files, Y folders doesn't even show, maybe remove it or take it somewhere else, even the folder name truncates, maybe remove it or wrap it? If wrapping, the file and folder count should be something separate and on another line
- [x] at the top of the right sidebar, show word and char count possibly below the file name
- [ ] switching between single file and all files in right sidebar moves some elements down, undesired and needs thought
- [ ] subfolder option enabled in space mode should show the name of the folder, probably
- [ ] caret position becomes unpredictable with `### ` hidden and jumps a bit (important, learn from obsidian)
- [ ] pdf compression with something like ghostscript, the method not the tool, tested normal file and 108kb became 98kb, but in files with images it compresses images, if we do something like squoosh we probably won't need to do this
- [ ] in preview mode, tapping anywhere of a header make it collapse (idea, might be a bad one, but the current hitbox is still a bit small)
- [ ] possibly open PDFs too, a great idea would be to have something open dual panes manually so one could both read a PDF or any other file and write it down in the text bar, maybe something at the top, would really help me personally, but would not load the entire pdf at once to keep the app light. Overlay over text area to not touch it would probably be an optimal solution
- [ ] opened pdf or other files have the option to crop a part of it and insert that into notes
- [ ] new note creation, currently creates at scope base which is undesirable, would really like an option for it but needs thought, right now I have an alternative way which is holding the folder and pressing new note but that's not enjoyable for me
- [ ] Gboard has backspace dragging which deletes words, it spills into the file name if it's at the start, doesn't delete, but it's a bug and doesn't delete the rest, strange but really
- [x] search doesn't show the current result (like 5/8) highlighted or anything, would be good if that happened
- [x] in-file search highlight is weird, it's too down on the page, it works but the position of it is bad, needs thought (should be 1/3 top of screen like the source to preview switch)
- [ ] search in normal mode isn't 1/3, I think it counts the search bar too because closing and opening it brings the search bar up and down which is undesired
- [ ] search in normal might need thought, the sidebar search is usually better and normal has very little use cases
- [ ] search in normal mode shouldn't select the text by default
- [ ] some times after being gone, it doesn't open a new tab, I don't know why (needs testing, I don't know when this happens) (happens rarely, I don't know if it's fixed or not)
- [x] the app splash screen launch, I'm not sure it works properly, might need further testing, I think it stays for too long
- [x] app splash screen shows the secondary icon a flash but it's a lot faster (needs testing on APK, claimed fix)
- [ ] nested lists should be easier to make, maybe not > < buttons but in source mode they should align whether two spaces or more, I'm not too sure about it
- [x] in Persian RTL, the numbered lists, the number is on the right of the number, numbers are still LTR for a reason, directly related to the weird long list of RTL rules we have
- [x] numbers should be RTL, should they not? (No, other things need changes)
- [x] scroll up issue happened again once, happens less but happened once (scroll up issue happens, much less often but at least once a day) (needs testing on APK)
- [x] I think I'm making the RTL LTR rules too complex, they should be much simpler, needs thought, I need to check was Obsidian does for it, or any other oss app, or literally any text field (did I do this between 11.3 and 12.0?)
- [x] the right and left of tables in RTL mode should mirror the left one, sources use ---: to mark right but in RTL that becomes the opposite and is unintuitive, that one aspect should follow LTR while keeping everything else (claimed fix, I don't recall when it happened) (I'm not sure if it's correct, maybe the source mode is weird in displaying, not an issue with display/print)
- [ ] opening URLs should have a warning I believe, and ask to open app or site and have a copy option, be nice
- [ ] html in preview would be epic, at minimum in export
- [ ] code syntax highlighting like obsidian
- [ ] math syntax checking while typing would be great, also colors and highlighting, learn from obsidian
- [x] app launch is slow on big files even after "away time", I think maybe the order of checking is bad
- [ ] would be great if in source mode there was a background process that converted the math and tables and stuff (didn't display, just prepare) so the edit to preview mode would switch faster, doesn't need a full page rebuild probably, should definitely be a background process (it got faster in the batches but I think this would make it instantaneous)
- [ ] tab numbers thing is still broken, in two digits it's touching and in single digits it's not centered, maybe it needs to be smaller though
- [ ] math split lines needs a bit thought, it's great overall but in some places it's not great
- [ ] maybe remove the spaces thing of math, I usually use \text{} and I believe that handles it, needs feedback
- [ ] the folder subsearch icon is a bit too right on the right sidebar, relative to other stuff I mean, maybe it should be a bit left, like the opposite end of the search bar against to the "Search" title, needs good execution
- [ ] text runs LTR RTL clinging needs thought, in lines with Persian digits RTL for example it's very visible, before and after the digit are both on the left side of it
- [x] source to preview switch once stayed at the bottom, might be a bug, I'm not sure, needs testing it (happened multiple times, maybe it's related to closing app or something, it happens for a few times and then gets fixed without issues after it)
- [ ] tapping on source to preview button makes it blue (normal browser selection blue) which is undesired, everything like this should be disabled
- [ ] source to preview isn't 1:1 of the same space on screen, would be great if the source mode could mimic the display of preview so the switch wouldn't be noticable in normal text and lists and stuff

## claimed fixes, needs testing

- [x] image sizes in print, huge right now (claims to be fixed, needs testing either on APK or on site after I can add images) (needs thought, and I can't even test it well because I can't add images, I need stuff for image sizes, possibly like table comments)
- [ ] opening an already open tab from an external app opens the tab again, ideal to open the already open one (claims fix, needs testing on APK) (not fixed, no need to add it) (possibly impossible to fix, because we're calling satr-open) (many stuff attempted, just forgo it, I don't need it, maybe revert to say it's an externally opened file)
- [x] obsidian has a settings where in the left sidebar it always shows the file you're in (always focuses on that, regardless of how deep the user is in a folder, always shows the file rather than keeping a random dir, obsidian has the option at the bottom near new file and stuff)  (claims to be done, needs testing on APK) (doesn't work) (unintuitive, can't know if it's on or not, should mimic Obsidian, doesn't open closed folders to show) (claimed fix, needs testing on APK)
- [x] splash screen showed twice, claimed, needs testing on APK

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
