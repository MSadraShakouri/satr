# The plan

Remaining work for this PR, in the order of the list below. Web first, then
APK. Lint and GitHub stay deferred. Do not invent extra items.

## main

- [ ] opening an already open tab from an external app opens the tab again, ideal to open the already open one

- [ ] some concept called phantom spaces or something, where a space exists but isn't inserted until a keystroke, apparently keyboard level, but my app fights with it. Where when there's no space between letters and stuff like closed parentheses or quotes or etc, it doesn't insert a space on autocorrect but inserts at the next keystroke, cases like a) or a" and etc

- [ ] the ✓ button for file name to first line is a bit jumpy, would be great if it were possible for it to work normally (might possibly be a lag with file creation, enter on existing files has no delay, web is smooth but APK lags) (one time I didn't lag, I don't know the reason of it)

- [x] discord Unix style timestamps follow system language, they should follow the app language

- [x] discord Unix timestamps allow calendar and language selection (Persian Jalali) (either settings or a new system)

- [x] discord Unix timestamps allow choosing dates and entering and stuff with GUI

- [x] discord Unix timestamps, the block itself `in 12 hours` should be RTL or LTR forced, right now in a Persian text with a timestamp, the number if at the start of a block gets to the right of it, it shows like this: `hours ago 4` rather than `4 hours ago`

- [x] a way to set table directions manually (entire table, not the :--- cells)

- [x] tables seem to be LTR only in print, they should follow text and be able to set manually (table issues exist only in print)

- [ ] app launch new tab seems to have issues, sometimes it stays on the old page (claim to be fixed, needs testing on APK)

- [x] app launch new tab shows the old tab for a moment before showing the empty tab, just a flash but a bad UX

- [x] app launch is still weird, shows the main screen twice, once loading the app itself and once the app loading, one screen twice

- [x] maybe have the app opening screen a bit longer so it doesn't flash stuff (right now it shows a white screen quickly, while obsidian shows the logo for a bit longer) issues with app switching too when inactive for moments

- [x] scroll tables in preview

- [x] never break tables unless they don't fit in one page

- [ ] no dual pane in horizontal, can be done right now, but in big screens text shouldn't cling to the sides of the screen

- [x] dates caret becomes LTR if nothing in line

- [x] end of line caret should follow text dir, rather than the last letter itself

- [ ] image adding and image editing (mostly crop)

- [ ] image compression when adding, something like squoosh open source project if it isn't huge, it claims to use browser codecs which is exactly what we need

- [ ] image sizes in print, huge right now (claims to be fixed, needs testing either on APK or on site after I can add images)

- [x] the source to preview mode better alignment, perhaps just make the middle line of both centered, or do this with top 1/3 like outline headers and stuff

- [x] same bottom of view text edit that scrolls down, exist for top of view that doesn't show the text too high up

- [x] headers such as "loaded from file" and such not take full horizontal width, they should consider the two side pane and preview button when showing, would be really nice if it could be behind it, I'm not sure, and be a part of the source/preview screen, rather than independently floating around, what I mean is to move around with the sidebar and preview buttons when moving view

- [x] hold on tabs button show the options like new, reopen, close all, close others, close current etc

- [ ] tab number digits aren't vertically centered (still yet not)

- [x] math text follows system font, this is very undesired, needs thought, maybe force vazir, or choose another font for it

- [x] line selection has empty space between lines, the selection thing should maybe consider the height of the space between lines too, not sure if that's the correct approach

- [ ] bad handling of opening images, it first tries to open as text then the app gets very slow

- [ ] opening an image has a very weird bug and never lets you change the page (I think forever stuck), image opening needs proper handling

- [x] sometimes left sidebar doesn't move the main page, it moves at first but doesn't stay and goes back to place, bug

- [ ] the /folder X files, Y folders doesn't even show, maybe remove it or take it somewhere else, even the folder name truncates, maybe remove it or wrap it? If wrapping, the file and folder count should be something separate and on another line

- [ ] at the top of the right sidebar, show word and char count possibly below the file name

- [ ] stuff like `![Screenshot_20261014-082559_MiXplorer](_res/Screenshot_20261014-082559_MiXplorer.png)` in RTL, the end of it isn't at the end (like numbers which had this issue)

- [ ] caret position becomes unpredictable with `###`  hidden and jumps a bit

- [ ] pdf compression with something like ghostscript, the method not the tool, tested normal file and 108kb became 98kb, but in files with images it compresses images, if we do something like squoosh we probably won't need to do this

- [ ] in preview mode, tapping anywhere of a header make it collapse (idea, might be a bad one, but the current hitbox is still a bit small)

- [ ] possibly open PDFs too, a great idea would be to have something open dual panes manually so one could both read a PDF or any other file and write it down in the text bar, maybe something at the top, would really help me personally, but would not load the entire pdf at once to keep the app light

- [ ] obsidian has a settings where in the left sidebar it always shows the file you're in (always focuses on that, regardless of how deep the user is in a folder, always shows the file rather than keeping a random dir, obsidian has the option at the bottom near new file and stuff)

- [ ] new note creation, currently creates at scope base which is undesirable, would really like an option for it but needs thought, right now I have an alternative way which is holding the folder and pressing new note but that's not enjoyable for me

- [x] copying an already to-do item to an empty to-do line should remove one of the to-dos, it pastes literally right now

- [ ] Gboard has backspace dragging which deletes words, it spills into the file name if it's at the start, doesn't delete, but it's a bug and doesn't delete the rest, strange but really

- [ ] title collapse and opens has an issue, if at the end of a page and opening the title, it brings you to the end of the page

- [ ] display math (and maybe code, though I haven't tested that) in new lines when empty, the caret sticks to the right instead of left, when there's $$ $$ with one line between, the empty line caret sticks to right

## deferred for later

- [ ] text direction incredibly unpredictable with ←→ buttons, needs thought, issue that some lines ← is back while in others it's forward, and can lead to loops, I don't know what to do

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

not criteria, deliberately: callouts/dataview/graph/tags (not supported, would render literally), table separator styles and headerless tables `ensureTableSeparators` inserts the separator, then the empty header row is removed), persian `۱.` ordered lists (transliterated, then re-rendered as persian), bare emails (gfm autolinks them), math digit style (a settings choice), and unifying `$$ x $$` against bare `$$` (both are `display: true`, they render the same).
