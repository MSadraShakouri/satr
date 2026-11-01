/** A small, real PDF of as many pages as asked for, built here so the specs
 *  never need a file checked in beside them. Shared by the specs that open a
 *  document from the vault and the one that imports it from the device.
 */
export function tinyPdf(pages: number, darkPages: number[] = [], outline: string[] = [], viaAction = false): string {
  const objects: string[] = [];
  const pageIds: number[] = [];
  for (let index = 0, id = 3; index < pages; index += 1, id += 2) pageIds.push(id);
  const fontId = 3 + pages * 2;
  // A document outline, when one is asked for: title i points at page i.
  // Browsers' print-to-PDF never writes this dictionary, which is why a
  // file exported from a note app has no contents for any viewer to show.
  const outlineId = fontId + 1;
  objects[1] = outline.length
    ? `<< /Type /Catalog /Pages 2 0 R /Outlines ${outlineId} 0 R >>`
    : '<< /Type /Catalog /Pages 2 0 R >>';
  objects[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pages} >>`;
  pageIds.forEach((id, index) => {
    objects[id] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${id + 1} 0 R >>`;
    // A page listed in darkPages is painted dark grey with pale ink, the way
    // a slide deck is: the one shape a dark theme must leave alone.
    const dark = darkPages.includes(index + 1);
    const stream = dark
      ? `0.1 0.1 0.12 rg 0 0 595 842 re f 0.9 0.9 0.9 rg BT /F1 36 Tf 60 740 Td (Page ${index + 1}) Tj ET`
      : `BT /F1 36 Tf 60 740 Td (Page ${index + 1}) Tj ET`;
    objects[id + 1] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  });
  objects[fontId] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';
  if (outline.length) {
    const itemId = (index: number): number => outlineId + 1 + index;
    objects[outlineId] = `<< /Type /Outlines /First ${itemId(0)} 0 R /Last ${itemId(outline.length - 1)} 0 R /Count ${outline.length} >>`;
    outline.forEach((title, index) => {
      const previous = index > 0 ? ` /Prev ${itemId(index - 1)} 0 R` : '';
      const next = index < outline.length - 1 ? ` /Next ${itemId(index + 1)} 0 R` : '';
      // Two ways a bookmark names a page, both of them common: the /Dest
      // every simple writer uses, and the GoTo action LaTeX's hyperref
      // writes — which is what every paper off arXiv carries.
      const target = viaAction
        ? ` /A << /S /GoTo /D [${pageIds[Math.min(index, pages - 1)]} 0 R /XYZ 108 720 0] >>`
        : ` /Dest [${pageIds[Math.min(index, pages - 1)]} 0 R /Fit]`;
      objects[itemId(index)] = `<< /Title ${pdfString(title)} /Parent ${outlineId} 0 R${previous}${next}${target} >>`;
    });
  }
  return assemble(objects);
}

/** A PDF text string: plain between the brackets while it is ASCII, and
 *  UTF-16 in hex once it is not, which is how a bookmark carries a title
 *  written in any other script. */
function pdfString(text: string): string {
  if (/^[\x20-\x7e]*$/.test(text)) return `(${text.replace(/([()\\])/g, '\\$1')})`;
  let hex = 'FEFF';
  for (const char of text) hex += char.codePointAt(0)!.toString(16).padStart(4, '0').toUpperCase();
  return `<${hex}>`;
}

/** The numbered objects, the cross-reference table under them and the
 *  trailer that points at it — the part of a PDF that is the same whatever
 *  is on the pages. */
function assemble(objects: string[]): string {
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  for (let id = 1; id < objects.length; id += 1) {
    offsets[id] = out.length;
    out += `${id} 0 obj\n${objects[id]}\nendobj\n`;
  }
  const xref = out.length;
  out += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let id = 1; id < objects.length; id += 1) out += `${String(offsets[id]).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return `data:application/pdf;base64,${Buffer.from(out, 'latin1').toString('base64')}`;
}

/** A document that is actually typeset: body text in the size most of the
 *  page is set in, and above it the headings that are set larger — a
 *  chapter at 30pt, a section under it at 22pt. This is the shape every
 *  exported note has, and the only kind of document a contents list read
 *  off the type has anything to find. No outline dictionary is written,
 *  because no browser's printer writes one. */
export function typesetPdf(pages: Array<{
  chapter?: string; section?: string;
  /** A heading one tenth larger than the body — print.css's h4, the
   *  smallest size a heading is ever set in. */
  minor?: string;
  /** A line of maths: larger than the body, and set in the font KaTeX
   *  prints formulas in, which is how the reader can tell it is one. */
  formula?: string;
  /** A line of nothing but figures, set large — a page number. */
  digits?: string;
  /** A second body: so many lines of ordinary prose, set a size above the
   *  rest of the page, the way a long quotation or an imported section
   *  comes out. Every line of it is larger than the body and short enough
   *  to pass for a title. */
  aside?: number;
}>): string {
  const objects: string[] = [];
  const pageIds: number[] = [];
  for (let index = 0, id = 3; index < pages.length; index += 1, id += 2) pageIds.push(id);
  const fontId = 3 + pages.length * 2;
  const mathId = fontId + 1;
  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objects[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pages.length} >>`;
  const line = 'the body of the page, set in the size most of it is set in';
  pageIds.forEach((id, index) => {
    objects[id] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources`
      + ` << /Font << /F1 ${fontId} 0 R /F2 ${mathId} 0 R >> >> /Contents ${id + 1} 0 R >>`;
    const parts: string[] = [];
    const { chapter, section, minor, formula, digits, aside } = pages[index];
    if (chapter) parts.push(`BT /F1 30 Tf 60 780 Td (${chapter}) Tj ET`);
    if (section) parts.push(`BT /F1 22 Tf 60 730 Td (${section}) Tj ET`);
    if (minor) parts.push(`BT /F1 13.2 Tf 60 712 Td (${minor}) Tj ET`);
    if (formula) parts.push(`BT /F2 18 Tf 60 700 Td (${formula}) Tj ET`);
    if (digits) parts.push(`BT /F1 16 Tf 300 60 Td (${digits}) Tj ET`);
    for (let row = 0; row < (aside ?? 0); row += 1) {
      parts.push(`BT /F1 14 Tf 60 ${660 - row * 18} Td (quoted line ${row + 1} of page ${index + 1}) Tj ET`);
    }
    // Enough body for the body to win the count, as it does on a real page.
    for (let row = 0; row < 14; row += 1) parts.push(`BT /F1 12 Tf 60 ${690 - row * 20} Td (${line}) Tj ET`);
    const stream = parts.join('\n');
    objects[id + 1] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  });
  objects[fontId] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';
  // Named the way KaTeX's faces are named in a PDF Satr prints, which is
  // what marks its runs as maths. The glyphs themselves are a substitute:
  // the name is the whole of what is being tested.
  objects[mathId] = '<< /Type /Font /Subtype /Type1 /BaseFont /AAAAAA+KaTeX_Main-Regular >>';
  return assemble(objects);
}

/** The same document as the bytes a file chooser would hand over. */
export function tinyPdfBytes(pages: number): Buffer {
  return Buffer.from(tinyPdf(pages).slice('data:application/pdf;base64,'.length), 'base64');
}

/**
 * A page with pictures printed on it, covering `share` of the page's area
 * between them.
 *
 * The pictures are eight by eight pixels of near-white, written as hex
 * rather than as bytes so the file stays text the way every other fixture
 * here does. Near-white is the point of them: inverted they go black, so a
 * test can tell by colour alone whether the dark theme left them alone.
 *
 * `how` is what the rest of it is for. A page is judged by the writing on
 * it that a reader could actually see: words over the pictures make it a
 * page with photographs printed on it, however much of it they cover;
 * words a picture is painted over are OCR, and leave it a scan. `text` is
 * which kind this page carries --
 *
 *   visible   a line of type over the pictures, the way a slide carries a
 *             heading over a photograph
 *   invisible an OCR layer set to be drawn as nothing, under them
 *   under     an OCR layer in plain black, under them: the words are
 *             there, in ordinary ink, and no reader will ever see them
 *   stamp     a page number in the corner, over them -- writing, but not
 *             a line's worth of it
 *   none      nothing written at all
 *
 * -- and `count` is how many pictures they are spread over, laid out in a
 * grid. Pick a share that fits the count, or the squares overlap.
 */
export function picturePdf(share: number, how: {
  text?: 'visible' | 'invisible' | 'under' | 'stamp' | 'none';
  count?: number;
  /** What the picture is a picture of. A photograph has no flat field of
   *  paper white anywhere in it; a figure drawn on a computer is mostly
   *  one, which is how the viewer tells a chart from a photograph. */
  ink?: 'photo' | 'paper';
  /** A /Rotate on the page, the way a sideways table or a sheet fed into
   *  a scanner the wrong way round carries one. */
  rotate?: 0 | 90 | 180 | 270;
} = {}): string {
  const objects: string[] = [];
  const page = { width: 595, height: 842 };
  const count = Math.max(1, how.count ?? 1);
  // The page's own shape, shrunk to the share asked for, so a picture
  // always fits inside the sheet however big a share it is given.
  const of = Math.sqrt(share / count);
  const size = { width: Math.round(page.width * of), height: Math.round(page.height * of) };
  const columns = Math.ceil(Math.sqrt(count));
  const rows = Math.ceil(count / columns);
  const places: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const cell = { x: (index % columns) * (page.width / columns), y: Math.floor(index / columns) * (page.height / rows) };
    const x = Math.round(cell.x + (page.width / columns - size.width) / 2);
    const y = Math.round(cell.y + (page.height / rows - size.height) / 2);
    places.push(`q ${size.width} 0 0 ${size.height} ${x} ${y} cm /Im1 Do Q`);
  }
  // 8 by 8, three bytes a pixel, written as hex. A photograph is near
  // white but never flat -- every pixel a little different, as a camera's
  // or a scanner's are -- and a figure is a sheet of paper white with its
  // ink in the middle of it.
  const swatch: string[] = [];
  for (let y = 0; y < 8; y += 1) {
    for (let x = 0; x < 8; x += 1) {
      const middle = x >= 2 && x <= 4 && y >= 2 && y <= 4;
      if (how.ink === 'paper') swatch.push(middle ? '1a1a1a' : 'ffffff');
      else {
        const wobble = ((x * 7 + y * 13) % 11) - 5; // 237 to 247, never 250
        const shade = (242 + wobble).toString(16).padStart(2, '0');
        swatch.push(shade + shade + shade);
      }
    }
  }
  const pixels = swatch.join('');
  const said = how.text ?? 'visible';
  const lines: Record<string, string> = {
    visible: 'BT /F1 18 Tf 60 780 Td (A page with a picture on it) Tj ET',
    invisible: 'BT 3 Tr /F1 12 Tf 70 500 Td (the words a machine read off this sheet) Tj ET',
    // Four lines of ordinary black type across the middle of the sheet,
    // painted before the pictures and buried by them: a scan run through
    // an OCR tool that did not bother to set the render mode.
    under: [0, 1, 2, 3].map((line) => `BT /F1 14 Tf 70 ${520 - line * 20} Td (the words a machine read off this sheet, in plain black ink) Tj ET`).join('\n'),
    stamp: 'BT /F1 7 Tf 30 22 Td (12) Tj ET',
    none: '',
  };
  const words = lines[said] ?? '';
  // Where the words go in the painting order is the whole question: over
  // the pictures they are a caption, under them they are hidden.
  const content = said === 'invisible' || said === 'under'
    ? `${words}\n${places.join('\n')}`
    : `${places.join('\n')}\n${words}`;
  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objects[2] = '<< /Type /Pages /Kids [3 0 R] /Count 1 >>';
  const turned = how.rotate ? ` /Rotate ${how.rotate}` : '';
  objects[3] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${page.width} ${page.height}]${turned}`
    + ' /Resources << /Font << /F1 5 0 R >> /XObject << /Im1 6 0 R >> >> /Contents 4 0 R >>';
  objects[4] = `<< /Length ${content.length} >>\nstream\n${content}\nendstream`;
  objects[5] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';
  objects[6] = '<< /Type /XObject /Subtype /Image /Width 8 /Height 8 /ColorSpace /DeviceRGB'
    + ` /BitsPerComponent 8 /Filter /ASCIIHexDecode /Length ${pixels.length + 1} >>\nstream\n${pixels}>\nendstream`;
  return assemble(objects);
}

/**
 * A page the way a scanner hands one over: not one picture of the sheet
 * but a stack of strips that together are the sheet. His 528-page book is
 * built this way -- eleven to thirty-three JPEGs a page -- and no single
 * one of them looks like a scan.
 */
export function scanPdf(strips: number, how: { ocr?: boolean } = {}): string {
  const objects: string[] = [];
  const page = { width: 595, height: 842 };
  const band = page.height / strips;
  const pixels = new Array(8 * 8 * 3).fill('f2').join('');
  const places: string[] = [];
  const words: string[] = [];
  for (let index = 0; index < strips; index += 1) {
    places.push(`q ${page.width} 0 0 ${band.toFixed(2)} 0 ${(index * band).toFixed(2)} cm /Im1 Do Q`);
    // A line of plain black OCR sitting across the join between this
    // strip and the next, so that no single strip covers it and only the
    // two of them together do.
    if (how.ocr && index) words.push(`BT /F1 14 Tf 40 ${(index * band - 5).toFixed(2)} Td (a line of words lying across the join between two strips) Tj ET`);
  }
  const content = [...words, ...places].join('\n');
  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objects[2] = '<< /Type /Pages /Kids [3 0 R] /Count 1 >>';
  objects[3] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${page.width} ${page.height}]`
    + ' /Resources << /Font << /F1 6 0 R >> /XObject << /Im1 5 0 R >> >> /Contents 4 0 R >>';
  objects[4] = `<< /Length ${content.length} >>\nstream\n${content}\nendstream`;
  objects[6] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';
  objects[5] = '<< /Type /XObject /Subtype /Image /Width 8 /Height 8 /ColorSpace /DeviceRGB'
    + ` /BitsPerComponent 8 /Filter /ASCIIHexDecode /Length ${pixels.length + 1} >>\nstream\n${pixels}>\nendstream`;
  return assemble(objects);
}

/**
 * A page in three bands of flat colour: red at the top, green across the
 * middle, blue at the foot.
 *
 * The engine hands a drawn page over as raw pixels and they go straight
 * onto a canvas, which is four bytes a pixel in an order nothing checks.
 * A page of grey text on white paper looks right whichever way round the
 * three channels are; this one does not.
 */
export function colourPdf(): string {
  const objects: string[] = [];
  const page = { width: 595, height: 842 };
  const band = page.height / 3;
  const content = [
    `0 0 1 rg 0 0 ${page.width} ${band.toFixed(2)} re f`,
    `0 1 0 rg 0 ${band.toFixed(2)} ${page.width} ${band.toFixed(2)} re f`,
    `1 0 0 rg 0 ${(band * 2).toFixed(2)} ${page.width} ${band.toFixed(2)} re f`,
  ].join('\n');
  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objects[2] = '<< /Type /Pages /Kids [3 0 R] /Count 1 >>';
  objects[3] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${page.width} ${page.height}] /Resources << >> /Contents 4 0 R >>`;
  objects[4] = `<< /Length ${content.length} >>\nstream\n${content}\nendstream`;
  return assemble(objects);
}

/** A document printed on more than one size of paper: a scan dropped into a
 *  thesis, a cover a few points narrower than the body, a table turned
 *  sideways. Every page carries its own MediaBox and nothing else differs,
 *  so what a spec measures off it is the layout's own doing. */
export function mixedPdf(sheets: Array<{ width: number; height: number }>): string {
  const objects: string[] = [];
  const pageIds: number[] = [];
  for (let index = 0, id = 3; index < sheets.length; index += 1, id += 2) pageIds.push(id);
  const fontId = 3 + sheets.length * 2;
  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objects[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${sheets.length} >>`;
  pageIds.forEach((id, index) => {
    const sheet = sheets[index];
    objects[id] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${sheet.width} ${sheet.height}]`
      + ` /Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${id + 1} 0 R >>`;
    const stream = `BT /F1 36 Tf 40 ${Math.round(sheet.height - 80)} Td (Page ${index + 1}) Tj ET`;
    objects[id + 1] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  });
  objects[fontId] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';
  return assemble(objects);
}
