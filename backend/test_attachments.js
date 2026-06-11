const axios = require('axios');
const fs = require('fs');

const accounts = JSON.parse(fs.readFileSync('./backend/config/accounts.json', 'utf8'));
const token = accounts[0].page_access_token;
const pageId = accounts[0].page_id;

axios.get(`https://graph.facebook.com/v21.0/me/conversations`, {
  params: {
    fields: 'messages{id,message,attachments,shares}',
    access_token: token
  }
}).then(res => {
  console.log(JSON.stringify(res.data, null, 2));
}).catch(err => {
  console.error(err.response ? err.response.data : err.message);
});
