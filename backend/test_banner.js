import { generateCollectionBanner } from './src/services/banner.service.js';
import path from 'path';

const mockImages = [
  path.resolve('uploads/SapoImages/19069-A1-T1_1781625719743.jpg'),
  path.resolve('uploads/SapoImages/19069-A1-T1_1781625858367.jpg'),
  path.resolve('uploads/SapoImages/19069-A1-T2_1781625719760.jpg')
];

async function runTest() {
  console.log('Chạy Test Script Tạo Banner...');
  try {
    const resultPath = await generateCollectionBanner(mockImages, '19069-A1');
    console.log('✅ TEST THÀNH CÔNG:', resultPath);
  } catch (error) {
    console.error('❌ LỖI:', error);
  }
}

runTest();
