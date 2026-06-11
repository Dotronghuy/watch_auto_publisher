const https = require('https');
const fs = require('fs');

const accounts = JSON.parse(fs.readFileSync('./backend/config/accounts.json', 'utf8'));
const token = accounts[0].fbAccessToken;

https.get(`https://graph.facebook.com/v21.0/me/conversations?fields=id,messages.limit(20){id,created_time,message,from,attachments{image_data,video_data,file_url}}&access_token=${token}`, (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    console.log(JSON.stringify(JSON.parse(data).data[0], null, 2));
  });
});
