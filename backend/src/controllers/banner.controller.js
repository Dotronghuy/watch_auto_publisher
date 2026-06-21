import { prisma } from '../services/shopee/db.js';
import { generateCollectionBanner } from '../services/banner.service.js';
import path from 'path';
import fs from 'fs';

export const generateBannersForModels = async (req, res) => {
  try {
    const { modelIds } = req.body;
    if (!modelIds || !Array.isArray(modelIds) || modelIds.length === 0) {
      return res.status(400).json({ success: false, message: 'Vui lòng cung cấp mảng modelIds' });
    }

    const results = [];

    for (const modelId of modelIds) {
      // 1. Lấy thông tin model và variants
      const model = await prisma.watchModel.findUnique({
        where: { id: modelId },
        include: { variants: true }
      });

      if (!model) {
        results.push({ modelId, success: false, message: 'Không tìm thấy model' });
        continue;
      }

      // 2. Lọc ra các variants có ảnh gốc (rawImage) và có bannerPosition
      const validVariants = model.variants.filter(v => v.rawImage && fs.existsSync(v.rawImage));
      
      // Tìm theo bannerPosition (1=Giữa, 2=Trái, 3=Phải)
      const centerVar = validVariants.find(v => v.bannerPosition === 1);
      const leftVar   = validVariants.find(v => v.bannerPosition === 2);
      const rightVar  = validVariants.find(v => v.bannerPosition === 3);

      // Fallback: nếu không có bannerPosition, thử tìm theo SKU (T1, T2, T3)
      const fallbackCenter = centerVar || validVariants.find(v => v.sku.includes('-T1'));
      const fallbackLeft   = leftVar   || validVariants.find(v => v.sku.includes('-T2'));
      const fallbackRight  = rightVar  || validVariants.find(v => v.sku.includes('-T3'));

      // Xây dựng object ảnh theo vị trí có sẵn
      const bannerImages = {};
      if (fallbackCenter) bannerImages.center = fallbackCenter.rawImage;
      if (fallbackLeft)   bannerImages.left   = fallbackLeft.rawImage;
      if (fallbackRight)  bannerImages.right  = fallbackRight.rawImage;

      // Kiểm tra: ít nhất phải có ảnh giữa (AVT chính)
      if (!bannerImages.center) {
        // Thử lấy bất kỳ ảnh nào có sẵn làm center
        if (validVariants.length > 0) {
          bannerImages.center = validVariants[0].rawImage;
        } else {
          results.push({ 
            modelId, 
            modelName: model.name,
            success: false, 
            message: `Model này không có ảnh nào hợp lệ hoặc chưa đánh dấu vị trí banner.` 
          });
          continue;
        }
      }

      const imageCount = Object.keys(bannerImages).length;
      console.log(`[Banner] Model ${model.name}: ${imageCount} ảnh banner (${Object.keys(bannerImages).join(', ')})`);

      const skuText = model.name;

      try {
        // 3. Gọi service tạo banner với số lượng ảnh linh hoạt
        const bannerPath = await generateCollectionBanner(bannerImages, skuText);
        results.push({
          modelId,
          modelName: model.name,
          success: true,
          bannerPath,
          layout: `${imageCount} đồng hồ`
        });
      } catch (err) {
        results.push({
          modelId,
          modelName: model.name,
          success: false,
          message: err.message
        });
      }
    }

    res.json({ success: true, results });

  } catch (error) {
    console.error('[Banner Controller] Error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};
