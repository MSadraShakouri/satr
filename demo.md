# Satr demo

Everything Satr can do, in one note. Switch between editing and reading with the button at the top right (or double-tap the reading view), and open the outline by swiping in from the right edge.

Nothing here is written to your folders until you type in it. Write a word and this becomes a note of your own, in your notes folder, like any other.

## Writing in two directions

Every line takes its own direction from its first letter, so English and Persian sit side by side without any setting.

این یک پاراگراف فارسی است. هر خط جهت خودش را از اولین حرفش می‌گیرد، و متن English در وسط جمله هم درست می‌نشیند.

Numbers and dates take their direction from the words around them, so «۱۲ مهر ۱۴۰۴» reads as one date in Persian prose and `12 October` reads as one date here. Math and code never lean on their neighbours: they stay left to right wherever they sit.

> A quote in English.

> و یک نقل‌قول فارسی، با **متن پررنگ** و *کج*.

## Text styles

**Bold**, *italic*, ***both***, ~~struck through~~, `inline code`, and ==highlighted text==, as in Obsidian. متن ==برجسته== در فارسی هم کار می‌کند.

Type `*`, `_`, `=`, `~`, a backtick, a bracket or `$` with words selected, and the selection gets wrapped instead of replaced. Brackets, quotes, backticks and dollar signs close themselves; typing the closing one just steps over it.

While you write, only the line you are on shows its Markdown — the rest of the note reads as it will in the reading view. That is Obsidian's live preview, and it is the editor's normal state, not a mode you turn on.

## Lists

- A bullet
  - Indented under it
- [ ] A task (tap the box)
- [x] A finished task

1. English numbering
2. **Bold at the start** of an item
3. Continues when you press Enter

۱. شماره‌گذاری فارسی
۲. **پررنگ** در اول مورد
۳. با Enter ادامه پیدا می‌کند

الف. فهرست با حروف ابجد
ب. حرف‌ها هم با Enter ادامه پیدا می‌کنند
ج. نشانه همان است که نوشته‌اید

a) A list written with parens keeps them
b) and the marker hangs beside the text, not far from it

The list numbers itself as you write, counting from the head of the list — never from 1 — and an item that leaves brings the ones below it up. The head decides the digits and the punctuation: `۱)` stays Persian with its paren, `a.` counts in English letters, `الف.` in ابجد. Nothing is chosen from a menu; it is all in what you typed.

## Links

A link to [a web page](https://github.com/MSadraShakouri/Satr), and wiki links to other notes: [[demo]], [[demo#Math|a heading in it]]. Type `[[` to pick a note from a list. Links to notes that don't exist are dimmed in the reading view.

## Footnotes

Tap the footnote button on the keyboard toolbar to add one at the caret.[^1] In the reading view, tapping the number opens the note in a popover.[^2]

[^1]: The note is written in a popover, right where you are.
[^2]: یادداشت فارسی هم درست نمایش داده می‌شود.

## Dates and times

A Discord-style stamp is a date everyone reads in their own language: <t:1700000000:D>. The note keeps the code, `<t:1700000000:D>`, and the chip is drawn from it.

All seven formats, from the same moment:

| Code | Shows |
| :--- | :--- |
| `<t:1700000000:t>` | <t:1700000000:t> |
| `<t:1700000000:T>` | <t:1700000000:T> |
| `<t:1700000000:d>` | <t:1700000000:d> |
| `<t:1700000000:D>` | <t:1700000000:D> |
| `<t:1700000000:f>` | <t:1700000000:f> |
| `<t:1700000000:F>` | <t:1700000000:F> |
| `<t:1700000000:R>` | <t:1700000000:R> |

The relative one keeps counting while you read it, and the PDF prints the same grey chip. Settings → Dates chooses the language and the calendar — Gregorian or Persian (Jalali) — and which day starts the week.

The date button on the keyboard toolbar opens a picker: flick through the months, or tap the month to jump straight to one. Tap a chip you have already written to change it.

## Math

Inline math keeps left-to-right order even inside Persian text: رابطهٔ $a^2 + b^2 = c^2$ را فیثاغورس ثابت کرد.

Type `$$` on an empty line, then `$$` again, and you get a block with the caret inside:

$$
E = mc^2
$$

Long formulas wrap on narrow screens. They never break at a plus or minus; they break at `=`, `<`, `≤` and other relations, and the relation is repeated at the start of the next line:

$$
f(x) = (x + 1)(x + 2)(x + 3)(x + 4) = x^4 + 10x^3 + 35x^2 + 50x + 24
$$

Spaces you type between words in math are kept (KaTeX would drop them), and the formula can wrap there too — including words inside `\text`:

$$
average speed = total distance travelled divided by the time it took
$$

$$
\text{If } f \text{ is continuous on the closed interval } [a, b]
$$

Inside the dollars nothing is Markdown: a `**` is never bold, a `[a](b)` never a link, a `[^1]` never a footnote. The source is styled like Obsidian's — the formula monospace and italic, the dollars themselves in the accent colour, so you can see where it begins and ends.

A note written somewhere else with `\(…\)` or `\[…\]` shows a bar offering **Normalize math**, which turns those into dollars. Settings → Editor → **Math digits** sets the digits every formula is shown with, in the reading view and the PDF; the note keeps the digits you typed.

## Images

Images show in the reading view and in the PDF, centred and never wider than the text. Both Markdown and Obsidian embeds work, with an optional width. Put a picture named `picture.png` next to this note (or anywhere, for the second one) to see them:

![A picture](picture.png)

![[picture.png|300]]

A picture that can't be found shows its name in a dashed box.

## Tables

| Name | Centred | Right |
| :--- | :---: | ---: |
| Satr | aligned | 42 |
| ستر | فارسی | ۱۰۰ |

Each table has a direction of its own, taken from its first cell. The ≡ menu's **Table direction** sets it by hand, and writes what it set on the line above the table:

<!-- table: rtl -->

| ستون | وسط | چپ |
| :--- | :---: | ---: |
| ردیف | میانه | ۱۲ |

In a right-to-left table `---:` puts the column against the left and `:---` against the right — the mirror of the English one, on screen and in the PDF alike.

## Code

```ts
const message = 'Hello from Satr';
console.log(message);
```

Code blocks are highlighted by language and carry a copy button in the corner, as Obsidian's do on the phone.

## Headings fold

Every heading with something under it has a chevron at the end of its line. Tap it to fold the section; the ≡ menu folds or unfolds them all.

### A smaller heading

The outline in the right drawer shows this tree. With **All notes**, only the note you're in starts open; tap a note's chevron to open it.

## Finding things

The magnifier in the bottom bar opens find and replace for this note — one bar, with **Highlight every match** as a setting. The right drawer searches every note in the space instead, with regular expressions if you want them, and an **Include subfolders** switch for when you don't.

## Tabs

Notes open in tabs. The **+** in the bottom bar makes a new tab, the number beside it opens the switcher, and holding that number offers **Close all tabs**, **Close other tabs** and **Reopen closed tab**. Each note remembers where you were reading, which view you were in, where the caret sat and which headings were folded — across tab switches, closing and reopening a tab, and restarts of the app.

Undo and redo belong to each tab, and the arrows at the bottom step through your notes, not your edits.

Settings → Tabs decides what a launch does: bring back the tabs you had, always open an empty tab, or open one only after you have been away for a while.

## Your files

The left drawer is your folders. A folder can be made a **space** — a shortcut Satr never writes its own files into — and **All files** walks the whole storage. Hold a folder to make a note in it, rename, move or delete it, open all its notes in tabs, or export the whole folder as one PDF.

Any file opens, not only Markdown: a `.patch`, a `.json`, a script. Plain text is editable whatever its extension, anything else is shown read-only so nothing can be written back over it, and a photo opens as a picture.

## The keyboard toolbar

Above the keyboard: undo and redo, heading, bulleted list, numbered list, to-do, math, footnote, date, select the whole line, a new line below, move the line up or down, delete the line — and the chevron that drops the keyboard without leaving the note. Settings → Keyboard toolbar hides the buttons you never use.

## Settings worth knowing

Font size and line spacing, line numbers, the side the ≡ menu button sits on, your own CSS for the PDF, and the language the app speaks — Satr's own, never the device's, so a Persian note on an English phone still reads as you meant it.

## Page breaks for the PDF

The ≡ menu → **Export to PDF** opens Android's print dialog, with one or two columns, Persian page numbers, footnotes at the foot of each page, and the options remembered per note. A page break starts a new page there and is hidden on screen:

\pagebreak

This paragraph starts the next page of the PDF.
