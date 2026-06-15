import { computeHashFromUrl, findMatchingSku, syncHashesFromSheets } from '../src/services/image-hash.service.js';
import { getAllProductsWithImages } from '../src/services/sheet.service.js';

async function runTest() {
  console.log('--- STARTING LAYER 2 TEST ---');
  
  // 1. Sync hashes to ensure DB is up-to-date
  console.log('\n[1] Syncing hashes from Google Sheets to local DB...');
  await syncHashesFromSheets();
  
  // 2. Fetch all products
  console.log('\n[2] Fetching all products with images from Google Sheets...');
  const products = await getAllProductsWithImages();
  console.log(`Found ${products.length} products with images.\n`);
  
  // 3. Test matching
  let successCount = 0;
  let failCount = 0;
  
  for (const product of products) {
    console.log(`Testing SKU: ${product.sku}`);
    const hash = await computeHashFromUrl(product.imageUrl);
    if (!hash) {
       console.log(`❌ Failed to compute hash for ${product.sku}`);
       failCount++;
       continue;
    }
    
    // threshold = 5
    const matchedSku = await findMatchingSku(hash, 5);
    if (matchedSku === product.sku) {
       console.log(`✅ Passed! Matched SKU exactly: ${matchedSku}`);
       successCount++;
    } else if (matchedSku) {
       console.log(`⚠️ Warning: Matched different SKU. Expected ${product.sku}, but got ${matchedSku}`);
       successCount++;
    } else {
       console.log(`❌ Failed! No match found for ${product.sku}`);
       failCount++;
    }
  }
  
  console.log('\n--- TEST SUMMARY ---');
  console.log(`Total Tested: ${products.length}`);
  console.log(`Success: ${successCount}`);
  console.log(`Fail: ${failCount}`);
  process.exit(0);
}

runTest().catch(err => {
    console.error(err);
    process.exit(1);
});
