import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { generateBackgroundOnChatGPT } from './playwright.service.js';
import { generateBackgroundOnSD } from './sd.service.js';
import { generateBackgroundOnGemini } from './gemini-image.service.js';
import { resolveEngineOrder } from './image-engine-policy.js';
import { readJsonFileSync } from '../utils/json-file.js';
import { liveLog } from '../utils/liveLog.js';
import { sendAlert } from './alert.service.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const settingsPath = path.join(__dirname, '../../config/settings.json');
const rotationStatePath = path.join(__dirname, '../../config/image-engine-state.json');

const ENGINE_FUNCTIONS = {
  chatgpt: generateBackgroundOnChatGPT,
  gemini: generateBackgroundOnGemini,
  sd: generateBackgroundOnSD,
};

const readRotationState = () => {
  try {
    const state = JSON.parse(fs.readFileSync(rotationStatePath, 'utf8'));
    return state?.lastEngine === 'chatgpt' ? { lastEngine: 'chatgpt' } : { lastEngine: 'gemini' };
  } catch (e) {
    return { lastEngine: 'gemini' };
  }
};

// Mỗi lần gọi trả về engine kế tiếp (chatgpt ↔ gemini) và ghi nhớ lại để lần sau đảo chiều.
const getRotatedEngine = () => {
  const state = readRotationState();
  const next = state.lastEngine === 'chatgpt' ? 'gemini' : 'chatgpt';
  try {
    fs.writeFileSync(rotationStatePath, JSON.stringify({ lastEngine: next }));
  } catch (e) {}
  return next;
};

// Hàm tạo ảnh dùng chung: chọn engine theo settings.imageGenerationEngine
// (chatgpt | gemini | sd | rotate), nếu engine chính không trả về ảnh thì tự
// chuyển engine dự phòng — đảm bảo luồng luôn có ảnh.
export const generateImageWithEngine = async (imagePath, promptsArray, abortSignal = null, sampleImagePath = null, isNewSession = true, extraWatchImages = []) => {
  let engineSetting = 'chatgpt';
  try {
    if (fs.existsSync(settingsPath)) {
      const settings = readJsonFileSync(settingsPath);
      engineSetting = settings.imageGenerationEngine || 'chatgpt';
    }
  } catch (e) {}

  const rotatedEngine = engineSetting === 'rotate' ? getRotatedEngine() : 'chatgpt';
  const order = resolveEngineOrder(engineSetting, rotatedEngine);
  let lastError = null;

  for (let idx = 0; idx < order.length; idx++) {
    const engine = order[idx];
    const generate = ENGINE_FUNCTIONS[engine];
    if (!generate) continue;
    try {
      liveLog(`🎨 Bắt đầu tạo ảnh bằng engine ${engine.toUpperCase()}...`, 'info', 'System');
      const paths = await generate(imagePath, promptsArray, abortSignal, sampleImagePath, isNewSession, extraWatchImages);
      if (paths && paths.length > 0) {
        if (idx > 0) {
          liveLog(`✅ Engine dự phòng ${engine.toUpperCase()} đã tạo được ${paths.length} ảnh.`, 'success', 'System');
        }
        return paths;
      }
      lastError = new Error(`Engine ${engine.toUpperCase()} không trả về ảnh nào.`);
    } catch (error) {
      if (abortSignal?.aborted) throw error;
      lastError = error;
      console.error(`❌ Engine tạo ảnh ${engine.toUpperCase()} thất bại: ${error.message}`);
    }

    const nextEngine = order[idx + 1];
    if (nextEngine) {
      liveLog(`⚠️ Engine ${engine.toUpperCase()} không tạo được ảnh — chuyển sang engine dự phòng ${nextEngine.toUpperCase()}...`, 'warning', 'System');
      await sendAlert({
        type: 'system',
        title: `Tạo ảnh ${engine.toUpperCase()} thất bại — chuyển ${nextEngine.toUpperCase()}`,
        details: `Engine ${engine.toUpperCase()} không trả về ảnh (${lastError?.message || 'không rõ lý do'}).\nHệ thống tự chuyển sang ${nextEngine.toUpperCase()} để đảm bảo luồng vẫn có ảnh.`,
      });
    }
  }

  liveLog('❌ Tất cả engine tạo ảnh đều thất bại — không có ảnh cho luồng này.', 'error', 'System');
  return [];
};
