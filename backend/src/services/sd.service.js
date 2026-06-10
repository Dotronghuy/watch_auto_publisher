import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { liveLog } from '../utils/liveLog.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const settingsPath = path.join(__dirname, '../../config/settings.json');
const workflowPath = path.join(__dirname, '../../config/comfyui_workflow.json');

const getSettings = () => {
    try {
        if (fs.existsSync(settingsPath)) {
            return JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
        }
    } catch (e) {}
    return {};
};

// Hàm hỗ trợ upload ảnh lên ComfyUI
const uploadImageToComfyUI = async (apiUrl, filePath) => {
    const formData = new FormData();
    const fileData = fs.readFileSync(filePath);
    const blob = new Blob([fileData]);
    formData.append('image', blob, path.basename(filePath));

    const response = await fetch(`${apiUrl}/upload/image`, {
        method: 'POST',
        body: formData
    });
    const result = await response.json();
    return result.name; // Trả về tên file đã lưu trên server ComfyUI
};

// Hàm theo dõi tiến trình sinh ảnh của ComfyUI
const getComfyUIHistory = async (apiUrl, promptId, abortSignal) => {
    return new Promise(async (resolve, reject) => {
        let attempts = 0;
        const interval = setInterval(async () => {
            if (abortSignal && abortSignal.aborted) {
                clearInterval(interval);
                return reject(new Error('Abort requested'));
            }
            try {
                attempts++;
                const res = await fetch(`${apiUrl}/history/${promptId}`);
                const history = await res.json();
                
                if (history[promptId]) {
                    clearInterval(interval);
                    resolve(history[promptId]);
                } else if (attempts > 120) { // Timeout sau ~10 phút
                    clearInterval(interval);
                    reject(new Error('Timeout chờ ComfyUI sinh ảnh'));
                }
            } catch (err) {
                // Ignore fetch errors during polling
            }
        }, 5000);
    });
};

export const generateBackgroundOnSD = async (imagePath, promptsArray, abortSignal = null, sampleImagePath = null, isNewSession = true, extraWatchImages = []) => {
    console.log('\n--- BẮT ĐẦU TIẾN TRÌNH STABLE DIFFUSION (LOCAL COMFYUI) ---');
    const settings = getSettings();
    const apiUrl = settings.sdApiUrl || 'http://127.0.0.1:8188';

    if (!fs.existsSync(workflowPath)) {
        console.error('❌ Không tìm thấy file cấu hình comfyui_workflow.json');
        liveLog('❌ Lỗi: Bạn cần chép file cấu hình luồng (workflow) của ComfyUI vào thư mục config/comfyui_workflow.json!', 'error', 'System');
        return [];
    }

    let workflowTemplate = {};
    try {
        workflowTemplate = JSON.parse(fs.readFileSync(workflowPath, 'utf8'));
    } catch (e) {
        console.error('❌ Lỗi định dạng comfyui_workflow.json');
        return [];
    }

    const outputPaths = [];
    const count = promptsArray.length;

    for (let i = 0; i < count; i++) {
        console.log(`\n--- VẼ ẢNH ${i + 1}/${count} (SD) ---`);
        if (abortSignal?.aborted) throw new Error('aborted');

        const currentPromptObj = promptsArray[i];
        const isString = typeof currentPromptObj === 'string';
        const currentPrompt = isString ? currentPromptObj : currentPromptObj.prompt;

        try {
            // 1. Upload ảnh sản phẩm lên ComfyUI
            let uploadedProductImage = '';
            if (imagePath && fs.existsSync(imagePath)) {
                console.log('📤 Đang upload ảnh sản phẩm (Foreground) lên ComfyUI...');
                uploadedProductImage = await uploadImageToComfyUI(apiUrl, imagePath);
            }

            let uploadedBackgroundImage = '';
            if (sampleImagePath && fs.existsSync(sampleImagePath)) {
                console.log('📤 Đang upload ảnh phông nền mẫu (Background) lên ComfyUI...');
                uploadedBackgroundImage = await uploadImageToComfyUI(apiUrl, sampleImagePath);
            } else if (uploadedProductImage) {
                console.log('⚠️ Không có ảnh nền mẫu, dùng tạm ảnh sản phẩm làm nền.');
                uploadedBackgroundImage = uploadedProductImage;
            }

            // 2. Clone workflow template và thay thế các giá trị
            const workflow = JSON.parse(JSON.stringify(workflowTemplate));
            
            // Tìm các Node trong Workflow để gán giá trị (Phụ thuộc vào cách bạn thiết lập workflow)
            for (const nodeId in workflow) {
                const node = workflow[nodeId];
                if (node.class_type === 'LoadImage') {
                    if (nodeId === "2" && uploadedProductImage) {
                        node.inputs.image = uploadedProductImage;
                    } else if (nodeId === "4" && uploadedBackgroundImage) {
                        node.inputs.image = uploadedBackgroundImage;
                    } else if (uploadedProductImage) {
                        // Fallback cũ cho các workflow tự do
                        node.inputs.image = uploadedProductImage;
                    }
                }
                if (node.class_type === 'CLIPTextEncode' && node.inputs.text !== undefined) {
                    // Giả sử prompt dương (Positive) chứa chữ "prompt" hoặc trống
                    if (!node.inputs.text || node.inputs.text.includes('YOUR_PROMPT_HERE')) {
                        node.inputs.text = currentPrompt;
                    }
                }
                if (node.class_type === 'KSampler') {
                    // Randomize seed để mỗi ảnh ra kết quả khác nhau
                    node.inputs.seed = Math.floor(Math.random() * 1000000000000000);
                }
            }

            // 3. Gửi lệnh sinh ảnh (Queue Prompt)
            console.log(`🚀 Đang gửi Prompt số ${i + 1} tới ComfyUI...`);
            liveLog(`⏳ [SD] Đang kết xuất ảnh ${i + 1}/${count}...`, 'highlight', 'System');
            
            const queueRes = await fetch(`${apiUrl}/prompt`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ prompt: workflow })
            });
            const queueData = await queueRes.json();
            const promptId = queueData.prompt_id;

            if (!promptId) throw new Error('Không nhận được prompt_id từ ComfyUI');

            // 4. Chờ hoàn thành
            console.log(`⏳ Đang chờ ảnh hoàn thành (Prompt ID: ${promptId})...`);
            const history = await getComfyUIHistory(apiUrl, promptId, abortSignal);

            // 5. Lấy kết quả và tải về máy
            const outputs = history.outputs;
            let targetFilename = null;
            
            // Tìm node output (SaveImage)
            for (const nodeId in outputs) {
                if (outputs[nodeId].images && outputs[nodeId].images.length > 0) {
                    targetFilename = outputs[nodeId].images[0].filename;
                    break;
                }
            }

            if (targetFilename) {
                console.log(`📥 Đang tải ảnh ${targetFilename} về hệ thống...`);
                const imgRes = await fetch(`${apiUrl}/view?filename=${targetFilename}&type=output`);
                const arrayBuffer = await imgRes.arrayBuffer();
                const buffer = Buffer.from(arrayBuffer);
                
                const outputPath = path.join(__dirname, `../../temp_images/sd_gen_${Date.now()}.png`);
                fs.writeFileSync(outputPath, buffer);
                console.log(`✅ Đã lưu ảnh thành công: ${path.basename(outputPath)}`);
                outputPaths.push(outputPath);
            } else {
                throw new Error('Không tìm thấy file ảnh đầu ra trong kết quả trả về.');
            }

        } catch (error) {
            console.error(`❌ LỖI VẼ ẢNH ${i + 1}: ${error.message}`);
            liveLog(`❌ Lỗi sinh ảnh qua SD: ${error.message}`, 'error', 'System');
        }
    }

    console.log('✅ Hoàn thành tiến trình SD!');
    return outputPaths;
};
