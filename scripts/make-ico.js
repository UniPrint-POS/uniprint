const fs = require('fs');
const path = require('path');

const assetsDir = path.join(__dirname, '../assets');
const srcPng = path.join(assetsDir, 'uniprint_mini.png');
const outIco = path.join(assetsDir, 'uniprint.ico');

const pngData = fs.readFileSync(srcPng);

// Build a clean ICO with one entry: 256x256 (0,0 = 256 in ICO spec)
// Windows Vista+ ICO format allows a raw PNG blob as the image data.
// width=0, height=0 in the directory entry means 256x256.

const icoHeader = Buffer.alloc(6);
icoHeader.writeUInt16LE(0, 0); // reserved
icoHeader.writeUInt16LE(1, 2); // type: icon
icoHeader.writeUInt16LE(1, 4); // count: 1 entry

const dataOffset = 6 + 16; // header + one 16-byte directory entry

const dirEntry = Buffer.alloc(16);
dirEntry.writeUInt8(0, 0);              // width  (0 = 256)
dirEntry.writeUInt8(0, 1);              // height (0 = 256)
dirEntry.writeUInt8(0, 2);              // color count (0 = no palette)
dirEntry.writeUInt8(0, 3);              // reserved
dirEntry.writeUInt16LE(1, 4);           // planes
dirEntry.writeUInt16LE(32, 6);          // bit count
dirEntry.writeUInt32LE(pngData.length, 8);  // size of image data
dirEntry.writeUInt32LE(dataOffset, 12); // offset of image data

const result = Buffer.concat([icoHeader, dirEntry, pngData]);
fs.writeFileSync(outIco, result);

console.log('uniprint.ico built from uniprint_mini.png');
console.log('File size:', result.length, 'bytes');
