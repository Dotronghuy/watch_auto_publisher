const xlsx = require('xlsx');
const fs = require('fs');

const EXCEL_PATH = 'C:/Users/Admin/Downloads/danh_sach_san_pham_20.06.2026_7c1dfb5a769d90a671894b0844c41e4f.xlsx';
const SHEET_ID = '1y2U9cuBNTT6SoHNHsHycLqVlwVM9yjvsSp6Nq2DPwxo';

// 1. Đọc Excel
const wb = xlsx.readFile(EXCEL_PATH);
const ws = wb.Sheets[wb.SheetNames[0]];
const data = xlsx.utils.sheet_to_json(ws, { header: 1 });
const header = data[0];

const skuCol = 1;  // Cột B = Mã SKU
const giaCtvCol = 5; // Cột F = PL_Giá cộng tác viên
console.log('Excel: SKU =', header[skuCol], '| Giá CTV =', header[giaCtvCol]);

const priceMap = {};
for (let i = 1; i < data.length; i++) {
  const row = data[i];
  const sku = row[skuCol] ? String(row[skuCol]).trim() : '';
  const price = row[giaCtvCol];
  if (sku && price != null && price !== '') {
    priceMap[sku] = price;
  }
}
console.log('Total SKU co gia CTV:', Object.keys(priceMap).length);

function getColLetter(n) {
  let l = '';
  while (n >= 0) {
    l = String.fromCharCode(65 + (n % 26)) + l;
    n = Math.floor(n / 26) - 1;
  }
  return l;
}

async function run() {
  // 2. Doc Google Sheet
  console.log('\nDang doc Google Sheet...');
  const res = await fetch(`https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=0`);
  const csv = await res.text();
  const swb = xlsx.read(csv, { type: 'string' });
  const sws = swb.Sheets[swb.SheetNames[0]];
  const sd = xlsx.utils.sheet_to_json(sws, { header: 1 });
  const sh = sd[0];

  const sSkuCol = sh.findIndex(h => String(h || '').includes('Mã sản phẩm'));
  const sCtvCol = sh.findIndex(h => String(h || '') === 'Giá CTV');
  console.log('Sheet: SKU col=' + sSkuCol + ' (' + sh[sSkuCol] + '), CTV col=' + sCtvCol + ' (' + sh[sCtvCol] + ')');

  const colLetter = getColLetter(sCtvCol);
  console.log('Col letter:', colLetter);

  // 3. Match
  const rowMap = {};
  let match = 0;
  let noMatch = 0;
  for (let i = 1; i < sd.length; i++) {
    const row = sd[i];
    const sku = row[sSkuCol] ? String(row[sSkuCol]).trim() : '';
    if (sku && priceMap[sku] !== undefined) {
      rowMap[i + 1] = priceMap[sku];
      match++;
    } else if (sku) {
      noMatch++;
    }
  }
  console.log('Match:', match, '| No match:', noMatch);

  // 4. Tao Google Apps Script
  const scriptContent = `function updateGiaCTV() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Products");
  var data = ${JSON.stringify(rowMap)};
  var count = 0;
  for (var row in data) {
    sheet.getRange("${colLetter}" + row).setValue(data[row]);
    count++;
  }
  SpreadsheetApp.getUi().alert("Da cap nhat Gia CTV cho " + count + " san pham!");
}`;

  const outputPath = 'C:/Users/Admin/Downloads/update_gia_ctv.gs';
  fs.writeFileSync(outputPath, scriptContent);
  console.log('\nDa luu Google Apps Script tai:', outputPath);
  console.log('\nHUONG DAN:');
  console.log('1. Mo Google Sheet: https://docs.google.com/spreadsheets/d/' + SHEET_ID);
  console.log('2. Vao menu Extensions > Apps Script');
  console.log('3. Xoa het code cu, dan noi dung file update_gia_ctv.gs vao');
  console.log('4. Bam nut Run (tam giac) > chon updateGiaCTV');
  console.log('5. Cap quyen va doi ~30 giay');
  console.log('=> Se tu dong dien Gia CTV vao cot ' + colLetter + ' cho ' + match + ' san pham!');
}

run().catch(console.error);
