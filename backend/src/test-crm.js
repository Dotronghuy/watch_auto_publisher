import { syncAllCRM } from './services/crm.service.js';
import { initCRMDB } from './utils/crm.db.js';

(async () => {
  try {
    await initCRMDB();
    console.log("DB Init successful. Starting sync...");
    await syncAllCRM();
    console.log("Sync completed.");
  } catch(e) {
    console.error("Error during sync:", e);
  }
})();
