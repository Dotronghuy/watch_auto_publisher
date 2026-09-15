import sharp from 'sharp';
import axios from 'axios';
import { saveImageHash, getAllImageHashes, clearImageHashesBySource } from '../utils/crm.db.js';
import { getAllProductsWithImages, syncProductCatalog } from './sheet.service.js';

// --- PHẦN 1: HASHING ---

const IMAGE_SIGNATURE_BITS = 512;
const IMAGE_SIGNATURE_MATCH_THRESHOLD = 36;
const AVATAR_FAST_MATCH_THRESHOLD = 16;
const AVATAR_FAST_MATCH_MIN_GAP = 8;
const MAX_HASH_VISUAL_CANDIDATES = 24;
const HASH_SYNC_CONCURRENCY = 8;
const HASH_INDEX_CACHE_TTL_MS = 60_000;
const LEARNED_CUSTOMER_HASH_SOURCE = 'vision_customer';
const VISUAL_PIXEL_CACHE_TTL_MS = 30 * 60 * 1000;
const VISUAL_PIXEL_CACHE_MAX_ITEMS = 256;
let hashSyncPromise = null;
const visualPixelCache = new Map();
let hashIndexCache = {
  expiresAt: 0,
  rows: []
};

const getCachedImageHashes = async () => {
  if (hashIndexCache.rows.length > 0 && hashIndexCache.expiresAt > Date.now()) {
    return hashIndexCache.rows;
  }

  const rows = await getAllImageHashes();
  hashIndexCache = {
    expiresAt: Date.now() + HASH_INDEX_CACHE_TTL_MS,
    rows
  };
  return rows;
};

const invalidateHashIndexCache = () => {
  hashIndexCache = {
    expiresAt: 0,
    rows: []
  };
};

/**
 * Combine a 16x16 average hash and a 16x16 difference hash. The old 8x8
 * grayscale hash collapsed too many white-background watch images together.
 */
export const computeHashFromBuffer = async (imageBuffer) => {
  try {
    const { data: averagePixels } = await sharp(imageBuffer)
      .rotate()
      .resize(16, 16, { fit: 'contain', background: '#ffffff' })
      .flatten({ background: '#ffffff' })
      .grayscale()
      .raw()
      .toBuffer({ resolveWithObject: true });

    let sum = 0;
    for (let index = 0; index < averagePixels.length; index++) {
      sum += averagePixels[index];
    }
    const average = sum / averagePixels.length;
    let averageHash = '';
    for (let index = 0; index < averagePixels.length; index++) {
      averageHash += averagePixels[index] >= average ? '1' : '0';
    }

    const { data: differencePixels } = await sharp(imageBuffer)
      .rotate()
      .resize(17, 16, { fit: 'contain', background: '#ffffff' })
      .flatten({ background: '#ffffff' })
      .grayscale()
      .raw()
      .toBuffer({ resolveWithObject: true });

    let differenceHash = '';
    for (let row = 0; row < 16; row++) {
      for (let column = 0; column < 16; column++) {
        const offset = row * 17 + column;
        differenceHash += differencePixels[offset] > differencePixels[offset + 1]
          ? '1'
          : '0';
      }
    }

    return averageHash + differenceHash;
  } catch (error) {
    console.error('Lỗi khi tính hash từ buffer:', error.message);
    return null;
  }
};

/**
 * Tải ảnh từ URL và tính hash
 */
export const computeHashFromUrl = async (url) => {
  try {
    const response = await axios.get(url, { responseType: 'arraybuffer' });
    const buffer = Buffer.from(response.data, 'binary');
    return await computeHashFromBuffer(buffer);
  } catch (error) {
    console.error(`Lỗi tải ảnh từ URL để tính hash (${url}):`, error.message);
    return null;
  }
};

/**
 * Tính Hamming Distance giữa 2 chuỗi nhị phân
 * Distance = 0 -> Giống nhau hoàn toàn
 * Distance <= 5 -> Rất giống nhau (chấp nhận được)
 */
export const getHammingDistance = (hash1, hash2) => {
  if (!hash1 || !hash2 || hash1.length !== hash2.length) {
    return Math.max(hash1?.length || 0, hash2?.length || 0, IMAGE_SIGNATURE_BITS);
  }
  let distance = 0;
  for (let i = 0; i < hash1.length; i++) {
    if (hash1[i] !== hash2[i]) distance++;
  }
  return distance;
};

const computeVisualPixelsFromBuffer = async (imageBuffer) => {
  const { data } = await sharp(imageBuffer)
    .rotate()
    .resize(64, 64, { fit: 'contain', background: '#ffffff' })
    .flatten({ background: '#ffffff' })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return data;
};

const computeVisualPixelsFromUrl = async (url) => {
  const cached = visualPixelCache.get(url);
  if (cached?.expiresAt > Date.now()) return cached.pixels;

  const response = await axios.get(url, {
    responseType: 'arraybuffer',
    timeout: 15000,
    maxRedirects: 10
  });
  const pixels = await computeVisualPixelsFromBuffer(Buffer.from(response.data));
  visualPixelCache.delete(url);
  visualPixelCache.set(url, {
    pixels,
    expiresAt: Date.now() + VISUAL_PIXEL_CACHE_TTL_MS
  });
  while (visualPixelCache.size > VISUAL_PIXEL_CACHE_MAX_ITEMS) {
    visualPixelCache.delete(visualPixelCache.keys().next().value);
  }
  return pixels;
};

const getMeanPixelDifference = (pixelsA, pixelsB) => {
  if (!pixelsA || !pixelsB || pixelsA.length !== pixelsB.length) return Infinity;
  let difference = 0;
  for (let index = 0; index < pixelsA.length; index++) {
    difference += Math.abs(pixelsA[index] - pixelsB[index]);
  }
  return difference / pixelsA.length;
};

export const findVisualMatchForSkus = async (targetImageSource, candidateSkus) => {
  try {
    const products = await getAllProductsWithImages();
    const imageBySku = new Map(
      products.map(product => [String(product.sku || '').trim().toUpperCase(), product.imageUrl])
    );
    const targetPixels = Buffer.isBuffer(targetImageSource)
      ? await computeVisualPixelsFromBuffer(targetImageSource)
      : await computeVisualPixelsFromUrl(targetImageSource);
    const uniqueCandidateSkus = Array.from(new Set(
      (candidateSkus || [])
        .map(sku => String(sku || '').trim().toUpperCase())
        .filter(Boolean)
    )).slice(0, 24);
    const visualMatches = (await Promise.all(uniqueCandidateSkus.map(async sku => {
      const imageUrl = imageBySku.get(sku);
      if (!imageUrl) return null;
      try {
        const candidatePixels = await computeVisualPixelsFromUrl(imageUrl);
        return {
          sku,
          visualDifference: getMeanPixelDifference(targetPixels, candidatePixels)
        };
      } catch (error) {
        console.warn(`⚠️ Không so sánh được ảnh catalog ${sku}:`, error.message);
        return null;
      }
    }))).filter(Boolean);

    visualMatches.sort((a, b) => a.visualDifference - b.visualDifference);
    const bestVisualMatch = visualMatches[0];
    const secondVisualMatch = visualMatches[1];
    const visualGap = secondVisualMatch
      ? secondVisualMatch.visualDifference - bestVisualMatch.visualDifference
      : Infinity;
    const isNearExactCatalogImage = bestVisualMatch?.visualDifference <= 2 && visualGap >= 2;
    const isCloseEnough = bestVisualMatch?.visualDifference <= 8 && visualGap >= 4;

    if (!isNearExactCatalogImage && !isCloseEnough) {
      console.warn(
        '⚠️ Đối chiếu pixel không đủ chắc chắn:',
        visualMatches.slice(0, 5).map(
          item => `${item.sku}:${item.visualDifference.toFixed(2)}`
        ).join(', ')
      );
      return null;
    }

    console.log(
      `✅ Ảnh khớp pixel duy nhất! SKU: ${bestVisualMatch.sku}, `
      + `difference: ${bestVisualMatch.visualDifference.toFixed(2)}`
    );
    return bestVisualMatch.sku;
  } catch (error) {
    console.error('⚠️ Không thể đối chiếu pixel ảnh:', error.message);
    return null;
  }
};

const verifyVisualMatch = async (targetImageSource, candidates) =>
  findVisualMatchForSkus(
    targetImageSource,
    candidates.map(candidate => candidate.sku)
  );

// --- PHẦN 2: TÌM KIẾM ---

const rankHashCandidates = (targetHash, allHashes) => {
  const bestDistanceBySku = new Map();
  for (const item of allHashes) {
    const dist = getHammingDistance(targetHash, item.hash);
    const sku = String(item.product_sku || '').trim().toUpperCase();
    if (!sku) continue;
    if (!bestDistanceBySku.has(sku) || dist < bestDistanceBySku.get(sku)) {
      bestDistanceBySku.set(sku, dist);
    }
  }

  return [...bestDistanceBySku.entries()]
    .map(([sku, distance]) => ({ sku, distance }))
    .sort((a, b) => a.distance - b.distance);
};

/**
 * Trả về các ảnh gần nhất để gợi ý họ model cho Vision.
 * Danh sách này không bao giờ được dùng để tự xác nhận SKU.
 */
export const findLikelySkuCandidates = async (targetHash, limit = 12) => {
  if (!targetHash) return [];
  const allHashes = await getCachedImageHashes();
  return rankHashCandidates(targetHash, allHashes)
    .slice(0, Math.max(1, limit));
};

/**
 * Persist customer-photo signatures only after Vision has confirmed an exact SKU.
 * A repeated or near-identical customer image can then bypass both Vision calls.
 */
export const rememberRecognizedCustomerImage = async (targetHash, productSku) => {
  const sku = String(productSku || '').trim().toUpperCase();
  if (!targetHash || targetHash.length !== IMAGE_SIGNATURE_BITS || !sku) return false;

  const allHashes = await getCachedImageHashes();
  const alreadyLearned = allHashes.some(item =>
    item.source_type === LEARNED_CUSTOMER_HASH_SOURCE
      && item.hash === targetHash
      && String(item.product_sku || '').trim().toUpperCase() === sku
  );
  if (alreadyLearned) return false;

  await saveImageHash(targetHash, sku, LEARNED_CUSTOMER_HASH_SOURCE);
  hashIndexCache = {
    expiresAt: Date.now() + HASH_INDEX_CACHE_TTL_MS,
    rows: [
      ...allHashes,
      {
        hash: targetHash,
        product_sku: sku,
        source_type: LEARNED_CUSTOMER_HASH_SOURCE
      }
    ]
  };
  console.log(`Learned customer image signature for SKU ${sku}.`);
  return true;
};

export const getHighConfidenceHashMatch = (
  rankedCandidates,
  hashLength = IMAGE_SIGNATURE_BITS
) => {
  if (hashLength !== IMAGE_SIGNATURE_BITS) return null;
  const bestMatch = rankedCandidates?.[0];
  const secondMatch = rankedCandidates?.[1];
  if (!bestMatch || bestMatch.distance > AVATAR_FAST_MATCH_THRESHOLD) return null;

  const distanceGap = secondMatch
    ? secondMatch.distance - bestMatch.distance
    : Infinity;
  return distanceGap >= AVATAR_FAST_MATCH_MIN_GAP ? bestMatch.sku : null;
};

/**
 * Tìm SKU khớp với ảnh dựa vào các hash đã lưu trong DB
 * Chỉ nhận hash gần, sau đó đối chiếu pixel màu để loại các SKU cùng hình khối.
 */
export const findMatchingSku = async (
  targetHash,
  threshold = IMAGE_SIGNATURE_MATCH_THRESHOLD,
  targetImageSource = ''
) => {
  if (!targetHash) return null;
  const allHashes = await getCachedImageHashes();
  const ranked = rankHashCandidates(targetHash, allHashes);
  const bestMatch = ranked[0];

  if (!bestMatch || bestMatch.distance > threshold) {
    return null;
  }

  const fastMatchSku = getHighConfidenceHashMatch(ranked, targetHash.length);
  if (fastMatchSku) {
    console.log(
      `⚡ Ảnh khớp chữ ký chắc chắn! SKU: ${fastMatchSku}, `
      + `distance: ${bestMatch.distance}, `
      + `gap: ${(ranked[1]?.distance ?? Infinity) - bestMatch.distance}`
    );
    return fastMatchSku;
  }

  const competingMatches = ranked
    .filter(item => item.distance <= threshold)
    .slice(0, MAX_HASH_VISUAL_CANDIDATES);

  if (targetImageSource) {
    const verifiedSku = await verifyVisualMatch(targetImageSource, competingMatches);
    if (verifiedSku) return verifiedSku;
    return null;
  }

  if (competingMatches.length > 1) {
    console.warn(
      `⚠️ Hash ảnh không đủ duy nhất (distance ${bestMatch.distance}): `
      + competingMatches.slice(0, 8).map(item => `${item.sku}:${item.distance}`).join(', ')
    );
    return null;
  }

  console.log(`✅ Hash ảnh khớp duy nhất! SKU: ${bestMatch.sku}, Distance: ${bestMatch.distance}`);
  return bestMatch.sku;
};

// --- PHẦN 3: ĐỒNG BỘ (SYNC) ---

/**
 * Tải tất cả ảnh từ Google Sheets, tính hash và lưu DB
 */
export const syncHashesFromSheets = async ({ forceFull = false } = {}) => {
  if (hashSyncPromise) {
    console.log('ℹ️ Đồng bộ hash đang chạy; dùng lại tiến trình hiện tại.');
    return hashSyncPromise;
  }

  hashSyncPromise = (async () => {
    console.log('🔄 Bắt đầu đồng bộ ảnh từ Google Sheets (Lớp 2)...');

    // Catalog must be refreshed first. Previously this happened after reading
    // catalog.json, so every sync was one Sheet version behind.
    const catalogSynced = await syncProductCatalog();
    if (!catalogSynced) {
      throw new Error('Không thể làm mới catalog từ Google Sheets.');
    }

    const products = await getAllProductsWithImages();
    if (!products || products.length === 0) {
      throw new Error('Không tìm thấy sản phẩm nào có ảnh trong Sheets.');
    }

    const existingHashes = await getAllImageHashes();
    const existingSheetHashes = existingHashes.filter(
      item => item.source_type === 'sheet'
    );
    const hasLegacySignature = existingSheetHashes.some(
      item => String(item.hash || '').length !== IMAGE_SIGNATURE_BITS
    );
    const existingCurrentSkus = new Set(
      existingSheetHashes
        .filter(item => String(item.hash || '').length === IMAGE_SIGNATURE_BITS)
        .map(item => String(item.product_sku || '').trim().toUpperCase())
    );
    const rebuildAll = forceFull || hasLegacySignature;
    const productsToHash = rebuildAll
      ? products
      : products.filter(
          product => !existingCurrentSkus.has(
            String(product.sku || '').trim().toUpperCase()
          )
        );

    if (productsToHash.length === 0) {
      console.log(`✅ Bộ nhận diện ảnh đã cập nhật đủ ${products.length} SKU.`);
      return {
        successCount: 0,
        totalProducts: products.length,
        skippedCount: products.length,
        rebuilt: false
      };
    }

    console.log(
      `🧠 ${rebuildAll ? 'Xây lại' : 'Bổ sung'} chữ ký ảnh cho `
      + `${productsToHash.length}/${products.length} SKU...`
    );
    const computedHashes = [];
    let cursor = 0;
    const workers = Array.from(
      { length: Math.min(HASH_SYNC_CONCURRENCY, productsToHash.length) },
      async () => {
        while (cursor < productsToHash.length) {
          const product = productsToHash[cursor++];
          if (!product?.imageUrl) continue;
          try {
            const hash = await computeHashFromUrl(product.imageUrl);
            if (hash) {
              computedHashes.push({
                hash,
                sku: String(product.sku || '').trim().toUpperCase()
              });
            }
          } catch (error) {
            console.warn(`⚠️ Bỏ qua SKU ${product.sku}: ${error.message}`);
          }
        }
      }
    );
    await Promise.all(workers);

    // Keep the old index available while images are being downloaded.
    if (rebuildAll) {
      await clearImageHashesBySource('sheet');
    }
    for (const item of computedHashes) {
      await saveImageHash(item.hash, item.sku, 'sheet');
    }
    invalidateHashIndexCache();

    console.log(
      `✅ Đồng bộ xong! Đã lưu chữ ký mới cho `
      + `${computedHashes.length}/${productsToHash.length} SKU.`
    );
    return {
      successCount: computedHashes.length,
      totalProducts: products.length,
      skippedCount: products.length - productsToHash.length,
      rebuilt: rebuildAll
    };
  })()
    .catch(error => {
      console.error('❌ Lỗi đồng bộ ảnh từ Sheets:', error.message);
      throw error;
    })
    .finally(() => {
      hashSyncPromise = null;
    });

  return hashSyncPromise;
};
