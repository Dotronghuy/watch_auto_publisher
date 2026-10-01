import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { PrismaClient } from '@prisma/client';
import { liveLog } from '../utils/liveLog.js';
import { readJsonFileSync } from '../utils/json-file.js';

const prisma = new PrismaClient();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const settingsPath = path.join(__dirname, '../../config/settings.json');

const MIME_BY_EXT = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
};

const getMimeType = (filePath) => MIME_BY_EXT[path.extname(filePath).toLowerCase()] || 'image/png';

// Nén ảnh trước khi gửi (Gemini giới hạn request ~20MB; ảnh gốc từ Drive có thể vượt).
const compressImageForGemini = async (filePath) => {
    try {
        const sharp = (await import('sharp')).default;
        const buffer = await sharp(filePath, { failOn: 'none' })
            .rotate()
            .resize(1024, 1024, { fit: 'inside', withoutEnlargement: true })
            .flatten({ background: { r: 255, g: 255, b: 255 } })
            .jpeg({ quality: 85 })
            .toBuffer();
        if (buffer && buffer.length > 0) {
            return { data: buffer.toString('base64'), mimeType: 'image/jpeg' };
        }
    } catch (e) {
        console.warn(`[Gemini Ảnh] Không nén được ảnh ${path.basename(filePath)} (${e.message}) — gửi ảnh gốc.`);
    }
    return { data: fs.readFileSync(filePath).toString('base64'), mimeType: getMimeType(filePath) };
};

const imageToPart = async (filePath) => ({
    inlineData: await compressImageForGemini(filePath),
});

const getRandomSampleImageLocal = () => {
    try {
        const sampleDir = path.join(__dirname, '../../config/sample_images');
        if (!fs.existsSync(sampleDir)) return null;
        const validExt = ['.jpg', '.jpeg', '.png', '.webp'];
        const files = fs.readdirSync(sampleDir).filter(f => validExt.includes(path.extname(f).toLowerCase()));
        if (files.length === 0) return null;
        return path.join(sampleDir, files[Math.floor(Math.random() * files.length)]);
    } catch (e) {
        return null;
    }
};

const getGeminiKeys = async () => {
    const keys = [];
    try {
        const geminiSetting = await prisma.setting.findUnique({ where: { key: 'gemini_api_key' } });
        keys.push(...(geminiSetting?.value || '').split(',').map(k => k.trim()).filter(Boolean));
    } catch (e) {
        console.error('Lỗi đọc Gemini API Key từ DB:', e.message);
    }
    if (keys.length === 0) {
        try {
            if (fs.existsSync(settingsPath)) {
                const settings = readJsonFileSync(settingsPath);
                keys.push(...(settings.gemini_api_key || '').split(',').map(k => k.trim()).filter(Boolean));
            }
        } catch (e) {}
    }
    return keys;
};

const sleep = (ms, abortSignal) => new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    if (abortSignal) {
        abortSignal.addEventListener('abort', () => {
            clearTimeout(timer);
            reject(new Error('aborted'));
        });
    }
});

const saveImagePart = (imagePart, index) => {
    const outputPath = path.join(__dirname, `../../temp_images/gemini_gen_${Date.now()}_${index}.png`);
    fs.writeFileSync(outputPath, Buffer.from(imagePart.inlineData.data, 'base64'));
    return outputPath;
};

// Tạo ảnh qua Gemini API (Nano Banana Pro) — nhận ảnh đồng hồ + ảnh mẫu bố cục,
// giữ nguyên sản phẩm và chỉ thay bối cảnh theo prompt. Không cần trình duyệt.
export const generateBackgroundOnGemini = async (imagePath, promptsArray, abortSignal = null, sampleImagePath = null, isNewSession = true, extraWatchImages = []) => {
    console.log('\n--- BẮT ĐẦU TIẾN TRÌNH TẠO ẢNH GEMINI (API) ---');

    const keys = await getGeminiKeys();
    if (keys.length === 0) {
        liveLog('❌ Không có Gemini API Key nào được cấu hình để tạo ảnh!', 'error', 'System');
        return [];
    }

    let modelName = 'gemini-3-pro-image-preview';
    try {
        if (fs.existsSync(settingsPath)) {
            const settings = readJsonFileSync(settingsPath);
            modelName = settings.geminiImageModel || modelName;
        }
    } catch (e) {}

    const { GoogleGenerativeAI } = await import('@google/generative-ai');

    const outputPaths = [];
    const count = promptsArray.length;

    for (let i = 0; i < count; i++) {
        if (abortSignal?.aborted) throw new Error('aborted');
        console.log(`\n--- VẼ ẢNH ${i + 1}/${count} (Gemini) ---`);

        const currentPromptObj = promptsArray[i];
        const isString = typeof currentPromptObj === 'string';
        const currentPrompt = isString ? currentPromptObj : currentPromptObj.prompt;
        const promptSampleImage = isString ? null : currentPromptObj.sampleImage;

        let currentSampleImage = null;
        if (promptSampleImage && fs.existsSync(promptSampleImage)) {
            currentSampleImage = promptSampleImage;
        } else if (i === 0 && sampleImagePath && fs.existsSync(sampleImagePath)) {
            currentSampleImage = sampleImagePath;
        } else if (i > 0) {
            currentSampleImage = getRandomSampleImageLocal();
        }

        // Ảnh 1: ảnh sản phẩm gốc (đồng hồ phải giữ nguyên 100%)
        // Ảnh 2-5: ảnh tham khảo thực tế từ Drive
        // Ảnh cuối: ảnh bố cục mẫu (scene/background muốn tạo ra)
        const imageParts = [];
        if (imagePath && fs.existsSync(imagePath)) imageParts.push(await imageToPart(imagePath));
        for (const extraImg of extraWatchImages || []) {
            if (fs.existsSync(extraImg)) imageParts.push(await imageToPart(extraImg));
        }
        if (currentSampleImage && fs.existsSync(currentSampleImage)) imageParts.push(await imageToPart(currentSampleImage));
        if (imageParts.length > 6) imageParts.length = 6;

        const parts = [...imageParts, { text: currentPrompt }];
        let savedPath = null;
        let lastError = null;

        for (let keyIdx = 0; keyIdx < keys.length && !savedPath; keyIdx++) {
            if (abortSignal?.aborted) throw new Error('aborted');
            const ai = new GoogleGenerativeAI(keys[keyIdx]);
            const model = ai.getGenerativeModel({
                model: modelName,
                generationConfig: {
                    responseModalities: ['TEXT', 'IMAGE'],
                    imageConfig: { aspectRatio: '1:1' },
                },
            });

            let retryCount = 1;
            while (retryCount <= 3 && !savedPath) {
                try {
                    liveLog(`⏳ [Gemini] Đang tạo ảnh ${i + 1}/${count}...`, 'highlight', 'System');
                    const result = await model.generateContent(parts);
                    const candidate = result?.response?.candidates?.[0];
                    const imagePart = candidate?.content?.parts?.find(p => p?.inlineData?.data);
                    if (!imagePart) {
                        const text = (candidate?.content?.parts || []).map(p => p?.text || '').join(' ').trim();
                        throw new Error(text ? `Gemini không trả về ảnh (chỉ có text: ${text.slice(0, 120)})` : 'Gemini không trả về ảnh nào.');
                    }
                    savedPath = saveImagePart(imagePart, i);
                    outputPaths.push(savedPath);
                    console.log(`✅ [Gemini] Đã lưu ảnh: ${path.basename(savedPath)}`);
                } catch (error) {
                    lastError = error;
                    const msg = error?.message || '';
                    if (msg.includes('429') || msg.includes('503') || msg.includes('RESOURCE_EXHAUSTED') || msg.includes('rate limit') || msg.includes('quota')) {
                        console.warn(`[Gemini Ảnh] Key ${keyIdx + 1} bận (${msg}). Retry ${retryCount}/3...`);
                        await sleep(6000, abortSignal);
                        retryCount++;
                        continue;
                    }
                    if (msg.includes('aspectRatio') || msg.includes('imageConfig')) {
                        console.warn('[Gemini Ảnh] Model không hỗ trợ imageConfig — thử lại không kèm cấu hình ảnh...');
                        try {
                            const plainModel = ai.getGenerativeModel({
                                model: modelName,
                                generationConfig: { responseModalities: ['TEXT', 'IMAGE'] },
                            });
                            const result = await plainModel.generateContent(parts);
                            const imagePart = result?.response?.candidates?.[0]?.content?.parts?.find(p => p?.inlineData?.data);
                            if (!imagePart) throw new Error('Gemini vẫn không trả về ảnh.');
                            savedPath = saveImagePart(imagePart, i);
                            outputPaths.push(savedPath);
                            console.log(`✅ [Gemini] Đã lưu ảnh (không kèm imageConfig): ${path.basename(savedPath)}`);
                        } catch (e2) {
                            console.error(`[Gemini Ảnh] Lỗi key ${keyIdx + 1}: ${e2.message}`);
                            break;
                        }
                        break;
                    }
                    console.error(`[Gemini Ảnh] Lỗi key ${keyIdx + 1}: ${msg}`);
                    break;
                }
            }
        }

        if (!savedPath) {
            console.error(`❌ [Gemini Ảnh] Không tạo được ảnh ${i + 1}: ${lastError?.message || 'không rõ lý do'}`);
            liveLog(`❌ [Gemini] Không tạo được ảnh ${i + 1}: ${lastError?.message || 'không rõ lý do'}`, 'error', 'System');
        }
    }

    console.log('✅ Hoàn thành tiến trình Gemini!');
    return outputPaths;
};
