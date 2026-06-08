import 'dotenv/config';
import { readFromSheet, writeToSheet } from '../services/sheets.service.js';

const applyFormat = async () => {
  try {
    console.log('Đang đọc dữ liệu hiện tại từ Sheet...');
    const data = await readFromSheet();
    if (data && data.length > 0) {
      console.log('Đang ghi lại và format Sheet...');
      await writeToSheet(data);
    } else {
      console.log('Không có dữ liệu để format.');
    }
  } catch (error) {
    console.error(error);
  }
};

applyFormat();
