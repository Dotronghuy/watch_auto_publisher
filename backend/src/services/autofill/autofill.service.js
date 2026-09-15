import {
  ALL_BRANDS_VALUE,
  connectToSheet,
  filterRowsByBrand,
  findBrandHeader,
  readBrandFromRow,
} from './googleSheets.service.js';
import { buildPriceMap } from './excel.service.js';
import {
  createWatchScraper,
  scrapeWatchSpecs,
  generateMarketingContent,
  detectStrapFromSku,
  findCatalogDialColor,
  normalizeDialColor,
} from './productEnrichment.service.js';
import { createChatGPTTextSession, createGeminiTextSession } from '../playwright.service.js';
import fs from 'fs';
import path from 'path';

let isStopRequested = false;

export function stopAutoFill() {
  isStopRequested = true;
}

export async function runAutoFill(config, sendLog) {
  const {
    sheetUrl,
    excelPath,
    credentialsPath,
    aiTone,
    selectedBrand,
  } = config;

  isStopRequested = false;

  if (!fs.existsSync(credentialsPath)) {
    throw new Error('Không tìm thấy credentials.json. Vui lòng tải file lên.');
  }
  const credentials = JSON.parse(fs.readFileSync(credentialsPath, 'utf8'));

  let priceMap = new Map();
  if (excelPath && fs.existsSync(excelPath)) {
    sendLog('[Excel] Đang đọc bảng giá từ file Excel Sapo...');
    priceMap = buildPriceMap(excelPath);
    sendLog(`[Excel] ✅ Đã tải ${priceMap.size} SKU giá.`);
  } else {
    sendLog('[Excel] ⚠️ Không tìm thấy file Excel Sapo, bỏ qua bước điền giá.');
  }

  sendLog('[Sheets] Đang kết nối Google Sheets...');
  const doc = await connectToSheet(sheetUrl, credentials);
  const sheet = doc.sheetsByIndex[0];
  await sheet.loadHeaderRow();
  const allRows = await sheet.getRows();
  const brandHeader = findBrandHeader(sheet.headerValues);
  const rows = filterRowsByBrand(allRows, selectedBrand, brandHeader);
  sendLog(`[Sheets] ✅ Kết nối thành công! Tìm thấy ${allRows.length} dòng dữ liệu.`);
  sendLog(`[Sheets] ℹ️ Các cột hiện có: ${sheet.headerValues.join(', ')}`);

  if (selectedBrand === ALL_BRANDS_VALUE) {
    sendLog(`[Filter] ⚠️ Đã chọn TẤT CẢ THƯƠNG HIỆU: ${rows.length}/${allRows.length} dòng được đưa vào lượt chạy.`);
  } else {
    if (!brandHeader) {
      throw new Error('Không tìm thấy cột "Thương hiệu" trong tab đầu tiên của Google Sheet.');
    }
    if (rows.length === 0) {
      throw new Error(`Không tìm thấy SKU nào thuộc thương hiệu "${selectedBrand}".`);
    }
    sendLog(`[Filter] 🎯 Chỉ cào thương hiệu "${selectedBrand}": ${rows.length}/${allRows.length} dòng.`);
  }

  let processed = 0;
  let skipped = 0;
  const specsCache = new Map();
  const aiSharedCache = new Map();
  let scraperSession = null;
  let chatGptSession = null;
  let geminiSession = null;
  let sheetWriteQueue = Promise.resolve();
  const pendingAiJobs = [];
  const engineWorkers = [];

  const enqueueSheetWrite = (task) => {
    const queued = sheetWriteQueue.then(task, task);
    sheetWriteQueue = queued.catch(() => {});
    return queued;
  };

  const createEngineWorker = (name, session) => ({
    name,
    session,
    queue: Promise.resolve(),
    pending: 0,
    disabled: false,
  });

  const enqueueEngineJob = (worker, task) => {
    worker.pending++;
    const queued = worker.queue.then(() => task(worker));
    worker.queue = queued.catch(() => {}).finally(() => {
      worker.pending--;
    });
    return queued;
  };

  const getLeastBusyWorker = () => engineWorkers
    .filter((worker) => !worker.disabled)
    .sort((left, right) => left.pending - right.pending)[0] || null;

  try {
    sendLog('[Playwright] Đang khởi động trình cào dữ liệu tối ưu...');
    scraperSession = await createWatchScraper();
    sendLog('[Playwright] ✅ Trình cào Zenwatch đã sẵn sàng và sẽ được tái sử dụng cho toàn bộ danh sách.');

    const hasPendingAiRows = rows.some((row) => {
      const sku = (row.get('Mã sản phẩm') || row.get('SKU') || row.get('Mã SKU') || row.get('sản phẩm') || '').toString().trim();
      const shortDescription = row.get('Mô tả ngắn') || row.get('mo_ta_ngan') || '';
      return Boolean(sku && !shortDescription.toString().trim());
    });

    if (hasPendingAiRows) {
      sendLog('[AI] Đang khởi động song song ChatGPT và Gemini bằng hai profile Playwright riêng...');
      const [chatGptResult, geminiResult] = await Promise.allSettled([
        createChatGPTTextSession({
          log: sendLog,
          checkStop: () => isStopRequested,
          rateLimitStrategy: 'throw',
        }),
        createGeminiTextSession({
          log: sendLog,
          checkStop: () => isStopRequested,
        }),
      ]);

      if (chatGptResult.status === 'fulfilled') {
        chatGptSession = chatGptResult.value;
        engineWorkers.push(createEngineWorker('ChatGPT', chatGptSession));
      } else {
        sendLog(`[ChatGPT] ⚠️ Không thể khởi động: ${chatGptResult.reason?.message || chatGptResult.reason}`);
      }

      if (geminiResult.status === 'fulfilled') {
        geminiSession = geminiResult.value;
        engineWorkers.push(createEngineWorker('Gemini', geminiSession));
      } else {
        sendLog(`[Gemini] ⚠️ Không thể khởi động: ${geminiResult.reason?.message || geminiResult.reason}`);
      }

      if (engineWorkers.length === 0) {
        throw new Error('Không thể khởi động ChatGPT hoặc Gemini. Hãy đăng nhập lại hai tài khoản trong phần Cài đặt AI.');
      }
      sendLog(`[AI] ✅ Đã sẵn sàng ${engineWorkers.length} engine: ${engineWorkers.map((worker) => worker.name).join(' + ')}.`);
    }

    for (let i = 0; i < rows.length; i++) {
    if (isStopRequested) {
      sendLog('[System] 🛑 Tiến trình đã được dừng bởi người dùng.');
      break;
    }

    const row = rows[i];
    const sku = (row.get('Mã sản phẩm') || row.get('SKU') || row.get('Mã SKU') || row.get('sản phẩm') || '').toString().trim();
    if (!sku) continue;

    const brand = readBrandFromRow(row, brandHeader);
    
    const generalSku = sku.replace(/\d+$/, '');
    const baseModelCode = generalSku.split('-')[0];
    const matchNumber = baseModelCode.match(/\d+/);
    const modelNumber = matchNumber ? matchNumber[0] : '';
    const modelCacheKey = modelNumber || baseModelCode || generalSku;

    let salePriceRaw = row.get('Giá sale') || '';
    if (priceMap.has(sku)) {
      const p = priceMap.get(sku);
      if (p.salePrice) salePriceRaw = p.salePrice;
    }

    let calculatedSegment = '';
    if (salePriceRaw) {
      const salePriceNum = parseInt(salePriceRaw.toString().replace(/\D/g, ''), 10);
      if (!isNaN(salePriceNum)) {
        if (salePriceNum < 3000000) calculatedSegment = '< 3 triệu';
        else if (salePriceNum < 6000000) calculatedSegment = '3 - 5 triệu';
        else if (salePriceNum < 10000000) calculatedSegment = '5 - 10 triệu';
        else calculatedSegment = '> 10 triệu';
      }
    }

    const firstImagePath = row.get('Link ảnh sản phẩm') || null;
    const moTaNgan = row.get('Mô tả ngắn') || row.get('mo_ta_ngan') || '';
    
    if (moTaNgan.toString().trim()) {
      const phanKhuc = row.get('Phân khúc giá') || '';
      const quickUpdates = {};

      if (!phanKhuc.toString().trim() && calculatedSegment) {
        quickUpdates['Phân khúc giá'] = calculatedSegment;
        if (priceMap.has(sku)) {
          const p = priceMap.get(sku);
          if (p.salePrice) quickUpdates['Giá sale'] = p.salePrice;
          if (p.originalPrice) quickUpdates['Giá gốc'] = p.originalPrice;
        }
      }

      const knownDialColor = findCatalogDialColor(sku, firstImagePath);
      const currentDialColor = normalizeDialColor(row.get('Màu mặt số'));
      if (knownDialColor && currentDialColor !== knownDialColor) {
        quickUpdates['Màu mặt số'] = knownDialColor;
        sendLog(
          `[Color] 🔧 Sửa màu cũ của ${sku}: `
          + `"${row.get('Màu mặt số') || '(trống)'}" → "${knownDialColor}" `
          + `(đối chiếu đúng SKU + URL ảnh đã đồng bộ).`
        );
      }

      if (Object.keys(quickUpdates).length > 0) {
        try {
          await enqueueSheetWrite(async () => {
            const rowIndex = row.rowNumber - 1;
            await sheet.loadCells({
              startRowIndex: rowIndex,
              endRowIndex: rowIndex + 1,
              startColumnIndex: 0,
              endColumnIndex: sheet.headerValues.length
            });
            for (const [key, value] of Object.entries(quickUpdates)) {
              const colIndex = sheet.headerValues.indexOf(key);
              if (colIndex !== -1) {
                const cell = sheet.getCell(rowIndex, colIndex);
                cell.value = value;
              }
            }
            await sheet.saveUpdatedCells();
          });
          sendLog(`[Sheets] ⚡ Đã cập nhật nhanh dữ liệu xác minh cho SKU: ${sku}`);
        } catch (err) {
          sendLog(`[Sheets] ⚠️ Lỗi cập nhật nhanh cho ${sku}: ${err.message}`);
        }
      }

      if (!aiSharedCache.has(modelCacheKey)) {
        aiSharedCache.set(modelCacheKey, {
          phong_cach: row.get('Phong cách') || '',
          muc_do_luxury: row.get('Mức độ luxury') || '',
          lay_cam_hung_tu: row.get('Lấy cảm hứng từ') || '',
          phu_hop_voi_ai: row.get('Phù hợp với ai') || '',
          dip_su_dung: row.get('Dịp sử dụng') || '',
          tinh_cach_phu_hop: row.get('Tính cách phù hợp') || ''
        });
      }

      skipped++;
      continue;
    }

    sendLog(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    sendLog(`[${i + 1}/${rows.length}] Đang xử lý SKU: ${sku}`);

    const strapInfo = detectStrapFromSku(sku);
    if (strapInfo) sendLog(`[SKU] ✅ Phát hiện loại dây từ SKU suffix -${strapInfo.suffix}: ${strapInfo.strapType}`);
    else sendLog(`[SKU] ℹ️ Không có suffix dây nhận dạng được cho SKU: ${sku}`);

    const updates = {};

    if (isStopRequested) {
      sendLog('[System] 🛑 Tiến trình đã được dừng bởi người dùng.');
      break;
    }
    
    let specs = '';

    if (specsCache.has(generalSku)) {
      const cached = specsCache.get(generalSku);
      if (cached === null) {
        sendLog(`[Scrape] ⏭️ Bỏ qua SKU: ${sku} (đã xác nhận không có biến thể trên Zenwatch)`);
        skipped++;
        continue;
      }
      specs = cached;
      sendLog(`[Scrape] ⚡ Dùng cache thông số cho model: ${generalSku} (bỏ qua cào web)`);
    } else {
      try {
        specs = await scrapeWatchSpecs(
          sku,
          brand,
          sendLog,
          () => isStopRequested,
          scraperSession
        );
        specsCache.set(generalSku, specs);
        if (specs === null) {
          sendLog(`[Scrape] ⏭️ Bỏ qua SKU: ${sku} (không tìm thấy biến thể trên Zenwatch)`);
          skipped++;
          continue;
        }
      } catch (err) {
        if (err.message === 'STOP_REQUESTED') break;
        sendLog(`[Scrape] ⚠️ Lỗi cào web: ${err.message}`);
      }
    }

    if (specs) {
      const normalizedSpecs = specs.normalize('NFC');
      const preview = normalizedSpecs.slice(0, 400).replace(/[\n\r]+/g, ' | ');
      sendLog(`[Scrape] 📄 Preview thông số: ${preview}`);

      const matchField = (fieldNames) => {
        for (const fieldRaw of fieldNames) {
          const field = fieldRaw.normalize('NFC');
          const escapedField = field.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          const regex = new RegExp(`${escapedField}[:：]\\s*([^\\n\\r]+)`, 'i');
          const m = normalizedSpecs.match(regex);
          if (m) return m[1].trim().replace(/\u00a0/g, ' ');
        }
        return '';
      };

      const formatLoaiMay = (val) => {
        if (!val) return '';
        const v = val.toLowerCase();
        if (v.includes('cơ') || v.includes('automatic')) return 'Đồng Hồ Cơ (Automatic)';
        if (v.includes('pin') || v.includes('quartz')) return 'Đồng Hồ Pin/Quartz';
        return val;
      };

      const formatChatLieuDay = (val) => {
        if (!val) return '';
        const v = val.toLowerCase();
        if (v.includes('thép không gỉ 316l') || v.includes('thép không gỉ')) return 'Dây Thép Không Gỉ 316L Cao Cấp';
        if (v.includes('dây da') || v.includes('da cao cấp')) return 'Dây Da Cao Cấp';
        if (v.includes('silicon') || v.includes('cao su')) return 'Dây Cao Su Cao Cấp';
        return val;
      };

      const formatBaoHanh = (val) => {
        if (!val) return '';
        const v = val.toLowerCase();
        if (v.includes('5 năm')) return 'Bảo Hành 5 năm';
        if (v.includes('4 năm')) return 'Bảo Hành 48 tháng';
        if (v.includes('3 năm')) return 'Bảo Hành 36 tháng';
        if (v.includes('2 năm')) return 'Bảo Hành 24 tháng';
        if (v.includes('1 năm')) return 'Bảo Hành 12 tháng';
        const monthMatch = val.match(/(\d+)\s*tháng/i);
        if (monthMatch) return `Bảo Hành ${monthMatch[1]} tháng`;
        return val;
      };

      const formatMoTaChiuNuoc = (val) => {
        if (!val) return '';
        const v = val.toUpperCase();
        let meters = 0;
        const atmMatch = v.match(/(\d+)\s*ATM/);
        const barMatch = v.match(/(\d+)\s*BAR/);
        const mMatch = v.match(/(\d+)\s*M/);

        if (atmMatch) meters = parseInt(atmMatch[1]) * 10;
        else if (barMatch) meters = parseInt(barMatch[1]) * 10;
        else if (mMatch) meters = parseInt(mMatch[1]);

        if (meters >= 200) return 'Rửa tay, đi mưa, đi bơi, đi lặn thoải mái';
        if (meters >= 100) return 'Rửa tay, đi mưa, đi bơi thoải mái';
        if (meters >= 50) return 'Rửa tay, đi mưa thoải mái';
        if (meters >= 30) return 'Rửa tay, đi mưa nhẹ';
        return '';
      };

      const extractedFields = {
        'Kích thước mặt': matchField(['Đường kính mặt', 'Kích thước mặt', 'Size mặt']),
        'Độ dày': matchField(['Độ dày']),
        'Loại máy': formatLoaiMay(matchField(['Kiểu máy', 'Loại máy'])),
        'Chất liệu dây': strapInfo ? strapInfo.strapType : formatChatLieuDay(matchField(['Chất liệu dây'])),
        'Độ chịu nước': matchField(['Độ chịu nước']),
        'Mô tả độ chịu nước': formatMoTaChiuNuoc(matchField(['Độ chịu nước'])),
        'Bảo hành': formatBaoHanh(matchField(['Bảo hành', 'Thời gian bảo hành'])),
        'Chất liệu kính': matchField(['Mặt kính', 'Chất liệu kính']),
        'Chất liệu vỏ': matchField(['Chất liệu vỏ']),
      };

      const foundFields = Object.entries(extractedFields).filter(([, v]) => v).map(([k]) => k);
      const missingFields = Object.entries(extractedFields).filter(([, v]) => !v).map(([k]) => k);
      if (foundFields.length > 0) sendLog(`[Scrape] ✅ Điền được: ${foundFields.join(', ')}`);
      if (missingFields.length > 0) sendLog(`[Scrape] ⚠️ Không tìm thấy: ${missingFields.join(', ')}`);

      for (const [key, value] of Object.entries(extractedFields)) {
        if (value) updates[key] = value;
      }
    }

    if (isStopRequested) {
      sendLog('[System] 🛑 Tiến trình đã được dừng bởi người dùng.');
      break;
    }
    
    if (priceMap.has(sku)) {
      const p = priceMap.get(sku);
      if (p.salePrice) updates['Giá sale'] = p.salePrice;
      if (p.originalPrice) updates['Giá gốc'] = p.originalPrice;
    }
    if (calculatedSegment) {
      updates['Phân khúc giá'] = calculatedSegment;
    }

    const sheetSpecs = {
      'Kích thước mặt': row.get('Kích thước mặt') || updates['Kích thước mặt'] || '',
      'Độ dày': row.get('Độ dày') || updates['Độ dày'] || '',
      'Loại máy': row.get('Loại máy') || updates['Loại máy'] || '',
      'Xuất xứ máy': row.get('Xuất xứ máy') || updates['Xuất xứ máy'] || '',
      'Mô tả bộ máy': row.get('Mô tả bộ máy') || updates['Mô tả bộ máy'] || '',
      'Chất liệu vỏ': row.get('Chất liệu vỏ') || updates['Chất liệu vỏ'] || '',
      'Chất liệu dây': row.get('Chất liệu dây') || updates['Chất liệu dây'] || '',
      'Chất liệu kính': row.get('Chất liệu kính') || updates['Chất liệu kính'] || '',
      'Mô tả kính': row.get('Mô tả kính') || updates['Mô tả kính'] || '',
      'Độ chịu nước': row.get('Độ chịu nước') || updates['Độ chịu nước'] || '',
      'Mô tả độ chịu nước': row.get('Mô tả độ chịu nước') || updates['Mô tả độ chịu nước'] || ''
    };

    const savePreparedRow = async () => {
      if (isStopRequested) throw new Error('STOP_REQUESTED');
      try {
        await enqueueSheetWrite(async () => {
          const rowIndex = row.rowNumber - 1;
          await sheet.loadCells({
            startRowIndex: rowIndex,
            endRowIndex: rowIndex + 1,
            startColumnIndex: 0,
            endColumnIndex: sheet.headerValues.length
          });

          const technicalFields = new Set([
            'Kích thước mặt', 'Độ dày', 'Loại máy', 'Chất liệu vỏ', 'Chất liệu dây',
            'Chất liệu kính', 'Mặt kính', 'Độ chịu nước', 'Mô tả độ chịu nước', 'Bảo hành',
            'Xuất xứ máy', 'Mô tả bộ máy', 'Mô tả kính'
          ]);

          for (const [key, value] of Object.entries(updates)) {
            const colIndex = sheet.headerValues.indexOf(key);
            if (colIndex === -1) continue;
            const currentValue = row.get(key);
            if (technicalFields.has(key) && currentValue?.toString().trim()) continue;
            sheet.getCell(rowIndex, colIndex).value = value;
          }
          await sheet.saveUpdatedCells();
        });
        processed++;
        sendLog(`[Sheets] ✅ Đã lưu thành công SKU: ${sku} (${processed} đã xong)`);
      } catch (err) {
        if (err.message === 'STOP_REQUESTED') throw err;
        sendLog(`[Sheets] ❌ Lỗi lưu dòng ${sku}: ${err.message}`);
      }
    };

    const processWithEngine = async (worker) => {
      try {
        const aiData = await generateMarketingContent(
          sku,
          firstImagePath,
          specs,
          sendLog,
          () => isStopRequested,
          sheetSpecs,
          worker.session,
          aiTone
        );

        if (!aiSharedCache.has(modelCacheKey)) {
          aiSharedCache.set(modelCacheKey, {
            phong_cach: aiData.phong_cach || '',
            muc_do_luxury: aiData.muc_do_luxury || '',
            lay_cam_hung_tu: aiData.lay_cam_hung_tu || '',
            phu_hop_voi_ai: aiData.phu_hop_voi_ai || '',
            dip_su_dung: aiData.dip_su_dung || '',
            tinh_cach_phu_hop: aiData.tinh_cach_phu_hop || ''
          });
          sendLog(`[${worker.name}] 💾 Đã lưu cache thông tin chung cho model: ${modelCacheKey}`);
        }

        const sharedFields = aiSharedCache.get(modelCacheKey);
        Object.assign(updates, {
          // Chỉ sửa màu khi bộ đọc pixel có kết quả tin cậy.
          // Nếu ảnh không đủ rõ, giữ nguyên dữ liệu đang có thay vì xóa/đoán.
          'Màu mặt số': aiData.mau_mat_so || row.get('Màu mặt số') || '',
          'Mô tả ngắn': aiData.mo_ta_ngan || '',
          'Mô tả đầy đủ': aiData.mo_ta_day_du || '',
          'Phong cách': sharedFields.phong_cach,
          'Mức độ luxury': sharedFields.muc_do_luxury,
          'Lấy cảm hứng từ': sharedFields.lay_cam_hung_tu,
          'Phù hợp với ai': sharedFields.phu_hop_voi_ai,
          'Dịp sử dụng': sharedFields.dip_su_dung,
          'Tính cách phù hợp': sharedFields.tinh_cach_phu_hop,
          'Phối đồ': aiData.phoi_do || '',
        });
        sendLog(`[${worker.name}] ✅ Sinh nội dung xong cho SKU: ${sku}`);
      } catch (err) {
        if (err.message === 'STOP_REQUESTED') throw err;
        if (
          err.code === 'CHATGPT_HISTORY_RATE_LIMIT'
          || err.code === 'CHATGPT_UPLOAD_LIMIT'
          || err.code === 'GEMINI_RATE_LIMIT'
          || err.code === 'CHATGPT_SESSION_UNAVAILABLE'
          || err.code === 'GEMINI_SESSION_UNAVAILABLE'
          || err.code === 'CHATGPT_SEND_FAILED'
          || err.code === 'GEMINI_SEND_FAILED'
        ) throw err;
        sendLog(`[${worker.name}] ❌ Lỗi sinh content cho ${sku}: ${err.message}`);
      }

      await savePreparedRow();
    };

    const selectedWorker = getLeastBusyWorker();
    if (!selectedWorker) {
      sendLog(`[AI] ⚠️ Không còn engine khả dụng; chỉ lưu giá và thông số kỹ thuật cho SKU: ${sku}.`);
      pendingAiJobs.push(savePreparedRow().catch((err) => {
        if (err.message !== 'STOP_REQUESTED') sendLog(`[System] ❌ Lỗi xử lý SKU ${sku}: ${err.message}`);
      }));
      continue;
    }

    sendLog(`[AI] ➡️ Đã giao SKU ${sku} cho worker ${selectedWorker.name} (hàng đợi: ${selectedWorker.pending + 1}).`);
    const aiJob = enqueueEngineJob(selectedWorker, async (worker) => {
      if (worker.disabled) {
        const fallbackWorker = engineWorkers.find((candidate) => candidate.name === 'Gemini' && !candidate.disabled);
        if (worker.name === 'ChatGPT' && fallbackWorker) {
          sendLog(`[Failover] 🔄 SKU ${sku} trong hàng đợi ChatGPT được chuyển sang Gemini.`);
          await enqueueEngineJob(fallbackWorker, (candidate) => (
            candidate.disabled ? savePreparedRow() : processWithEngine(candidate)
          ));
        } else {
          await savePreparedRow();
        }
        return;
      }

      try {
        await processWithEngine(worker);
      } catch (err) {
        if (err.message === 'STOP_REQUESTED') throw err;
        if (
          worker.name === 'Gemini'
          && ['GEMINI_RATE_LIMIT', 'GEMINI_SESSION_UNAVAILABLE', 'GEMINI_SEND_FAILED'].includes(err.code)
        ) {
          worker.disabled = true;
          const reason = err.code === 'GEMINI_RATE_LIMIT'
            ? 'đang bị giới hạn'
            : err.code === 'GEMINI_SEND_FAILED'
              ? 'không xác nhận được thao tác gửi'
              : 'chưa sẵn sàng hoặc chưa đăng nhập';
          sendLog(`[Gemini] ⚠️ Gemini ${reason}; tạm ngừng worker Gemini trong lượt chạy này.`);
          await savePreparedRow();
          return;
        }
        if (
          worker.name !== 'ChatGPT'
          || ![
            'CHATGPT_HISTORY_RATE_LIMIT',
            'CHATGPT_UPLOAD_LIMIT',
            'CHATGPT_SESSION_UNAVAILABLE',
            'CHATGPT_SEND_FAILED',
          ].includes(err.code)
        ) throw err;

        worker.disabled = true;
        const reason = err.code === 'CHATGPT_UPLOAD_LIMIT'
          ? 'đã hết lượt tải ảnh'
          : err.code === 'CHATGPT_HISTORY_RATE_LIMIT'
            ? 'bị giới hạn gửi yêu cầu'
            : err.code === 'CHATGPT_SEND_FAILED'
              ? 'không xác nhận được thao tác gửi'
              : 'chưa sẵn sàng hoặc chưa đăng nhập';
        sendLog(`[ChatGPT] ⚠️ ${reason} tại SKU ${sku}; đã ngừng giao việc mới cho ChatGPT trong lượt chạy này.`);
        const geminiWorker = engineWorkers.find((candidate) => candidate.name === 'Gemini' && !candidate.disabled);
        if (geminiWorker) {
          sendLog(`[Failover] 🔄 Chuyển SKU ${sku} và toàn bộ việc còn lại sang Gemini.`);
          await enqueueEngineJob(geminiWorker, (candidate) => (
            candidate.disabled ? savePreparedRow() : processWithEngine(candidate)
          ));
        } else {
          sendLog(`[Failover] ⚠️ Gemini không khả dụng; chỉ lưu giá và thông số kỹ thuật cho SKU ${sku}.`);
          await savePreparedRow();
        }
      }
    }).catch((err) => {
      if (err.message !== 'STOP_REQUESTED') sendLog(`[System] ❌ Lỗi xử lý SKU ${sku}: ${err.message}`);
    });
    pendingAiJobs.push(aiJob);
    }

    await Promise.allSettled(pendingAiJobs);
    await sheetWriteQueue;
  } finally {
    if (chatGptSession) await chatGptSession.close();
    if (geminiSession) await geminiSession.close();
    if (scraperSession) await scraperSession.close();
    sendLog('[Playwright] Đã đóng các phiên trình duyệt an toàn.');
  }

  if (isStopRequested) {
    sendLog(`\n🛑 TIẾN TRÌNH ĐÃ DỪNG! Đã xử lý: ${processed} SKU | Đã bỏ qua: ${skipped} SKU`);
  } else {
    sendLog(`\n🎉 HOÀN TẤT! Đã xử lý: ${processed} SKU | Đã bỏ qua (đã có data): ${skipped} SKU`);
  }
  return { processed, skipped };
}
