import { test, expect } from '@playwright/test';

// Formulas written by hand to be awkward on purpose, next to the shape each one
// should take when the column is too narrow for it. Every line below was read off
// the renderer once and then checked by eye; they are expectations, not a snapshot.
// [ name, formula, how many pieces, what the reader sees ]
const CASES: Array<[string, string, number, string]> = [
  ['decimal comma'           , String.raw`x = 1,5`, 2, 'x=1,5'],
  ['decimal comma, persian'  , String.raw`x = ۱٫۵`, 2, 'x=۱٫۵'],
  ['decimal comma in a sum'  , String.raw`v = 3,14 + 2,86`, 3, 'v=3,14+2,86'],
  ['thousands'               , String.raw`N = 1,000,000 + 1`, 3, 'N=1,000,000+1'],
  ['list comma'              , String.raw`f(x, y) = x + y`, 4, 'f(x,y)=x+y'],
  ['set'                     , String.raw`A = \{1, 2, 3\}`, 4, 'A={1,2,3}'],
  ['interval'                , String.raw`x \in [0,1]`, 2, 'x∈[0,1]'],
  ['comma in a fraction'     , String.raw`\frac{1,5}{2}`, 1, '21,5'],
  ['comma then space'        , String.raw`a, b, c`, 3, 'a,b,c'],
  ['subscript comma'         , String.raw`x_{1,2} = 5`, 2, 'x1,2=5'],
  ['comma at the end'        , String.raw`x = 5,`, 2, 'x=5,'],
  ['persian list comma'      , String.raw`a، b`, 2, 'a،b'],
  ['unary minus'             , String.raw`x = -y`, 2, 'x=−y'],
  ['signed group'            , String.raw`n = (+1) + (-1)`, 3, 'n=(+1)+(−1)'],
  ['plus minus'              , String.raw`x = \pm 5`, 2, 'x=±5'],
  ['operator then sign'      , String.raw`a \cdot -b`, 2, 'a⋅−b'],
  ['leading minus'           , String.raw`-x + y`, 2, '−x+y'],
  ['signed arguments'        , String.raw`f(-x) + g(+y)`, 2, 'f(−x)+g(+y)'],
  ['superscript signs'       , String.raw`\mathbb{R}^+ \times \mathbb{R}^-`, 2, 'R+×R−'],
  ['sum in an exponent'      , String.raw`a^{b+c} + d`, 2, 'ab+c+d'],
  ['factorial'               , String.raw`5! + 3`, 2, '5!+3'],
  ['primes'                  , String.raw`f'(x) + g'(x)`, 2, 'f′(x)+g′(x)'],
  ['bars'                    , String.raw`|x| + |y|`, 2, '∣x∣+∣y∣'],
  ['double sign'             , String.raw`x = 2 - -3`, 3, 'x=2−−3'],
  ['fraction'                , String.raw`\frac{a+b}{c+d}`, 1, 'c+da+b'],
  ['delimited sum'           , String.raw`\left(a + b\right) + c`, 3, '(a+b)+c'],
  ['root'                    , String.raw`\sqrt{a + b} + c`, 2, 'a+b+c'],
  ['sum sign'                , String.raw`\sum_{i=1}^{n} i + 1`, 2, 'i=1∑ni+1'],
  ['integral'                , String.raw`\int_0^1 x\,dx + C`, 2, '∫01xdx+C'],
  ['matrix'                  , String.raw`\begin{pmatrix} a & b \end{pmatrix} + I`, 2, '(ab)+I'],
  ['text around'             , String.raw`\text{if } x > 0 \text{ then } y = 1`, 3, 'if x>0 then y=1'],
  ['nested delimiters'       , String.raw`\left[\left(a+b\right)+c\right] + d`, 4, '[(a+b)+c]+d'],
  ['persian words'           , String.raw`سرعت = مسافت`, 2, 'سرعت=مسافت'],
  ['persian text command'    , String.raw`\text{سرعت متوسط} = \frac{x}{t}`, 2, 'سرعت متوسط=tx'],
  ['persian letters and plus', String.raw`س + ص = ۵`, 3, 'س+ص=۵'],
  ['persian digits'          , String.raw`۱ + ۲ = ۳`, 3, '۱+۲=۳'],
  ['lone operator'           , String.raw`+`, 1, '+'],
  ['trailing operator'       , String.raw`a +`, 1, 'a+'],
  ['double operator'         , String.raw`a + + b`, 2, 'a++b'],
  ['lone comma'              , String.raw`,`, 1, ','],
  ['empty commas'            , String.raw`x,,y`, 2, 'x,,y'],
  ['manual break'            , String.raw`a \\ b`, 1, 'ab'],
  ['greek letters'           , String.raw`α + β`, 2, 'α+β'],
  ['units'                   , String.raw`9,8 \ \mathrm{m}/\mathrm{s}^2`, 1, '9,8 m/s2'],
  ['text in delimiters'      , String.raw`\left( \text{hello world} \right)`, 1, '(hello world)'],
  ['tuple'                   , String.raw`\vec{r} = \left( x + C_1, y + C_2, z \right)`, 6, 'r=(x+C1,y+C2,z)'],
  ['embedded matrix'         , String.raw`\det A = \begin{vmatrix} 1 & 2 \\ 3 & 4 \end{vmatrix} = -2`, 3, 'detA=1324=−2'],
  ['quad'                    , String.raw`a \quad b`, 2, 'ab'],
  ['persian definitions'     , String.raw`Z : \text{تابع هدف} \quad x_j : \text{متغیر تصمیم}`, 2, 'Z:تابع هدفxj:متغیر تصمیم'],
  ['thin space'              , String.raw`\int f(x)\,dx`, 1, '∫f(x)dx'],
  ['thin space in a sum'     , String.raw`\int f \, dx + \int g \, dx`, 2, '∫fdx+∫gdx'],
  ['nested tuple'            , String.raw`\left( \left[ a, b \right], c \right)`, 3, '([a,b],c)'],
];

type Piece = { units: number; error: boolean; shown: string; texes: string[]; conts: string[]; opens: string[] };

// Every piece is rendered twice as siblings: .math-plain, and .math-cont which is what
// the piece looks like when it lands at the start of a line (a relation is repeated there).
async function render(
  page: import('@playwright/test').Page,
  cases: Array<[string, string]>,
  display = true,
): Promise<Piece[]> {
  return page.evaluate(
    async ({ items, display }) => {
      const { renderMath } = await window.__satr.load('/src/math.ts');
      return items.map((tex) => {
        const html = renderMath(tex, display);
        const doc = new DOMParser().parseFromString(html, 'text/html');
        const ann = (el: Element, sel: string) =>
          [...el.querySelectorAll(`${sel} annotation`)]
            .map((a) => (a.textContent ?? '').replace('\\displaystyle', '').replace(/\s+/g, ' ').trim())
            .slice(0, 1);
        const units = [...doc.querySelectorAll('.math-unit')];
        // katex itself knows a binary operator (mbin) from a sign on an operand (mord):
        // a line may begin with a sign, never with the operator it was cut at
        const opens = units.map((u) => {
          const first = u.querySelector(':scope > .math-plain .katex-html > .base')?.firstElementChild;
          return [...(first?.classList ?? [])].find((c) => c.startsWith('m')) ?? '';
        });
        const texes = units.flatMap((u) => ann(u, ':scope > .math-plain'));
        const conts = units.flatMap((u) => ann(u, ':scope > .math-cont'));
        for (const mathml of doc.querySelectorAll('.katex-mathml')) mathml.remove();
        for (const cont of doc.querySelectorAll('.math-cont')) cont.remove();
        return {
          units: Number(html.match(/data-units="(\d+)"/)?.[1] ?? 1),
          error: html.includes('katex-error'),
          texes,
          conts,
          opens,
          shown: (doc.body.textContent ?? '').replace(/\u200b/g, '').replace(/\s+/g, ' ').trim(),
        };
      });
    },
    { items: cases.map(([, tex]) => tex), display },
  );
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => document.fonts.ready);
});

test('each awkward formula is cut where it should be', async ({ page }) => {
  const got = await render(page, CASES.map(([name, tex]) => [name, tex] as [string, string]));
  const actual = got.map((r, i) => `${CASES[i][0]}: ${r.units} | ${r.shown}`);
  const wanted = CASES.map(([name, , units, shown]) => `${name}: ${units} | ${shown}`);
  expect(actual).toEqual(wanted);
});

test('katex renders every one of them', async ({ page }) => {
  const got = await render(page, CASES.map(([name, tex]) => [name, tex] as [string, string]));
  expect(CASES.filter((c, i) => got[i].error).map((c) => c[0])).toEqual([]);
});

test('no line ever begins with the operator or comma it was cut at', async ({ page }) => {
  const got = await render(page, CASES.map(([name, tex]) => [name, tex] as [string, string]));
  const bad: string[] = [];
  got.forEach((r, i) => {
    r.opens.slice(1).forEach((kind, n) => {
      if (kind === 'mbin' || kind === 'mpunct') bad.push(`${CASES[i][0]}: piece ${n + 2} starts with a ${kind}, "${r.texes[n + 1]}"`);
    });
  });
  expect(bad).toEqual([]);
});

test('a relation is repeated at the start of the next line, an operator and a comma are not', async ({ page }) => {
  const [rel, op, comma, quad] = await render(page, [
    ['relation', String.raw`x + y = a + b`],
    ['operator', String.raw`a + b + c + d`],
    ['comma', String.raw`a, b, c`],
    ['quad', String.raw`a \quad b`],
  ]);
  const repeated = (r: Piece) => r.texes.map((t, n) => (r.conts[n] ?? t).slice(0, (r.conts[n] ?? t).length - t.length)).filter(Boolean);
  expect(repeated(rel)).toEqual(['= ']);
  expect(repeated(op)).toEqual([]);
  expect(repeated(comma)).toEqual([]);
  expect(repeated(quad)).toEqual([]);
});

test('a piece is always a formula in itself: delimiters are closed and reopened', async ({ page }) => {
  const got = await render(page, CASES.map(([name, tex]) => [name, tex] as [string, string]));
  const bad: string[] = [];
  got.forEach((r, i) => {
    for (const t of [...r.texes, ...r.conts]) {
      const opens = (t.match(/\\left/g) ?? []).length;
      const closes = (t.match(/\\right/g) ?? []).length;
      if (opens !== closes) bad.push(`${CASES[i][0]}: ${opens} left against ${closes} right in "${t}"`);
    }
  });
  expect(bad).toEqual([]);
});

test('a cut tuple keeps its brackets open across the lines', async ({ page }) => {
  const [tuple] = await render(page, [['tuple', String.raw`\vec{r} = \left( x + C_1, y + C_2, z \right)`]]);
  expect(tuple.texes.filter((t) => t.includes('\\left('))).toHaveLength(1);
  expect(tuple.texes.filter((t) => t.includes('\\right.')).length).toBeGreaterThan(0);
  expect(tuple.texes.filter((t) => t.includes('\\left.')).length).toBeGreaterThan(0);
});

test('what the reader sees is the same whether the formula is cut or not', async ({ page }) => {
  const cases = CASES.map(([name, tex]) => [name, tex] as [string, string]);
  const cut = await render(page, cases);
  const whole = await render(page, cases, false);
  // a sum or a limit puts its bounds above and below in a display and beside itself inline,
  // which reorders the text for reasons that have nothing to do with breaking
  const differ = CASES.filter(
    (c, i) => cut[i].shown !== whole[i].shown && !/\\(sum|prod|lim|oint)/.test(c[1]),
  ).map((c) => c[0]);
  expect(differ).toEqual([]);
});

test('the writer\u2019s own layout is never cut up', async ({ page }) => {
  const got = await render(page, [
    ['align', String.raw`\begin{align} a &= b \\ c &= d \end{align}`],
    ['matrix', String.raw`\begin{pmatrix} a & b \\ c & d \end{pmatrix}`],
    ['manual break', String.raw`a \\ b`],
    ['embedded matrix', String.raw`\det A = \begin{vmatrix} 1 & 2 \\ 3 & 4 \end{vmatrix} = -2`],
  ]);
  expect(got.slice(0, 3).map((r) => r.units)).toEqual([1, 1, 1]);
  // an environment that is only part of a formula may be moved to a line of its own, never opened up
  expect(got[3].units).toBe(3);
  const held = got[3].texes.filter((t) => t.includes('vmatrix'));
  expect(held).toHaveLength(1);
  expect(held[0]).toContain('\\end{vmatrix}');
});
