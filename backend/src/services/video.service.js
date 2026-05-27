import ffmpeg from 'fluent-ffmpeg';
import ffmpegStatic from 'ffmpeg-static';

// Thiết lập đường dẫn tĩnh tới thư viện ffmpeg
ffmpeg.setFfmpegPath(ffmpegStatic);

/**
 * Ghép nhạc MP3 vào Video MP4.
 * Tự động loại bỏ âm thanh gốc của Video.
 * Tự động cắt bằng nhau (lấy thời lượng của file ngắn nhất làm chuẩn).
 * 
 * @param {string} videoPath - Đường dẫn file video gốc
 * @param {string} audioPath - Đường dẫn file mp3 nhạc nền
 * @param {string} outputPath - Đường dẫn lưu file video sau khi ghép
 * @returns {Promise<string>}
 */
export const addMusicToVideo = (videoPath, audioPath, outputPath) => {
  return new Promise((resolve, reject) => {
    console.log(`🎵 Đang tiến hành ghép nhạc vào Video...`);
    ffmpeg(videoPath)
      .input(audioPath)
      .outputOptions([
        '-map 0:v:0', // Chỉ lấy hình ảnh từ file đầu tiên (video gốc)
        '-map 1:a:0', // Chỉ lấy âm thanh từ file thứ hai (nhạc nền)
        '-c:v copy',  // Copy nguyên bản luồng hình ảnh (cực kỳ nhanh, không làm mờ video)
        '-c:a aac',   // Nén âm thanh chuẩn AAC (chuẩn bắt buộc của Meta)
        '-shortest'   // Cắt độ dài bằng với file ngắn nhất (yêu cầu của User)
      ])
      .save(outputPath)
      .on('end', () => {
        console.log(`✅ Đã ghép nhạc thành công: ${outputPath}`);
        resolve(outputPath);
      })
      .on('error', (err) => {
        console.error(`❌ Lỗi khi ghép nhạc: ${err.message}`);
        reject(err);
      });
  });
};
