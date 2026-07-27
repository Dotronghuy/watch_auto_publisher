import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareRowsWithFocusBySku } from './sheets.service.js';

test('giữ Tập Trung theo SKU khi thứ tự dòng thay đổi', () => {
  const currentData = [
    { 'Mã SKU': '751L-T10', 'Tập Trung': '1*' },
    { 'Mã SKU': '538L-T2', 'Tập Trung': '0' },
    { 'Mã SKU': '751L-T2', 'Tập Trung': '2' },
  ];
  const scannedData = [
    { 'Mã SKU': '751L-T2' },
    { 'Mã SKU': '751L-T10' },
    { 'Mã SKU': '538L-T2' },
  ];

  const result = prepareRowsWithFocusBySku(scannedData, currentData);

  assert.deepEqual(
    result.map(item => [item['Mã SKU'], item['Tập Trung']]),
    [
      ['538L-T2', '0'],
      ['751L-T2', '2'],
      ['751L-T10', '1*'],
    ],
  );
});

test('ưu tiên giá trị Tập Trung được truyền vào và mặc định SKU mới là 0', () => {
  const currentData = [
    { 'Mã SKU': '751L-T1', 'Tập Trung': '1*' },
  ];
  const newData = [
    { 'Mã SKU': '751L-T1', 'Tập Trung': '2' },
    { 'Mã SKU': '999L-T1' },
  ];

  const result = prepareRowsWithFocusBySku(newData, currentData);

  assert.equal(result.find(item => item['Mã SKU'] === '751L-T1')['Tập Trung'], '2');
  assert.equal(result.find(item => item['Mã SKU'] === '999L-T1')['Tập Trung'], '0');
});

test('giữ đúng giá trị số 0 đọc từ Google Sheets', () => {
  const result = prepareRowsWithFocusBySku(
    [{ 'Mã SKU': '751L-T1' }],
    [{ 'Mã SKU': '751L-T1', 'Tập Trung': 0 }],
  );

  assert.equal(result[0]['Tập Trung'], '0');
});
