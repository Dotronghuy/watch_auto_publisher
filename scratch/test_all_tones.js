import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { generateContentOnChatGPT } from '../backend/src/services/playwright.service.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const tones = [
  "Sang trọng, tinh tế", 
  "Gần gũi, đời thường", 
  "Kể chuyện (Storytelling)", 
  "Trực diện, chốt sale", 
  "Kiến thức chuyên gia", 
  "Hài hước, thả thính"
];

const ctas = [
  "Inbox ngay để nhận ưu đãi",
  "Để lại bình luận để được tư vấn chi tiết",
  "Đừng bỏ lỡ siêu phẩm này",
  "Nhắn tin cho shop ngay nhé"
];

async function run() {
  console.log("🚀 BẮT ĐẦU CHẠY THỬ NGHIỆM 6 PHONG CÁCH HÀNH VĂN...");
  let markdownOutput = "# Bảng Thử Nghiệm 6 Phong Cách Hành Văn\n\n";
  markdownOutput += "Dưới đây là kết quả sinh thử 6 bài viết với 6 giọng văn khác nhau cho một sản phẩm mẫu (SKU DEMO).\n\n";

  for (let i = 0; i < tones.length; i++) {
    const tone = tones[i];
    const cta = ctas[Math.floor(Math.random() * ctas.length)];
    const perspective = "Góc nhìn của chuyên gia tư vấn thời trang"; // Cố định 1 góc nhìn cho dễ so sánh

    console.log(`\n⏳ Đang sinh bài số ${i + 1}/6 - Phong cách: ${tone}`);
    
    const basePrompt = `Hãy viết 2 bài theo đúng format:
## FACEBOOK:
[Bài FB 80-150 từ, có hashtag #iwcarnivalvietnam #iwcarnival #donghoiwcarnival]
## INSTAGRAM:
[Caption IG 15-35 từ, góc nhìn KHÁC bài FB, có hashtag #iwcarnivalvietnam #iwcarnival #donghoiwcarnival]
Sản phẩm: đồng hồ SKU DEMO. Không kèm giải thích.`;

    const instruction = `
YÊU CẦU ĐẶC BIỆT:
- Giọng văn: ${tone}
- Góc nhìn: ${perspective}
- Call to Action: ${cta}`;

    const prompt = basePrompt + instruction;

    try {
      const content = await generateContentOnChatGPT(prompt, 'fb', null);
      console.log(`✅ Hoàn thành phong cách: ${tone}`);
      
      markdownOutput += `## ${i + 1}. Phong cách: **${tone}**\n`;
      markdownOutput += `*CTA áp dụng: ${cta}*\n\n`;
      markdownOutput += `\`\`\`text\n${content}\n\`\`\`\n\n---\n\n`;

    } catch (err) {
      console.error(`❌ Lỗi ở phong cách ${tone}:`, err.message);
      markdownOutput += `## ${i + 1}. Phong cách: **${tone}**\n*Lỗi sinh nội dung: ${err.message}*\n\n---\n\n`;
    }
  }

  const outputPath = path.join(__dirname, 'content_styles_preview.md');
  fs.writeFileSync(outputPath, markdownOutput);
  console.log(`\n🎉 Đã sinh xong! Kết quả được lưu tại: ${outputPath}`);
}

run();
