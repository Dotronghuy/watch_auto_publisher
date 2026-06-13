const axios = require('axios');

const token1 = 'EAAXCHqNq3fkBRpXnrIXJZBdKL7XCIQZBq2G4aSJYb3HhbRyBmXPxCeHIPguZCA3HsYWxh1CMGT9YFRwXVALIlp6ZCprHOiduZCPlaNQX3ubRUBz90bdGyXwW9Vpig4cLjqyPCs2ZCu5kTmqfQgWvDzpG9JP70900vcGZCPky6fbOiwMhHfxXOgtDucufeydyJbgvbMZD';

async function main() {
  // Test 1: Check what page 269847139549241 is
  console.log('--- Test 1: pageId 269847139549241 ---');
  try {
    const r = await axios.get('https://graph.facebook.com/v19.0/269847139549241?fields=name,id&access_token=' + token1);
    console.log('RESULT:', JSON.stringify(r.data));
  } catch(e) {
    console.log('ERROR:', e.response ? JSON.stringify(e.response.data) : e.message);
  }

  // Test 2: Try getting post metrics
  console.log('--- Test 2: FB post metrics ---');
  try {
    const r = await axios.get('https://graph.facebook.com/v19.0/269847139549241_122231383718283911?fields=reactions.summary(total_count),comments.summary(total_count),shares&access_token=' + token1);
    console.log('RESULT:', JSON.stringify(r.data));
  } catch(e) {
    console.log('ERROR:', e.response ? JSON.stringify(e.response.data) : e.message);
  }

  // Test 3: IG post
  console.log('--- Test 3: IG post metrics ---');
  try {
    const r = await axios.get('https://graph.facebook.com/v19.0/17942819025210170?fields=like_count,comments_count&access_token=' + token1);
    console.log('RESULT:', JSON.stringify(r.data));
  } catch(e) {
    console.log('ERROR:', e.response ? JSON.stringify(e.response.data) : e.message);
  }
}

main().catch(console.error);
