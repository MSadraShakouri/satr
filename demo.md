# Satr demo

Everything Satr can do, in one note. Switch between editing and reading with the button at the top right (or double-tap the reading view), and open the outline by swiping in from the right edge.

## Writing in two directions

Every line takes its own direction from its first letter, so English and Persian sit side by side without any setting.

این یک پاراگراف فارسی است. هر خط جهت خودش را از اولین حرفش می‌گیرد، و متن English در وسط جمله هم درست می‌نشیند.

> A quote in English.

> و یک نقل‌قول فارسی، با **متن پررنگ** و *کج*.

## Text styles

**Bold**, *italic*, ***both***, ~~struck through~~, `inline code`, and ==highlighted text==, as in Obsidian. متن ==برجسته== در فارسی هم کار می‌کند.

Type `*`, `_`, `=`, `~`, a backtick, a bracket or `$` with words selected, and the selection gets wrapped instead of replaced. Brackets, quotes, backticks and dollar signs close themselves; typing the closing one just steps over it.

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

## Links

A link to [a web page](https://github.com/MSadraShakouri/Satr), and wiki links to other notes: [[Satr demo]], [[Satr demo#Math|a heading in it]]. Type `[[` to pick a note from a list. Links to notes that don't exist are dimmed in the reading view.

## Footnotes

Tap the footnote button on the keyboard toolbar to add one at the caret.[^1] In the reading view, tapping the number opens the note in a popover.[^2]

[^1]: The note is written in a popover, right where you are.
[^2]: یادداشت فارسی هم درست نمایش داده می‌شود.

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

## Code

```ts
const message = 'Hello from Satr';
console.log(message);
```

## Headings fold

Every heading with something under it has a chevron at the end of its line. Tap it to fold the section; the ≡ menu folds or unfolds them all.

### A smaller heading

The outline in the right drawer shows this tree. With **All notes**, only the note you're in starts open; tap a note's chevron to open it.

## Page breaks for the PDF

The ≡ menu → **Export to PDF** opens Android's print dialog. A page break starts a new page there and is hidden on screen:

\pagebreak

This paragraph starts the next page of the PDF.
