// A note may carry its own stylesheet — a title page, a boxed warning, a
// table that has to look a certain way. That CSS belongs to the note, not to
// the app, so every selector in it is rewritten to sit under the element the
// note is drawn in: `.md-note`, which is the reading view's <article> and the
// export's <body>. Three things follow, and each is a rule the app needs.
//
//   • A note cannot reach the app. `body { margin: 0 }` — the first line of a
//     title page written for a standalone HTML page — styles the note's own
//     root and nothing else, so no note can move the toolbar, repaint the
//     sidebar or cover the screen.
//   • A note outranks the app. Each selector gains the root's class, so the
//     note's `.title-page h1` (0,2,1) beats the sheet's `.preview-pane h1`
//     (0,1,1). That is what a writer means by styling their own heading, and
//     it is the one place the app's own look must give way.
//   • The file stays a plain markdown file. Nothing is renamed or rewritten
//     on disk; the same note still renders anywhere else that keeps <style>.
//
// The CSS is read by the browser's own parser, through a constructed sheet
// that is never adopted — a hand-written one would be a second grammar to
// keep exact about comments, strings, nesting and @media, and nothing is
// applied to the page while it is being rewritten. Two kinds of rule are
// dropped, because the app cannot answer for them: @import, which would
// reach the network from inside a note, and @page, because page setup
// belongs to the export dialog and not to one file in a folder of forty.

/** The class the note's root carries, in both views. */
export const NOTE_ROOT = 'md-note';

/** At-rules whose body is ordinary rules, so their selectors need scoping
 *  too. @font-face, @keyframes and @property are kept whole: they define a
 *  name, not a target, and a name cannot escape into the app. */
const NESTED = /^@(media|supports|container|layer|scope)\b/i;
const DROPPED = /^@(import|page|charset|namespace)\b/i;

/** Rewrite a note's stylesheet so it applies to that note alone. */
export function scopeNoteCss(css: string, root = `.${NOTE_ROOT}`): string {
  if (!css.trim()) return '';
  try {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(css);
    return scopeRules(sheet.cssRules, root);
  } catch {
    // An engine without constructed sheets (or CSS it cannot parse at all):
    // the note simply goes unstyled, as it did before.
    return '';
  }
}

function scopeRules(rules: CSSRuleList, root: string): string {
  const out: string[] = [];
  for (const rule of Array.from(rules)) {
    const text = scopeRule(rule, root);
    if (text) out.push(text);
  }
  return out.join('\n');
}

function scopeRule(rule: CSSRule, root: string): string {
  const style = rule as CSSStyleRule;
  if (typeof style.selectorText === 'string') {
    // CSS nesting: a rule's children are already inside its scope, so they
    // travel as written.
    const nested = style.cssRules?.length ? ` ${Array.from(style.cssRules).map((child) => child.cssText).join(' ')}` : '';
    const selector = scopeSelector(style.selectorText, root);
    return selector ? `${selector} { ${style.style.cssText}${nested} }` : '';
  }
  const prelude = rule.cssText.slice(0, rule.cssText.indexOf('{')).trim();
  if (DROPPED.test(prelude) || DROPPED.test(rule.cssText)) return '';
  const group = rule as CSSGroupingRule;
  if (NESTED.test(prelude) && group.cssRules) return `${prelude} {\n${scopeRules(group.cssRules, root)}\n}`;
  return rule.cssText;
}

/** `.a, .b` → `.md-note .a, .md-note .b`, and html/body/:root → the root
 *  itself: a stylesheet written for a page of its own then lands on the one
 *  element that stands for that page here. */
function scopeSelector(selectorText: string, root: string): string {
  return splitTop(selectorText)
    .map((one) => scopeOne(one.trim(), root))
    .filter(Boolean)
    .join(', ');
}

function scopeOne(selector: string, root: string): string {
  if (!selector) return '';
  const head = /^(html|body|:root)/i.exec(selector);
  if (!head) return `${root} ${selector}`;
  const rest = selector.slice(head[0].length);
  if (!rest.trim()) return root;
  // `body.dark` is still the root, qualified; `body > p` is a descendant.
  return /^[.#:[]/.test(rest) ? `${root}${rest}` : `${root} ${rest.trim()}`;
}

/** Split on the commas that separate selectors, not the ones inside
 *  `:is(…)`, `[attr="a,b"]` or a string. */
function splitTop(selectorText: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote = '';
  let start = 0;
  for (let at = 0; at < selectorText.length; at += 1) {
    const char = selectorText[at];
    if (quote) {
      if (char === quote && selectorText[at - 1] !== '\\') quote = '';
      continue;
    }
    if (char === '"' || char === "'") quote = char;
    else if (char === '(' || char === '[') depth += 1;
    else if (char === ')' || char === ']') depth -= 1;
    else if (char === ',' && depth === 0) { parts.push(selectorText.slice(start, at)); start = at + 1; }
  }
  parts.push(selectorText.slice(start));
  return parts;
}
