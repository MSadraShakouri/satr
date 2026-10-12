# The plan

Remaining work for this PR, in the order to do it. Web first, then APK.
Lint and GitHub stay deferred. Two items the writer is unsure about sit at
the end. Date-picker web grow/shrink is web-only and does not matter unless
asked. Tablet layout is later; no dual pane can be done now.

## Next

1. **Tab number digits, vertical centre.** Still not right after sitting the
   digit in the 26px square.
2. **Left sidebar.** Sometimes it does not keep the main page shifted: it
   moves at first, then the page slides back.
3. **Folder row in the left sidebar.** `/folder · X files, Y folders` does
   not even show; the folder name truncates. Either drop that count, or wrap:
   name on one line, counts on another, separate.
4. **Notices** (`loaded from file`, `Preparing the PDF…`, …): not full width.
   Sit in the gap between the files button and the preview button (not behind
   them). Part of the source/preview view — they move with the drawers, they
   do not float on the whole screen. Settings / export / tab-switcher pages
   keep a full-width banner (no those two buttons).
5. **Phantom space.** After `a)` / `a"` and the like, the keyboard holds a
   space until the next keystroke; the app fights it.
6. **Opening an image.** It first tries as text, the app gets very slow; a
   separate bug then sticks the page so you cannot change it. Handle images
   as images before add/crop work.
7. **Open from another app.** An already-open note must switch to that tab,
   not open a second one. APK.
8. **Title ✓ jumpy on new files.** Existing-file Enter is fine; web is
   smooth; APK lags. Keep the keyboard; same title node. Research before
   inventing a fix.
9. **Launch empty tab, APK check.** Coded. Confirm on the device: it must
   not stay on the old note after minimize.
10. **No dual pane in landscape.** Can be done now. Tablet support (the rest
    of the layout) is later.
11. **Math text font.** Persian inside a formula follows the **system**
    font; undesired. Maybe force Vazir, or pick another font for math.
    English in math has not been checked on other devices. Needs thought.
12. **Selection between lines.** The highlight leaves a gap in the line
    spacing. Maybe grow the selection into that space — the writer is not
    sure that is the right approach.
13. **Right sidebar.** Word and character count, possibly under the file
    name at the top.
14. **←→ on mixed lines.** Some lines back is left, some forward; can loop.
    Needs a rule from the writer. Caret vs arrows stay separate.

## Then images

15. **Add and crop** images in the note.
16. **Compress on add** (browser codecs, Squoosh-like, only if the bundle
    stays small).
17. **Print size.** Claimed fixed; check on APK or on the site once add
    exists.

## Later

18. **Tablet support.** Later. Dual pane is item 10, not this.

## Unsure — ask before doing

19. **Hamburger ≡** as a growing Chromium-style popup instead of the sheet.
20. **Timestamp picker floating** instead of the sheet. Writer is not sure
    the gains beat the losses.

## Deferred

21. **In-app lint/fixer.** Report plus fix-all-safe. Criteria (measured on
    term_three):
    1. A display `$$` that is a lazy list continuation — blank line before
       `$$`. 11 sites.
    2. Redundant `<div dir=ltr>` wrappers — report as redundant, not wrong.
       20 pairs in Mathematics 2 01.
    3. Trailing `:` in a heading (outline/search).
    4. Trailing space in heading text (outline reads `معرفی `).
    5. List indent must be 0/2/4; 1-space indent is a sibling, not a child.
    6. Empty list item = blank bullet.
    7. Every formula through `renderMath`; fail on `katex-error`.
    8. Pin: `\\[6pt]` is a skip, never a `\[…\]` pair.
    Not criteria: callouts/dataview/graph/tags, table separator styles,
    headerless tables, Persian `۱.` lists, bare emails, math digit style,
    `$$ x $$` vs bare `$$`.
22. **GitHub connection.** Read/write in a scoped way, not sync. Later.

## Done (this list)

- [x] Timestamps follow the app language, not the system
- [x] Timestamps: calendar and language (Jalali), GUI to pick and enter
- [x] Timestamp chip direction: English relative LTR isolate, Persian
      relative RTL isolate (`4 hours ago`, not `hours ago 4`)
- [x] Whole-table direction by hand (`<!-- table: rtl|ltr|auto -->`)
- [x] Print tables follow that direction
- [x] Launch empty tab: no flash of the last note; logo a bit longer (480ms)
- [x] Preview tables scroll horizontally
- [x] Do not break a table across pages unless it cannot fit on one
- [x] Date-only line caret is not LTR just because the line has no letters
- [x] End-of-line caret follows the line, not the last letter
- [x] Edit⇄preview scroll: same place is three body lines down (the typing
      band), not y=0
- [x] Top of typing: three body lines of keep-out, same as the bottom vs
      the keyboard
- [x] Hold the tabs button: new / reopen / close all / close other / close
      current (Close all first, Close current last)
- [x] Date picker: month/year editing no longer eats the row; calendar
      switcher highlights the current calendar instead of renaming the button
