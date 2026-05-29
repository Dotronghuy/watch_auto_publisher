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
    let stderrLog = '';
    ffmpeg(videoPath)
      .input(audioPath)
      .outputOptions([
        '-map 0:v:0',         // Chỉ lấy hình ảnh từ video gốc
        '-map 1:a:0',         // Chỉ lấy âm thanh từ nhạc nền
        '-c:v libx264',       // Re-encode video (tương thích mọi định dạng, thay vì copy)
        '-preset ultrafast',  // Tốc độ encode nhanh nhất
        '-crf 23',            // Chất lượng hợp lý (0=tốt nhất, 51=kém nhất)
        '-c:a aac',           // Nén âm thanh chuẩn AAC (bắt buộc của Meta)
        '-b:a 128k',          // Bitrate âm thanh
        '-ac 2',              // Stereo
        '-movflags +faststart', // Tối ưu cho streaming
        '-shortest',          // Cắt theo file ngắn nhất
        '-y',                 // Ghi đè nếu file output đã tồn tại
      ])
      .save(outputPath)
      .on('stderr', (line) => { stderrLog += line + '\n'; })
      .on('end', () => {
        console.log(`✅ Đã ghép nhạc thành công: ${outputPath}`);
        resolve(outputPath);
      })
      .on('error', (err) => {
        console.error(`❌ Lỗi khi ghép nhạc: ${err.message}`);
        if (stderrLog) console.error(`📋 FFmpeg stderr:\n${stderrLog.slice(-500)}`);
        reject(err);
      });
  });
};
