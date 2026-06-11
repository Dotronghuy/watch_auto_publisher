const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./backend/crm.db');

db.all("SELECT * FROM messages ORDER BY created_time DESC LIMIT 10;", (err, rows) => {
  if (err) console.error(err);
  else console.log(JSON.stringify(rows, null, 2));
});
