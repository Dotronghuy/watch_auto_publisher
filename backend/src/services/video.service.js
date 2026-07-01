import ffmpeg from 'fluent-ffmpeg';
import ffmpegStatic from 'ffmpeg-static';
import ffprobeStatic from '@ffprobe-installer/ffprobe';
import os from 'os';
import { spawn } from 'child_process';

ffmpeg.setFfmpegPath(ffmpegStatic);
ffmpeg.setFfprobePath(ffprobeStatic.path);

const AUDIBLE_MAX_VOLUME_DB = -55;

const parseVolumeDb = (stderr, label) => {
  const match = stderr.match(new RegExp(`${label}:\\s*(-?Infinity|-?inf|-?\\d+(?:\\.\\d+)?)\\s*dB`, 'i'));
  if (!match) return null;
  const raw = match[1].toLowerCase();
  if (raw.includes('inf')) return -Infinity;
  return Number(raw);
};

const detectMaxVolumeDb = (videoPath) => {
  return new Promise((resolve, reject) => {
    const nullOutput = os.platform() === 'win32' ? 'NUL' : '/dev/null';
    const child = spawn(ffmpegStatic, [
      '-hide_banner',
      '-nostats',
      '-i', videoPath,
      '-map', '0:a:0',
      '-af', 'volumedetect',
      '-f', 'null',
      nullOutput,
    ], { windowsHide: true });

    let stderr = '';
    child.stderr.on('data', data => { stderr += data.toString(); });
    child.on('error', reject);
    child.on('close', code => {
      const maxVolume = parseVolumeDb(stderr, 'max_volume');
      if (maxVolume !== null) return resolve(maxVolume);
      if (code === 0) return resolve(null);
      reject(new Error(`ffmpeg volumedetect failed with code ${code}`));
    });
  });
};

/**
 * Returns true only when the video has an audible audio track.
 * A silent audio stream still returns false so the publish flow can add music.
 */
export const hasAudioStream = (videoPath) => {
  return new Promise((resolve) => {
    ffmpeg.ffprobe(videoPath, (err, metadata) => {
      if (err) {
        console.error(`Could not read video metadata with ffprobe: ${err.message}`);
        return resolve(false);
      }

      const audioStreams = metadata.streams.filter(s => s.codec_type === 'audio');
      if (audioStreams.length === 0) return resolve(false);

      detectMaxVolumeDb(videoPath)
        .then(maxVolume => {
          if (maxVolume === null) {
            console.warn('Could not measure video volume. Treating it as already having audio to avoid overwriting original sound.');
            return resolve(true);
          }

          const audible = Number.isFinite(maxVolume) && maxVolume > AUDIBLE_MAX_VOLUME_DB;
          if (!audible) {
            console.log(`Video has an audio stream but it is effectively silent (max_volume=${maxVolume} dB). Music will be added.`);
          }
          resolve(audible);
        })
        .catch(volumeErr => {
          console.warn(`Could not analyze video volume: ${volumeErr.message}. Treating it as already having audio.`);
          resolve(true);
        });
    });
  });
};

/**
 * Add an MP3 music track to an MP4 video.
 * The original video audio is replaced, and output is cut to the shortest input.
 */
export const addMusicToVideo = (videoPath, audioPath, outputPath) => {
  return new Promise((resolve, reject) => {
    console.log('Adding music to video...');
    let stderrLog = '';
    ffmpeg(videoPath)
      .input(audioPath)
      .outputOptions([
        '-map 0:v:0',
        '-map 1:a:0',
        '-c:v libx264',
        '-preset ultrafast',
        '-crf 23',
        '-c:a aac',
        '-b:a 128k',
        '-ac 2',
        '-movflags +faststart',
        '-shortest',
        '-y',
      ])
      .save(outputPath)
      .on('stderr', (line) => { stderrLog += line + '\n'; })
      .on('end', () => {
        console.log(`Added music successfully: ${outputPath}`);
        resolve(outputPath);
      })
      .on('error', (err) => {
        console.error(`Failed to add music: ${err.message}`);
        if (stderrLog) console.error(`FFmpeg stderr:\n${stderrLog.slice(-500)}`);
        reject(err);
      });
  });
};
