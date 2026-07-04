// 临时脚本：修正 main.js 中的 fmtExif 调用方式
const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'main.js');
let src = fs.readFileSync(filePath, 'utf8');

// 修正 refreshResultPage 中的错误调用
// 错误：fmtExif(exif.make || exif.Make) → 应该是 fmtExif(exif, 'Make')
const corrections = [
  [/fmtExif\(exif\.make\s*\|\|\s*exif\.Make\)/g, 'fmtExif(exif, "Make")'],
  [/fmtExif\(exif\.model\s*\|\|\s*exif\.Model\)/g, 'fmtExif(exif, "Model")'],
  [/fmtExif\(exif\.aperture\s*\|\|\s*exif\.ApertureValue[^)]*\)/g, 'fmtExif(exif, "Aperture")'],
  [/fmtExif\(exif\.shutter\s*\|\|\s*exif\.ExposureTime[^)]*\)/g, 'fmtExif(exif, "Shutter")'],
  [/fmtExif\(\'ISO \'\s*\+\s*\(exif\.iso[^)]*\)/gi, 'fmtExif(exif, "ISO")'],
  [/fmtExif\(exif\.focal\s*\|\|\s*exif\.FocalLength\)/g, 'fmtExif(exif, "Focal")'],
  // handleFile 中的调用
  [/fmtExif\(aperture,\s*'f'\)/g, 'fmtExif(exif, "Aperture")'],
  [/fmtExif\(shutter,\s*'shutter'\)/g, 'fmtExif(exif, "Shutter")'],
  [/fmtExif\(focal,\s*'focal'\)/g, 'fmtExif(exif, "Focal")'],
];

let changed = 0;
corrections.forEach(([re, replacement]) => {
  const before = src;
  src = src.replace(re, replacement);
  if (src !== before) changed++;
});

// 也确保 setInfoVal 函数正确
if (!src.includes('row.classList.toggle')) {
  src = src.replace(
    /function setInfoVal\(id, val\) \{[^}]+\}/s,
    `function setInfoVal(id, val) {
  const el = document.getElementById(id);
  if (!el) return;
  const str = (val === null || val === undefined) ? "--" : String(val);
  el.textContent = str;
  const row = el.closest('.info-row, .meta-row');
  if (row) row.classList.toggle('hidden-row', str === '--');
}`
  );
  changed++;
}

fs.writeFileSync(filePath, src, 'utf8');
console.log(`Done! ${changed} pattern(s) fixed.`);
