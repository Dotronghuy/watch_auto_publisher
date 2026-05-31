const fs = require('fs');
let code = fs.readFileSync('c:/Users/Admin/Downloads/watch-auto-publisher/backend/src/services/telegram.service.js', 'utf8');

code = code.replace(/bot\.answerCallbackQuery\((.*?)\);/g, 'bot.answerCallbackQuery($1).catch(e => console.error("Callback error:", e.message));');
code = code.replace(/bot\.editMessageReplyMarkup\((.*?)\);/g, 'bot.editMessageReplyMarkup($1).catch(e => console.error("Edit markup error:", e.message));');
code = code.replace(/bot\.sendMessage\((.*?)\);/g, 'bot.sendMessage($1).catch(e => console.error("Send message error:", e.message));');

fs.writeFileSync('c:/Users/Admin/Downloads/watch-auto-publisher/backend/src/services/telegram.service.js', code);
console.log('Success');
