import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const LAST_RUN_REDIS_KEY = 'last_run_timestamp';
export const lastRunStatePath = path.join(__dirname, '../../config/last_run.state');
export const legacyLastRunPath = path.join(__dirname, '../../config/last_run.json');

const readTimestampFile = () => {
  const candidatePath = fs.existsSync(lastRunStatePath)
    ? lastRunStatePath
    : legacyLastRunPath;

  if (!fs.existsSync(candidatePath)) return 0;

  const data = JSON.parse(fs.readFileSync(candidatePath, 'utf8'));
  const timestamp = Number(data?.timestamp);
  return Number.isFinite(timestamp) && timestamp > 0 ? timestamp : 0;
};

export const readLastSuccessfulRun = async (redisConnection) => {
  if (redisConnection) {
    try {
      const value = await redisConnection.get(LAST_RUN_REDIS_KEY);
      const timestamp = Number(value);
      if (Number.isFinite(timestamp) && timestamp > 0) return timestamp;
    } catch (error) {
      console.warn('[Last Run] Không đọc được Redis, chuyển sang file local:', error.message);
    }
  }

  try {
    return readTimestampFile();
  } catch (error) {
    console.warn('[Last Run] Không đọc được file local:', error.message);
    return 0;
  }
};

export const markLastSuccessfulRun = async (
  redisConnection,
  timestamp = Date.now(),
) => {
  const normalizedTimestamp = Number(timestamp);
  if (!Number.isFinite(normalizedTimestamp) || normalizedTimestamp <= 0) {
    throw new Error('Timestamp last_run không hợp lệ.');
  }

  let redisSaved = false;
  let fileSaved = false;
  const errors = [];

  if (redisConnection) {
    try {
      await redisConnection.set(LAST_RUN_REDIS_KEY, String(normalizedTimestamp));
      redisSaved = true;
    } catch (error) {
      errors.push(`Redis: ${error.message}`);
    }
  }

  try {
    fs.writeFileSync(
      lastRunStatePath,
      JSON.stringify({ timestamp: normalizedTimestamp }),
      'utf8',
    );
    fileSaved = true;
  } catch (error) {
    errors.push(`file: ${error.message}`);
  }

  if (!redisSaved && !fileSaved) {
    throw new Error(`Không lưu được last_run (${errors.join('; ')}).`);
  }

  return {
    timestamp: normalizedTimestamp,
    redisSaved,
    fileSaved,
    warnings: errors,
  };
};

export const hasSuccessfulPublishResult = (result) => (
  result?.publishSucceeded === true
  && Array.isArray(result?.publishedPlatforms)
  && result.publishedPlatforms.length > 0
);
