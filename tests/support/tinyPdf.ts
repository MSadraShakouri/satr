/** A small, real PDF of as many pages as asked for, built here so the specs
 *  never need a file checked in beside them. Shared by the specs that open a
 *  document from the vault and the one that imports it from the device.
 */
export function tinyPdf(pages: number, darkPages: number[] = []): string {
  const objects: string[] = [];
  const pageIds: number[] = [];
  for (let index = 0, id = 3; index < pages; index += 1, id += 2) pageIds.push(id);
  const fontId = 3 + pages * 2;
  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
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

/** The same document as the bytes a file chooser would hand over. */
export function tinyPdfBytes(pages: number): Buffer {
  return Buffer.from(tinyPdf(pages).slice('data:application/pdf;base64,'.length), 'base64');
}
