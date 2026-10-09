import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getFoldersInFolder, getFolderIdByName, getVideosInFolder, downloadFileFromDrive } from './drive.service.js';
import { addPostMetric } from '../utils/history.js';
import { publishFBStoryVideo } from './meta.service.js';
import { addMusicToVideo, hasAudioStream, toStoryFormat } from './video.service.js';
import { liveLog } from '../utils/liveLog.js';
import { readJsonFileSync, writeJsonFileSync } from '../utils/json-file.js';
import { sendAlert } from './alert.service.js';
import { addNotification } from './notification.service.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const settingsPath = path.join(__dirname, '../../config/settings.json');
const storyHistoryPath = path.join(__dirname, '../../config/story_history.json');
const ROOT_DRIVE_FOLDER_ID = process.env.ROOT_DRIVE_FOLDER_ID || '1MFAy8z4kghRCT4Z8tGsvVAqk_I02UCHl';

const STORY_HISTORY_LIMIT = 500;

let isStoryRoutineRunning = false;

const readStoryHistory = () => {
  try {
    if (fs.existsSync(storyHistoryPath)) {
      const data = readJsonFileSync(storyHistoryPath);
      return { postedVideoIds: Array.isArray(data?.postedVideoIds) ? data.postedVideoIds : [] };
    }
  } catch (error) {
    console.warn('Không đọc được story_history.json:', error.message);
  }
  return { postedVideoIds: [] };
};

const saveStoryHistory = (history) => {
  writeJsonFileSync(storyHistoryPath, {
    postedVideoIds: (history.postedVideoIds || []).slice(-STORY_HISTORY_LIMIT)
  });
};

/**
 * Luồng job Story RIÊNG BIỆT với luồng đăng newfeeds:
 * - Lấy 1 video mới từ thư mục 3_Video_Doc của một SKU ngẫu nhiên
 * - Video có nhạc thì giữ nguyên; không có nhạc thì ghép nhạc từ music_library
 * - Chuyển 9:16 (1080x1920, tối đa 60s) rồi đăng lên Story Facebook
 * - Lịch sử story được lưu RIÊNG trong config/story_history.json (không ảnh hưởng tiến độ newfeeds)
 */
export const autoStoryRoutine = async () => {
  if (isStoryRoutineRunning) {
    throw new Error('Luồng Story đang chạy, bỏ qua job trùng lặp.');
  }
  isStoryRoutineRunning = true;

  const tempFiles = [];
  try {
    const settings = fs.existsSync(settingsPath) ? readJsonFileSync(settingsPath) : {};
    if (!(settings.storyEnabled === true || settings.storyEnabled === 'true')) {
      console.log('⏭️ [Story] storyEnabled chưa bật trong settings.json, bỏ qua job.');
      return { storyPosted: false, skipped: 'disabled' };
    }

    // Danh sách tài khoản Facebook có token
    const accountsPath = path.join(__dirname, '../../config/accounts.json');
    let accounts = [];
    try {
      accounts = Array.isArray(JSON.parse(fs.readFileSync(accountsPath, 'utf8')))
        ? JSON.parse(fs.readFileSync(accountsPath, 'utf8'))
        : [];
    } catch (e) { /* ignore */ }

    const candidates = [];
    const seenTokens = new Set();
    const addCandidate = (name, token) => {
      if (token && !seenTokens.has(token)) {
        seenTokens.add(token);
        candidates.push({ name, token });
      }
    };
    // Token page .env luôn được dùng (kể cả khi accounts.json có token hết hạn)
    if (process.env.FB_PAGE_ACCESS_TOKEN) {
      addCandidate('Vua Đồng Hồ (.env)', process.env.FB_PAGE_ACCESS_TOKEN);
    }
    for (const acc of accounts.filter(a => a?.isActive !== false)) {
      addCandidate(acc.name || 'Tài khoản Facebook', acc.fbAccessToken || process.env.FB_PAGE_ACCESS_TOKEN);
    }
    if (candidates.length === 0) {
      throw new Error('Không có token Facebook nào để đăng Story.');
    }

    // 1. Chọn 1 video mới từ 3_Video_Doc của một SKU ngẫu nhiên
    const history = readStoryHistory();
    const postedVideoIds = new Set(history.postedVideoIds);

    const brandFolders = await getFoldersInFolder(ROOT_DRIVE_FOLDER_ID);
    const validBrands = brandFolders.filter(
      (f) => !f.name.toLowerCase().includes('template') && !f.name.toLowerCase().includes('review')
    );
    let skuFolders = [];
    for (const brand of validBrands) {
      const brandSkus = await getFoldersInFolder(brand.id);
      skuFolders = skuFolders.concat(brandSkus.filter((f) => !f.name.toLowerCase().includes('review')));
    }
    if (skuFolders.length === 0) throw new Error('Không tìm thấy thư mục SKU nào trong Drive!');

    const shuffledSkus = skuFolders.sort(() => 0.5 - Math.random());
    let chosenVideo = null;
    let chosenSkuName = null;
    for (const skuFolder of shuffledSkus) {
      const videoFolderId = await getFolderIdByName('3_Video_Doc', skuFolder.id);
      if (!videoFolderId) continue;
      const videos = await getVideosInFolder(videoFolderId);
      const freshVideos = videos.filter((v) => !postedVideoIds.has(v.id));
      if (freshVideos.length > 0) {
        chosenVideo = freshVideos[Math.floor(Math.random() * freshVideos.length)];
        chosenSkuName = skuFolder.name;
        break;
      }
    }

    if (!chosenVideo) {
      console.log('⚠️ [Story] Không còn video mới trong 3_Video_Doc. Bỏ qua lượt này.');
      return { storyPosted: false, skipped: 'no-fresh-video' };
    }

    liveLog(`🎬 [Story] Đã chọn video ${chosenVideo.name} (SKU: ${chosenSkuName})`, 'info', 'System');

    // 2. Tải video về máy
    let videoPath = await downloadFileFromDrive(chosenVideo.id, chosenVideo.name);
    tempFiles.push(videoPath);

    // 3. Nhạc: video có nhạc thì giữ nguyên, không có thì ghép nhạc ngẫu nhiên
    const musicDir = path.join(process.cwd(), 'music_library');
    if (fs.existsSync(musicDir)) {
      const hasAudio = await hasAudioStream(videoPath);
      if (hasAudio) {
        liveLog('🎵 [Story] Video đã có âm thanh gốc, giữ nguyên.', 'info', 'System');
      } else {
        const musicFiles = fs.readdirSync(musicDir).filter((f) => f.toLowerCase().endsWith('.mp3'));
        if (musicFiles.length > 0) {
          const randomMusic = musicFiles[Math.floor(Math.random() * musicFiles.length)];
          const mixedPath = videoPath.replace(/\.[^/.]+$/, `_mixed_${Date.now()}.mp4`);
          try {
            videoPath = await addMusicToVideo(videoPath, path.join(musicDir, randomMusic), mixedPath);
            tempFiles.push(videoPath);
            liveLog(`🎵 [Story] Video không có nhạc, đã ghép nhạc: ${randomMusic}`, 'info', 'System');
          } catch (musicErr) {
            console.warn(`⚠️ [Story] Ghép nhạc lỗi (${musicErr.message}), dùng video gốc.`);
          }
        }
      }
    }

    // 4. Chuyển định dạng Story 9:16 (1080x1920, tối đa 60 giây)
    const storyOutPath = videoPath.replace(/\.[^/.]+$/, `_story_${Date.now()}.mp4`);
    try {
      videoPath = await toStoryFormat(videoPath, storyOutPath);
      tempFiles.push(videoPath);
    } catch (fmtErr) {
      liveLog(`⚠️ [Story] Không chuyển được định dạng 9:16 (${fmtErr.message}), dùng video gốc.`, 'warning', 'System');
    }

    // 5. Đăng Story cho từng tài khoản có token sống
    let postedCount = 0;
    let hardErrorCount = 0;
    for (const account of candidates) {
      try {
        const storyId = await publishFBStoryVideo(videoPath, { fbAccessToken: account.token });
        if (storyId) {
          postedCount++;
          try {
            await addPostMetric('facebook_story', storyId, chosenSkuName, '', { accountId: account.name });
          } catch (metricError) {
            console.warn(`⚠️ [Story] Đã đăng nhưng không lưu được metric: ${metricError.message}`);
          }
          liveLog(`✅ [Story] Đăng Story thành công cho ${account.name}! (ID: ${storyId})`, 'success', 'Facebook');
          addNotification({
            type: 'publish-success',
            title: 'Đã đăng Facebook Story',
            details: `SKU ${chosenSkuName} (${account.name})`
          });
        }
      } catch (e) {
        const code = e.response?.data?.error?.code;
        const msg = e.response?.data?.error?.message || e.message;
        if (code === 190) {
          console.warn(`⚠️ [Story] Token của ${account.name} hết hạn, bỏ qua tài khoản này.`);
          continue;
        }
        hardErrorCount++;
        liveLog(`❌ [Story] Lỗi đăng Story cho ${account.name}: ${msg}`, 'error', 'Facebook');
        await sendAlert({
          type: 'publish-error',
          title: 'Lỗi đăng Facebook Story',
          details: `Tài khoản: ${account.name}\nSKU: ${chosenSkuName}\nLỗi: ${msg}`
        });
      }
    }

    if (postedCount === 0) {
      if (hardErrorCount === 0) {
        console.warn('⚠️ [Story] Tất cả token Facebook đều hết hạn. Bỏ qua lượt này.');
        return { storyPosted: false, skipped: 'expired-tokens' };
      }
      throw new Error('Không có tài khoản nào đăng Story thành công.');
    }

    // 6. Ghi lịch sử story RIÊNG (không ảnh hưởng tiến độ đăng newfeeds)
    history.postedVideoIds = [...postedVideoIds, chosenVideo.id];
    saveStoryHistory(history);

    return { storyPosted: true, sku: chosenSkuName, video: chosenVideo.name, accounts: postedCount };
  } finally {
    for (const file of tempFiles) {
      try {
        if (fs.existsSync(file)) fs.unlinkSync(file);
      } catch (e) { /* ignore */ }
    }
    isStoryRoutineRunning = false;
  }
};
