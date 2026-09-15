import { syncLocalImageEmbeddingIndex } from '../services/local-image-embedding.service.js';

const forceFull = process.argv.includes('--force');

try {
  const result = await syncLocalImageEmbeddingIndex({ forceFull });
  console.log(JSON.stringify(result, null, 2));
  process.exit(0);
} catch (error) {
  console.error(error);
  process.exit(1);
}
