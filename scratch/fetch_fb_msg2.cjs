const https = require('https');
const fs = require('fs');

const accounts = JSON.parse(fs.readFileSync('./backend/config/accounts.json', 'utf8'));
const token = accounts[0].fbAccessToken;

https.get(`https://graph.facebook.com/v21.0/t_3322618894584156?fields=messages{id,created_time,message,from,attachments,shares}&access_token=${token}`, (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    console.log(JSON.stringify(JSON.parse(data), null, 2));
  });
});
