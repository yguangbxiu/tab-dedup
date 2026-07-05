import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { execSync } from 'child_process';
import { tmpdir } from 'os';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const iconsDir = path.join(__dirname, '..', 'icons');
const tmp = path.join(tmpdir(), 'tab-dedup-icon-resize');

async function loadResvg() {
  try {
    return await import('@resvg/resvg-js');
  } catch {
    fs.mkdirSync(tmp, { recursive: true });
    execSync('npm install @resvg/resvg-js --no-save', { stdio: 'inherit', cwd: tmp });
    return import(pathToFileURL(path.join(tmp, 'node_modules/@resvg/resvg-js/index.js')).href);
  }
}

const { Resvg } = await loadResvg();

function renderSvg(svgPath, outPath, width, height) {
  const svg = fs.readFileSync(svgPath, 'utf8');
  const resvg = new Resvg(svg, {
    fitTo: { mode: 'width', value: width },
    background: 'transparent',
  });
  const pngData = resvg.render();
  const pngBuffer = pngData.asPng();
  fs.writeFileSync(outPath, pngBuffer);
  console.log(`Wrote ${outPath} (${width}x${height})`);
}

renderSvg(path.join(iconsDir, 'icon-16.svg'), path.join(iconsDir, 'icon16.png'), 16, 16);
renderSvg(path.join(iconsDir, 'icon-master.svg'), path.join(iconsDir, 'icon48.png'), 48, 48);
renderSvg(path.join(iconsDir, 'icon-master.svg'), path.join(iconsDir, 'icon128.png'), 128, 128);
