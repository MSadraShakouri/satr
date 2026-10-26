// The app's own fonts, carried as data so they travel: a PDF frame and an
// .html page in the vault both render at an opaque origin, where nothing of
// this one's can be fetched by URL.
export async function embeddedFonts(withMath: boolean): Promise<string> {
  const rules: CSSFontFaceRule[] = [];
  const bases = new Map<CSSFontFaceRule, string>();
  for (const sheet of [...document.styleSheets]) {
    let list: CSSRuleList;
    try { list = sheet.cssRules; } catch { continue; }
    for (const rule of [...list]) {
      if (!(rule instanceof CSSFontFaceRule)) continue;
      const family = rule.style.getPropertyValue('font-family').replace(/["']/g, '').trim();
      if (family === 'Vazirmatn' || family === 'VazirCode' || (withMath && (family === 'XB Zar' || family.startsWith('KaTeX')))) {
        rules.push(rule);
        bases.set(rule, sheet.href ?? document.baseURI);
      }
    }
  }
  const faces = await Promise.all(rules.map(async (rule) => {
    const src = rule.style.getPropertyValue('src');
    const match = /url\((["']?)([^"')]+\.woff2[^"')]*)\1\)\s*(format\([^)]*\))?/.exec(src);
    if (!match) return '';
    try {
      const response = await fetch(new URL(match[2], bases.get(rule)).href);
      if (!response.ok) return '';
      const data = await blobToDataUrl(await response.blob(), 'font/woff2');
      const keep = ['font-family', 'font-weight', 'font-style', 'font-stretch', 'unicode-range']
        .map((prop) => [prop, rule.style.getPropertyValue(prop)] as const)
        .filter(([, value]) => value)
        .map(([prop, value]) => `${prop}: ${value};`).join(' ');
      return `@font-face { ${keep} src: url("${data}") ${match[3] ?? ''}; }`;
    } catch { return ''; }
  }));
  return faces.join('\n');
}

function blobToDataUrl(blob: Blob, type: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).replace(/^data:[^;,]*/, `data:${type}`));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}
