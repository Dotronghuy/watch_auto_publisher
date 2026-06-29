import 'dotenv/config';
import { getFoldersInFolder, getImagesInFolder, getVideosInFolder } from '../services/drive.service.js';
import { writeToSheet } from '../services/sheets.service.js';

const ROOT_DRIVE_FOLDER_ID = process.env.ROOT_DRIVE_FOLDER_ID || '1MFAy8z4kghRCT4Z8tGsvVAqk_I02UCHl';

const scanDrive = async () => {
  console.log('🚀 Bắt đầu quét Google Drive để cập nhật lên Google Sheets...');

  try {
    const brandFolders = await getFoldersInFolder(ROOT_DRIVE_FOLDER_ID);
    const iwFolder = brandFolders.find(f => f.name.toLowerCase().includes('i&w carnival') || f.name.toLowerCase().includes('i&w'));
    
    if (!iwFolder) {
      console.error('❌ Không tìm thấy thư mục I&W Carnival trong Drive!');
      return;
    }

    const skuFolders = (await getFoldersInFolder(iwFolder.id)).filter(f => !f.name.toLowerCase().includes('review'));
    if (skuFolders.length === 0) {
      console.error('❌ Không tìm thấy thư mục SKU nào!');
      return;
    }

    console.log(`Tìm thấy ${skuFolders.length} thư mục SKU. Bắt đầu kiểm tra chi tiết...`);

    const results = [];
    let completed = 0;

    // Chạy tuần tự để tránh Google API Rate Limit
    for (const sku of skuFolders) {
      const row = {
        'Mã SKU': sku.name,
        '0_Anh_AVT': 'KHONG CO ANH',
        '1_Anh_Hang': 'KHONG CO ANH',
        '2_Anh_Tu_Chup': 'KHONG CO ANH',
        '3_Video_Doc': 'KHONG CO ANH',
        '4_Video_Ngang': 'KHONG CO ANH',
        'Kết Quả': 'OK'
      };

      const subFolders = await getFoldersInFolder(sku.id);
      
      const avtFolder = subFolders.find(f => f.name.includes('0_'));
      const hangFolder = subFolders.find(f => f.name.includes('1_') || f.name.toLowerCase().includes('hãng') || f.name.toLowerCase().includes('hang'));
      const tuChupFolder = subFolders.find(f => f.name.includes('2_') || f.name.toLowerCase().includes('tự') || f.name.toLowerCase().includes('tu'));
      const videoDocFolder = subFolders.find(f => f.name.includes('3_') || f.name.toLowerCase().includes('dọc') || f.name.toLowerCase().includes('doc'));
      const videoNgangFolder = subFolders.find(f => f.name.includes('4_') || f.name.toLowerCase().includes('ngang'));

      if (avtFolder) {
        const imgs = await getImagesInFolder(avtFolder.id);
        if (imgs.length > 0) row['0_Anh_AVT'] = 'OK';
      }
      
      if (hangFolder) {
        const imgs = await getImagesInFolder(hangFolder.id);
        if (imgs.length > 0) row['1_Anh_Hang'] = 'OK';
      }

      if (tuChupFolder) {
        const imgs = await getImagesInFolder(tuChupFolder.id);
        if (imgs.length > 0) row['2_Anh_Tu_Chup'] = 'OK';
      }

      if (videoDocFolder) {
        const vids = await getVideosInFolder(videoDocFolder.id);
        if (vids.length > 0) row['3_Video_Doc'] = 'OK';
      }

      if (videoNgangFolder) {
        const vids = await getVideosInFolder(videoNgangFolder.id);
        if (vids.length > 0) row['4_Video_Ngang'] = 'OK';
      }

      // Đánh giá kết quả
      if (row['0_Anh_AVT'] === 'KHONG CO ANH' || 
          row['1_Anh_Hang'] === 'KHONG CO ANH' || 
          row['2_Anh_Tu_Chup'] === 'KHONG CO ANH' ||
          row['3_Video_Doc'] === 'KHONG CO ANH' ||
          row['4_Video_Ngang'] === 'KHONG CO ANH') {
        row['Kết Quả'] = 'CO LOI';
      }

      results.push(row);
      completed++;
      
      if (completed % 10 === 0) {
        console.log(`Đã quét ${completed}/${skuFolders.length} SKU...`);
      }
    }

    console.log(`✅ Quét xong ${results.length} SKU. Đang đẩy dữ liệu lên Google Sheets...`);
    await writeToSheet(results);

  } catch (error) {
    console.error('❌ Lỗi trong quá trình quét Drive:', error);
  }
};

scanDrive();
