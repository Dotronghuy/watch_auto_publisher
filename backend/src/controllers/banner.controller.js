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

      // 2. Lọc ra các variants có ảnh gốc (rawImage)
      const validVariants = model.variants.filter(v => v.rawImage && fs.existsSync(v.rawImage));
      
      // Tìm các biến thể T1, T2, T3
      const variantT1 = validVariants.find(v => v.sku.includes('T1'));
      const variantT2 = validVariants.find(v => v.sku.includes('T2'));
      const variantT3 = validVariants.find(v => v.sku.includes('T3'));

      if (!variantT1 || !variantT2 || !variantT3) {
        // Fallback: nếu không có đủ T1, T2, T3 thì lấy 3 cái đầu tiên có ảnh
        if (validVariants.length < 3) {
          results.push({ 
            modelId, 
            modelName: model.name,
            success: false, 
            message: `Model này chỉ có ${validVariants.length} ảnh hợp lệ, cần ít nhất 3 ảnh để tạo banner.` 
          });
          continue;
        }
        validVariants.sort((a, b) => a.sku.localeCompare(b.sku));
        const selectedVariants = validVariants.slice(0, 3);
        var imagePaths = selectedVariants.map(v => v.rawImage);
      } else {
        // Có đủ T1, T2, T3 -> Xếp đúng thứ tự: Trái(T1), Giữa(T2), Phải(T3)
        var imagePaths = [variantT1.rawImage, variantT2.rawImage, variantT3.rawImage];
      }
      
      // Tên mã sẽ lấy model.name (ví dụ 19069-A1)
      const skuText = model.name;

      try {
        // 3. Gọi service tạo banner
        const bannerPath = await generateCollectionBanner(imagePaths, skuText);
        results.push({
          modelId,
          modelName: model.name,
          success: true,
          bannerPath
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
