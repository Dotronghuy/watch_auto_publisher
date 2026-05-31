const DECISION_TIMEOUT_MS = 2 * 60 * 60 * 1000; // 2 tiếng timeout chờ duyệt

const waitForTelegramDecision = () => {
  return new Promise((resolve) => {
    let timer = null;
    const onContinue = () => { cleanup(); resolve(true); };
    const onStop = () => { cleanup(); resolve(false); };
    const cleanup = () => {
      if (timer) clearTimeout(timer);
      telegramEvents.off('continue_training', onContinue);
      telegramEvents.off('stop_training', onStop);
    };
    telegramEvents.on('continue_training', onContinue);
    telegramEvents.on('stop_training', onStop);
    // Timeout: tự động dừng nếu không có phản hồi sau 2 tiếng
    timer = setTimeout(() => {
      liveLog('⏱️ Hết 2 tiếng chờ duyệt trên Telegram, tự động ngưng Train.', 'warning', 'System');
      cleanup();
      resolve(false);
    }, DECISION_TIMEOUT_MS);
  });
};

export const startTelegramTrainingLoop = async () => {
  isRoutineRunning = true;
  let isTraining = true;
  let consecutiveErrors = 0;
  const MAX_CONSECUTIVE_ERRORS = 3;
  
  while (isTraining && !globalStopController.signal.aborted) {
    try {
      liveLog('Bắt đầu vòng lặp Train Ảnh mới...', 'highlight', 'System');
      const skuFolders = await getFoldersInFolder(ROOT_DRIVE_FOLDER_ID);
      if (skuFolders.length === 0) throw new Error('Không tìm thấy thư mục SKU nào trong Drive!');

      const postedIds = await getPostedImageIds();
      checkAbort();

      const shuffledSkus = [...skuFolders].sort(() => 0.5 - Math.random());
      let selectedSku = null;
      let avtImageFile = null;

      for (const skuFolder of shuffledSkus) {
        const avtFolderId = await getFolderIdByName('0_Anh_AVT', skuFolder.id);
        if (!avtFolderId) continue;
        const mediaFiles = await getImagesInFolder(avtFolderId);
        const freshMedia = mediaFiles.filter(item => !postedIds.includes(item.id));
        if (freshMedia.length > 0) {
          selectedSku = skuFolder;
          avtImageFile = freshMedia[Math.floor(Math.random() * freshMedia.length)];
          break;
        }
      }

      if (!selectedSku || !avtImageFile) {
        liveLog('Không tìm thấy ảnh AVT mới, tạm ngưng Train.', 'warning', 'System');
        break;
      }

      liveLog('✅ [TRAIN ẢNH] Đã chọn SKU: ' + selectedSku.name, 'highlight', 'Google Drive');
      consecutiveErrors = 0; // Reset lỗi khi đã chọn được SKU thành công
      
      let pathStr = await downloadFileFromDrive(avtImageFile.id, avtImageFile.name);
      const bgRemovedPath = pathStr.replace(/\.[^/.]+$/, '_rmbg.png');
      const finalPaddedPath = pathStr.replace(/\.[^/.]+$/, '_1024.png');
      try {
        liveLog('🎨 [TRAIN ẢNH] Đang xóa nền...', 'typing', 'remove.bg');
        const rmBgFormData = new FormData();
        rmBgFormData.append('size', 'auto');
        rmBgFormData.append('image_file', fs.readFileSync(pathStr), {
          filename: path.basename(pathStr),
          contentType: pathStr.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg'
        });
        const rmbgResponse = await axios.post('https://api.remove.bg/v1.0/removebg', rmBgFormData, {
          headers: { ...rmBgFormData.getHeaders(), 'X-Api-Key': (process.env.REMOVE_BG_API_KEY || '').trim() },
          responseType: 'arraybuffer',
        });
        fs.writeFileSync(bgRemovedPath, rmbgResponse.data);
        await sharp(bgRemovedPath).resize(1024, 1024, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 0 } }).toFormat('png').toFile(finalPaddedPath);
        pathStr = finalPaddedPath;
      } catch (e) {
        liveLog('⚠️ Lỗi xóa nền: ' + e.message, 'error', 'remove.bg');
      }

      const promptGuidePath = path.join(__dirname, '../../config/gpt_image_prompt.md');
      const numAiImages = 10;
      let imgPromptsArray = [];
      let currentSceneTextsArray = [];

      if (fs.existsSync(promptGuidePath)) {
        const mdContent = fs.readFileSync(promptGuidePath, 'utf8');
        const skuUpper = (selectedSku?.name || '').toUpperCase();
        let genderTag = 'NEUTRAL';
        if (/G\d*$|G[^A-Z]|\d+G/.test(skuUpper)) genderTag = 'MALE';
        else if (/L\d*$|L[^A-Z]|\d+L/.test(skuUpper)) genderTag = 'FEMALE';

        const sectionRegex = new RegExp(`\\[${genderTag}\\][\\s\\S]*?(?=\\n## \\[|$)`, 'i');
        const sectionMatch = mdContent.match(sectionRegex);
        const searchContent = sectionMatch ? sectionMatch[0] : mdContent;
        const sceneMatches = [...searchContent.matchAll(/\*\*English instruction for GPT:\*\*\s*>\s*([\s\S]*?)(?=\n---|###|## |$)/g)];
        const validScenes = sceneMatches.map(m => m[1].trim()).filter(s => !s.startsWith('PLACEHOLDER'));

        if (validScenes.length > 0) {
          const shuffledScenes = [...validScenes].sort(() => 0.5 - Math.random()).slice(0, numAiImages);
          const genderNote = genderTag === 'MALE' ? 'The person must have MASCULINE hands.' : genderTag === 'FEMALE' ? 'The person must have FEMININE hands.' : '';
          currentSceneTextsArray = shuffledScenes;
          imgPromptsArray = shuffledScenes.map(sceneText =>
            `This is a luxury watch with transparent background (background already removed). Composite this exact watch into the following lifestyle scene:\n\n${sceneText}\n\n${genderNote}\n\nCRITICAL RULES:\n- IGNORE ALL PREVIOUS WATCH IMAGES in this chat history. YOU MUST ONLY USE THE IMAGE ATTACHED TO THIS CURRENT MESSAGE!\n- Do NOT redraw, redesign, or modify the watch in any way.\n- Keep the watch dial, hands, case, bracelet, brand text, and colors EXACTLY as in the provided image.\n- Lighting must be consistent between the watch and the environment.\n- Output: photorealistic, 4K commercial product photography quality.`
          );
        } else {
          currentSceneTextsArray = Array(numAiImages).fill('white marble with luxury props');
          imgPromptsArray = Array(numAiImages).fill('This is a luxury watch image with the background removed. Place this exact watch into a high-end lifestyle flat lay scene on white marble with luxury props. CRITICAL: IGNORE ALL PREVIOUS IMAGES. Use ONLY the attached image. Do NOT alter the watch design.');
        }
      }

      const sampleImg = getRandomSampleImage();
      const aiGeneratedImagePaths = await generateBackgroundOnChatGPT(pathStr, imgPromptsArray, globalStopController.signal, sampleImg);
      const lastWatchPath = path.join(__dirname, '../../temp_images/last_watch_image.png');
      if (fs.existsSync(pathStr)) { fs.copyFileSync(pathStr, lastWatchPath); fs.unlinkSync(pathStr); }
      
      const imageUrls = [];
      for (let i = 0; i < aiGeneratedImagePaths.length; i++) {
        if (fs.existsSync(aiGeneratedImagePaths[i])) {
          imageUrls.push({
            path: aiGeneratedImagePaths[i],
            prompt: currentSceneTextsArray[i] || ''
          });
        }
      }

      liveLog('🎉 [TRAIN ẢNH] Đã vẽ xong! Đang đẩy ảnh qua Telegram...', 'success', 'System');
      
      await sendBatchToTelegram(imageUrls, lastWatchPath, sampleImg);
      
      liveLog('⏳ Đang chờ bác chấm điểm trên Telegram...', 'highlight', 'System');
      const shouldContinue = await waitForTelegramDecision();
      
      if (!shouldContinue) {
        isTraining = false;
        liveLog('⏸️ Hệ thống Train Ảnh đã ngưng theo yêu cầu (hoặc timeout).', 'warning', 'System');
      }

    } catch (error) {
      consecutiveErrors++;
      liveLog(`❌ Lỗi vòng lặp Train (${consecutiveErrors}/${MAX_CONSECUTIVE_ERRORS}): ${error.message}`, 'error', 'System');
      
      if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
        liveLog(`🛑 Đã gặp ${MAX_CONSECUTIVE_ERRORS} lỗi liên tiếp, dừng Train.`, 'error', 'System');
        isTraining = false;
      } else {
        liveLog(`⏳ Chờ 30 giây rồi thử lại...`, 'warning', 'System');
        await new Promise(r => setTimeout(r, 30000));
      }
    }
  }
  isRoutineRunning = false;
};

export const trainImageOnly = async () => {
  if (isRoutineRunning) throw new Error('Hệ thống đang chạy một tiến trình khác!');
  
  // Khởi động luồng chạy ngầm
  startTelegramTrainingLoop().catch(console.error);

  return {
    success: true,
    sku: 'Auto',
    postMode: 'AI',
    fbContent: '',
    igContent: '',
    images: [],
    imageCount: 0,
    trainMode: 'image',
    message: '🚀 Đã chuyển quyền điều khiển sang Telegram! Vui lòng mở điện thoại để chấm điểm ảnh.'
  };
};
