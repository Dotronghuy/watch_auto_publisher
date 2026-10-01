import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import sharp from 'sharp';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SCREENSHOT_DIR = path.join(__dirname, '../../debug_screenshots');
const REFERENCE_DIR = path.join(SCREENSHOT_DIR, 'reference');

// Ngưỡng % pixel khác biệt ở vùng khung giao diện để coi là "giao diện đã đổi"
const UI_CHANGE_THRESHOLD = 0.25;

// Chỉ so sánh vùng "khung giao diện" (header trên cùng + vùng ô nhập dưới cùng)
// để không bị nhiễu bởi nội dung hội thoại mới xuất hiện sau mỗi lệnh.
const buildUiSignature = async (imagePath) => {
    const img = sharp(imagePath);
    const meta = await img.metadata();
    const width = meta.width || 1280;
    const height = meta.height || 720;
    const topStrip = await sharp(imagePath)
        .extract({ left: 0, top: 0, width, height: Math.max(1, Math.round(height * 0.22)) })
        .resize(64, 64, { fit: 'fill' }).greyscale().raw().toBuffer();
    const bottomTop = Math.round(height * 0.72);
    const bottomStrip = await sharp(imagePath)
        .extract({ left: 0, top: bottomTop, width, height: Math.max(1, height - bottomTop) })
        .resize(64, 64, { fit: 'fill' }).greyscale().raw().toBuffer();
    return Buffer.concat([topStrip, bottomStrip]);
};

const diffBuffers = (a, b) => {
    if (a.length !== b.length) return 1;
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff += Math.abs(a[i] - b[i]);
    return diff / (a.length * 255);
};

// Chụp màn hình phiên hiện tại rồi đối soát với ảnh tham chiếu của lần chạy
// trước. Trả về { changed, diffPct, screenshotPath, isNew }.
export const captureAndCompareUI = async (page, flowLabel) => {
    try {
        fs.mkdirSync(REFERENCE_DIR, { recursive: true });
        const currentPath = path.join(SCREENSHOT_DIR, `ui-${flowLabel}-${Date.now()}.png`);
        await page.screenshot({ path: currentPath, fullPage: false });
        const refPath = path.join(REFERENCE_DIR, `ui-${flowLabel}.png`);

        if (!fs.existsSync(refPath)) {
            fs.copyFileSync(currentPath, refPath);
            return { changed: false, isNew: true, diffPct: 0, screenshotPath: currentPath };
        }

        const [refSignature, signature] = await Promise.all([
            buildUiSignature(refPath),
            buildUiSignature(currentPath),
        ]);
        const diffPct = diffBuffers(refSignature, signature);

        // Luôn cập nhật ảnh tham chiếu theo phiên mới nhất (chống drift nhỏ).
        fs.copyFileSync(currentPath, refPath);
        if (diffPct > UI_CHANGE_THRESHOLD) {
            console.log(`🖥️ [UI Watch] Giao diện ${flowLabel} khác biệt lớn (${(diffPct * 100).toFixed(1)}%). Giữ ảnh chẩn đoán.`);
            return { changed: true, isNew: false, diffPct, screenshotPath: currentPath };
        }
        try { fs.unlinkSync(currentPath); } catch (e) { /* file đang bị khóa, bỏ qua */ }
        return { changed: false, isNew: false, diffPct, screenshotPath: null };
    } catch (error) {
        console.log(`⚠️ [UI Watch] Không so sánh được giao diện: ${error.message}`);
        return { changed: false, isNew: false, diffPct: null, screenshotPath: null };
    }
};

// Dọn ảnh chẩn đoán cũ sau mỗi lượt đăng xong (giữ nguyên ảnh tham chiếu).
export const cleanupDebugScreenshots = (maxAgeMs = 2 * 24 * 60 * 60 * 1000) => {
    try {
        if (!fs.existsSync(SCREENSHOT_DIR)) return;
        const now = Date.now();
        for (const file of fs.readdirSync(SCREENSHOT_DIR)) {
            const filePath = path.join(SCREENSHOT_DIR, file);
            try {
                const stat = fs.statSync(filePath);
                if (stat.isFile() && now - stat.mtimeMs > maxAgeMs) {
                    fs.unlinkSync(filePath);
                    console.log(`🧹 Đã dọn ảnh chẩn đoán cũ: ${file}`);
                }
            } catch (e) { /* bỏ qua file đang bị khóa */ }
        }
    } catch (e) {
        console.log(`⚠️ Lỗi dọn ảnh chẩn đoán: ${e.message}`);
    }
};
