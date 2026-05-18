const fs = require('fs');
const path = require('path');
const pngToIco = require('png-to-ico');

const repoRoot = path.join(__dirname, '..');
const pngDir = path.join(repoRoot, 'icons', 'png');
const outDir = path.join(repoRoot, 'icons', 'win');

const candidates = [
  '16x16.png','24x24.png','32x32.png','48x48.png','64x64.png','128x128.png','256x256.png'
];

const files = candidates.map(f => path.join(pngDir, f)).filter(fs.existsSync);

if (files.length === 0) {
  console.error('No PNG icon sources found in', pngDir);
  process.exit(1);
}

pngToIco(files)
  .then(buffer => {
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
    const outPath = path.join(outDir, 'icon.ico');
    fs.writeFileSync(outPath, buffer);
    console.log('Generated', outPath);
  })
  .catch(err => {
    console.error('Failed to generate icon.ico:', err);
    process.exit(1);
  });
