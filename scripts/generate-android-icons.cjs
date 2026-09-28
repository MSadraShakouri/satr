// Android launcher icons from icons/*.svg (as in piecework and insight):
// legacy square and round icons, and the Android 8+ adaptive icon (dark
// background, the glyph as foreground, a monochrome glyph for themed icons).
// The results are committed with android/, so CI doesn't need to run this:
//   npm run android:icons
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const ICONS = path.join(__dirname, '..', 'icons');
const RES = path.join(__dirname, '..', 'android', 'app', 'src', 'main', 'res');
const BACKGROUND = '#1e1e1e';
// Share of the 108dp adaptive canvas the glyph's artboard takes; keeps the
// glyph well inside the 66dp safe circle.
const ADAPTIVE_SCALE = 0.7;

const LEGACY = { 'mipmap-mdpi': 48, 'mipmap-hdpi': 72, 'mipmap-xhdpi': 96, 'mipmap-xxhdpi': 144, 'mipmap-xxxhdpi': 192 };
const ADAPTIVE = { 'mipmap-mdpi': 108, 'mipmap-hdpi': 162, 'mipmap-xhdpi': 216, 'mipmap-xxhdpi': 324, 'mipmap-xxxhdpi': 432 };

const svg = (name) => fs.readFileSync(path.join(ICONS, name));

async function centred(source, size, scale) {
  const art = Math.round(size * scale);
  const glyph = await sharp(source, { density: 600 }).resize(art, art).png().toBuffer();
  return sharp({ create: { width: size, height: size, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: glyph, left: Math.round((size - art) / 2), top: Math.round((size - art) / 2) }])
    .png();
}

async function main() {
  for (const [folder, size] of Object.entries(LEGACY)) {
    const dir = path.join(RES, folder);
    fs.mkdirSync(dir, { recursive: true });
    await sharp(svg('icon.svg'), { density: 600 }).resize(size, size).png().toFile(path.join(dir, 'ic_launcher.png'));
    const circle = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}" fill="${BACKGROUND}"/></svg>`);
    const glyph = await (await centred(svg('icon-foreground.svg'), size, 0.95)).toBuffer();
    await sharp(circle).composite([{ input: glyph }]).png().toFile(path.join(dir, 'ic_launcher_round.png'));
  }
  for (const [folder, size] of Object.entries(ADAPTIVE)) {
    const dir = path.join(RES, folder);
    await (await centred(svg('icon-foreground.svg'), size, ADAPTIVE_SCALE)).toFile(path.join(dir, 'ic_launcher_foreground.png'));
    await (await centred(svg('icon-monochrome.svg'), size, ADAPTIVE_SCALE)).toFile(path.join(dir, 'ic_launcher_monochrome.png'));
  }
  fs.writeFileSync(path.join(RES, 'values', 'ic_launcher_background.xml'),
    `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">${BACKGROUND}</color>\n</resources>\n`);
  const adaptive = '<?xml version="1.0" encoding="utf-8"?>\n<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">\n'
    + '    <background android:drawable="@color/ic_launcher_background" />\n'
    + '    <foreground android:drawable="@mipmap/ic_launcher_foreground" />\n'
    + '    <monochrome android:drawable="@mipmap/ic_launcher_monochrome" />\n</adaptive-icon>\n';
  const anydpi = path.join(RES, 'mipmap-anydpi-v26');
  fs.mkdirSync(anydpi, { recursive: true });
  fs.writeFileSync(path.join(anydpi, 'ic_launcher.xml'), adaptive);
  fs.writeFileSync(path.join(anydpi, 'ic_launcher_round.xml'), adaptive);
  // Capacitor's template drawables, replaced by the above.
  for (const stale of ['drawable-v24/ic_launcher_foreground.xml', 'drawable/ic_launcher_background.xml']) {
    fs.rmSync(path.join(RES, stale), { force: true });
  }
  // The web app's icon too (favicon, home screen).
  fs.mkdirSync(path.join(__dirname, '..', 'public'), { recursive: true });
  await sharp(svg('icon.svg'), { density: 600 }).resize(192, 192).png().toFile(path.join(__dirname, '..', 'public', 'icon-192.png'));
  console.log('Android launcher icons written.');
}

main().catch((error) => { console.error(error); process.exit(1); });
