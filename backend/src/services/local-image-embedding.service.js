import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import axios from 'axios';
import sharp from 'sharp';
import { env, pipeline, RawImage } from '@huggingface/transformers';
import { getAllProductsWithImages } from './sheet.service.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.resolve(__dirname, '../../data');
const MODEL_CACHE_DIR = path.join(DATA_DIR, 'transformers-cache');
const THUMBNAIL_CACHE_DIR = path.join(DATA_DIR, 'local-image-thumbnails');
const INDEX_PATH = path.join(DATA_DIR, 'local-image-embedding-index.json');
const INDEX_TEMP_PATH = `${INDEX_PATH}.tmp`;
const MODEL_ID = 'Xenova/dinov2-small';
const MODEL_DTYPE = 'q4';
const INDEX_VERSION = 1;
const EMBEDDING_SIZE = 384;
const INDEX_BATCH_SIZE = 12;
const SEARCH_LIMIT = 8;
const FAMILY_CANDIDATE_LIMIT = 20;
const EXACT_MIN_SCORE = Number(process.env.LOCAL_IMAGE_EXACT_MIN_SCORE || 0.965);
const EXACT_MIN_GAP = Number(process.env.LOCAL_IMAGE_EXACT_MIN_GAP || 0.035);
const VERIFY_MIN_SCORE = Number(process.env.LOCAL_IMAGE_VERIFY_MIN_SCORE || 0.72);
const FAMILY_VERIFY_MIN_SCORE = Number(process.env.LOCAL_IMAGE_FAMILY_VERIFY_MIN_SCORE || 0.82);

env.cacheDir = MODEL_CACHE_DIR;
env.allowLocalModels = true;
env.allowRemoteModels = true;

let extractorPromise = null;
let indexBuildPromise = null;
let indexCache = null;

const getExtractor = async () => {
  if (!extractorPromise) {
    fs.mkdirSync(MODEL_CACHE_DIR, { recursive: true });
    const startedAt = Date.now();
    extractorPromise = pipeline('image-feature-extraction', MODEL_ID, {
      dtype: MODEL_DTYPE
    }).then(extractor => {
      console.log(`Local image model ready in ${Date.now() - startedAt} ms.`);
      return extractor;
    }).catch(error => {
      extractorPromise = null;
      throw error;
    });
  }
  return extractorPromise;
};

const normalizeEmbedding = values => {
  let magnitudeSquared = 0;
  for (const value of values) magnitudeSquared += value * value;
  const magnitude = Math.sqrt(magnitudeSquared) || 1;
  return Array.from(values, value => value / magnitude);
};

const splitTensorRows = tensor => {
  const rows = Number(tensor?.dims?.[0]) || 0;
  const columns = Number(tensor?.dims?.at(-1)) || 0;
  if (!rows || columns !== EMBEDDING_SIZE) {
    throw new Error(`Unexpected image model output shape: ${JSON.stringify(tensor?.dims)}`);
  }

  const tokensPerImage = tensor.dims.length === 3
    ? Number(tensor.dims[1]) || 1
    : 1;
  return Array.from({ length: rows }, (_, rowIndex) => {
    // DINOv2 stores the global image representation in the first CLS token.
    const start = rowIndex * tokensPerImage * columns;
    return normalizeEmbedding(tensor.data.slice(start, start + columns));
  });
};

const bufferToRawImage = async (buffer, contentType = 'image/jpeg') =>
  RawImage.read(new Blob([buffer], { type: contentType }));

const embedRawImages = async rawImages => {
  if (!rawImages.length) return [];
  const extractor = await getExtractor();
  const tensor = await extractor(rawImages);
  return splitTensorRows(tensor);
};

const downloadImage = async imageUrl => {
  const response = await axios.get(imageUrl, {
    responseType: 'arraybuffer',
    timeout: 15000,
    maxRedirects: 10
  });
  const contentType = String(response.headers['content-type'] || 'image/jpeg')
    .split(';')[0]
    .trim();
  const buffer = Buffer.from(response.data);
  return {
    buffer,
    rawImage: await bufferToRawImage(buffer, contentType)
  };
};

const getThumbnailPath = sku => path.join(
  THUMBNAIL_CACHE_DIR,
  `${String(sku || '').replace(/[^A-Z0-9-]/gi, '_')}.jpg`
);

const writeCatalogThumbnail = async (sku, sourceBuffer) => {
  fs.mkdirSync(THUMBNAIL_CACHE_DIR, { recursive: true });
  const thumbnail = await sharp(sourceBuffer)
    .rotate()
    .resize(320, 300, { fit: 'contain', background: '#ffffff' })
    .flatten({ background: '#ffffff' })
    .jpeg({ quality: 90, mozjpeg: true })
    .toBuffer();
  fs.writeFileSync(getThumbnailPath(sku), thumbnail);
};

const loadIndex = () => {
  if (indexCache) return indexCache;
  try {
    const parsed = JSON.parse(fs.readFileSync(INDEX_PATH, 'utf8'));
    if (
      parsed.version !== INDEX_VERSION
      || parsed.model !== MODEL_ID
      || parsed.dimension !== EMBEDDING_SIZE
      || !Array.isArray(parsed.items)
    ) {
      return null;
    }
    indexCache = parsed;
    return indexCache;
  } catch {
    return null;
  }
};

const writeIndex = index => {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(INDEX_TEMP_PATH, JSON.stringify(index));
  fs.renameSync(INDEX_TEMP_PATH, INDEX_PATH);
  indexCache = index;
};

const cosineSimilarity = (left, right) => {
  if (!left || !right || left.length !== right.length) return -1;
  let score = 0;
  for (let index = 0; index < left.length; index++) {
    score += left[index] * right[index];
  }
  return score;
};

const getSkuFamily = sku => String(sku || '')
  .trim()
  .toUpperCase()
  .split('-')[0];

const rankFamilies = scoredItems => {
  const buckets = new Map();
  for (const item of scoredItems) {
    const family = getSkuFamily(item.sku);
    if (!family) continue;
    const bucket = buckets.get(family) || { family, scores: [], items: [] };
    bucket.scores.push(item.score);
    bucket.items.push(item);
    buckets.set(family, bucket);
  }

  return Array.from(buckets.values()).map(bucket => {
    bucket.scores.sort((left, right) => right - left);
    const strongestScores = bucket.scores.slice(0, Math.min(3, bucket.scores.length));
    const average = strongestScores.reduce((sum, score) => sum + score, 0)
      / strongestScores.length;
    return {
      family: bucket.family,
      score: bucket.scores[0],
      aggregateScore: (bucket.scores[0] * 0.7) + (average * 0.3),
      items: bucket.items.sort((left, right) => right.score - left.score)
    };
  }).sort((left, right) => right.aggregateScore - left.aggregateScore);
};

const prepareCustomerViews = async imageBuffer => {
  const oriented = await sharp(imageBuffer).rotate().toBuffer();
  const [fullView, focusView] = await Promise.all([
    sharp(oriented)
      .resize(1024, 1024, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 90, mozjpeg: true })
      .toBuffer(),
    sharp(oriented)
      .resize(640, 640, { fit: 'cover', position: sharp.strategy.attention })
      .jpeg({ quality: 92, mozjpeg: true })
      .toBuffer()
  ]);
  return Promise.all([
    bufferToRawImage(fullView),
    bufferToRawImage(focusView)
  ]);
};

export const getLocalImageIndexStatus = () => {
  const index = loadIndex();
  return {
    ready: Boolean(index?.items?.length),
    itemCount: index?.items?.length || 0,
    updatedAt: index?.updatedAt || null,
    building: Boolean(indexBuildPromise)
  };
};

export const warmLocalImageRecognition = async () => {
  const index = loadIndex();
  if (!index?.items?.length) return false;
  await getExtractor();
  return true;
};

export const getLocalCatalogThumbnailBuffer = (sku, imageUrl = '') => {
  const normalizedSku = String(sku || '').trim().toUpperCase();
  const index = loadIndex();
  if (!normalizedSku || !index?.items?.length) return null;
  const indexedItem = index.items.find(item => item.sku === normalizedSku);
  if (!indexedItem || (imageUrl && indexedItem.imageUrl !== imageUrl)) return null;
  try {
    return fs.readFileSync(getThumbnailPath(normalizedSku));
  } catch {
    return null;
  }
};

export const syncLocalImageEmbeddingIndex = async ({ forceFull = false } = {}) => {
  if (indexBuildPromise) return indexBuildPromise;

  indexBuildPromise = (async () => {
    const startedAt = Date.now();
    const products = await getAllProductsWithImages();
    const uniqueProducts = Array.from(new Map(products
      .map(product => ({
        sku: String(product.sku || '').trim().toUpperCase(),
        imageUrl: String(product.imageUrl || '').trim()
      }))
      .filter(product => product.sku && product.imageUrl)
      .map(product => [product.sku, product])).values());

    const currentIndex = forceFull ? null : loadIndex();
    const reusableBySku = new Map((currentIndex?.items || []).map(item => [item.sku, item]));
    const completedItems = [];
    const pendingProducts = [];

    for (const product of uniqueProducts) {
      const reusable = reusableBySku.get(product.sku);
      if (
        reusable?.imageUrl === product.imageUrl
        && Array.isArray(reusable.embedding)
        && reusable.embedding.length === EMBEDDING_SIZE
        && fs.existsSync(getThumbnailPath(product.sku))
      ) {
        completedItems.push(reusable);
      } else {
        pendingProducts.push(product);
      }
    }

    if (pendingProducts.length > 0) await getExtractor();
    console.log(
      `Building local image index: ${pendingProducts.length} new/changed, `
      + `${completedItems.length} reused.`
    );

    for (let offset = 0; offset < pendingProducts.length; offset += INDEX_BATCH_SIZE) {
      const batch = pendingProducts.slice(offset, offset + INDEX_BATCH_SIZE);
      const downloaded = (await Promise.all(batch.map(async product => {
        try {
          return { product, image: await downloadImage(product.imageUrl) };
        } catch (error) {
          console.warn(`Skipping local embedding for ${product.sku}: ${error.message}`);
          return null;
        }
      }))).filter(Boolean);

      if (downloaded.length > 0) {
        const embeddings = await embedRawImages(downloaded.map(item => item.image.rawImage));
        await Promise.all(downloaded.map(item =>
          writeCatalogThumbnail(item.product.sku, item.image.buffer)
        ));
        downloaded.forEach((item, index) => {
          completedItems.push({
            sku: item.product.sku,
            imageUrl: item.product.imageUrl,
            embedding: embeddings[index]
          });
        });
      }

      if (offset === 0 || offset + INDEX_BATCH_SIZE >= pendingProducts.length || offset % 120 === 0) {
        console.log(
          `Local image index progress: ${Math.min(offset + INDEX_BATCH_SIZE, pendingProducts.length)}`
          + `/${pendingProducts.length}.`
        );
      }
    }

    const validSkuSet = new Set(uniqueProducts.map(product => product.sku));
    const items = completedItems.filter(item => validSkuSet.has(item.sku));
    const index = {
      version: INDEX_VERSION,
      model: MODEL_ID,
      dtype: MODEL_DTYPE,
      dimension: EMBEDDING_SIZE,
      updatedAt: new Date().toISOString(),
      items
    };
    writeIndex(index);
    console.log(
      `Local image index ready: ${items.length} SKU in ${Date.now() - startedAt} ms.`
    );
    return {
      ready: items.length > 0,
      itemCount: items.length,
      updatedAt: index.updatedAt,
      building: false
    };
  })().finally(() => {
    indexBuildPromise = null;
  });

  return indexBuildPromise;
};

export const findLocalImageMatches = async (imageBuffer, { limit = SEARCH_LIMIT } = {}) => {
  const startedAt = Date.now();
  const index = loadIndex();
  if (!imageBuffer || !index?.items?.length) {
    return { available: false, exactSku: null, matches: [], elapsedMs: 0 };
  }

  try {
    const views = await prepareCustomerViews(imageBuffer);
    const queryEmbeddings = await embedRawImages(views);
    const scoredItems = index.items.map(item => ({
      sku: item.sku,
      score: Math.max(...queryEmbeddings.map(query => cosineSimilarity(query, item.embedding)))
    })).sort((left, right) => right.score - left.score);
    const matches = scoredItems.slice(0, Math.max(2, limit));
    const rankedFamilies = rankFamilies(scoredItems);

    const best = matches[0];
    const runnerUp = matches[1];
    const gap = best ? best.score - (runnerUp?.score ?? -1) : 0;
    const exactSku = best?.score >= EXACT_MIN_SCORE && gap >= EXACT_MIN_GAP
      ? best.sku
      : null;
    const bestFamily = rankedFamilies[0];
    const familyRunnerUp = rankedFamilies[1];
    const familyGap = bestFamily
      ? bestFamily.aggregateScore - (familyRunnerUp?.aggregateScore ?? -1)
      : 0;
    const familyCandidates = bestFamily?.score >= FAMILY_VERIFY_MIN_SCORE
      ? bestFamily.items.slice(0, FAMILY_CANDIDATE_LIMIT).map(item => item.sku)
      : [];
    const rawCandidates = best?.score >= VERIFY_MIN_SCORE
      ? matches.slice(0, limit).map(item => item.sku)
      : [];
    const verificationCandidates = (
      familyCandidates.length > 0 ? familyCandidates : rawCandidates
    ).slice(0, FAMILY_CANDIDATE_LIMIT);

    return {
      available: true,
      exactSku,
      bestScore: best?.score || 0,
      gap,
      family: bestFamily?.family || null,
      familyScore: bestFamily?.score || 0,
      familyAggregateScore: bestFamily?.aggregateScore || 0,
      familyGap,
      familyCandidates,
      matches,
      verificationCandidates,
      elapsedMs: Date.now() - startedAt
    };
  } catch (error) {
    console.warn('Local image recognition unavailable:', error.message);
    return {
      available: false,
      exactSku: null,
      matches: [],
      verificationCandidates: [],
      elapsedMs: Date.now() - startedAt,
      error: error.message
    };
  }
};
