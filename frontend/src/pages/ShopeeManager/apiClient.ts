const apiClient = {
  getModels: async () => (await fetch('/api/shopee/models')).json(),
  createModel: async (name: string) => (await fetch('/api/shopee/models', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) })).json(),
  deleteModel: async (id: string) => (await fetch(`/api/shopee/models?id=${id}`, { method: 'DELETE' })).json(),
  getVariants: async (modelId: string) => (await fetch(`/api/shopee/variants/${modelId}`)).json(),
  createVariant: async (data: any) => (await fetch('/api/shopee/variants', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) })).json(),
  updateVariant: async (id: string, data: any) => (await fetch(`/api/shopee/variants/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) })).json(),
  deleteVariant: async (id: string) => (await fetch(`/api/shopee/variants/${id}`, { method: 'DELETE' })).json(),
  getMissingShopeeVariants: async () => (await fetch('/api/shopee/variants/missing')).json(),
  getSetting: async (key: string) => { const r = await fetch(`/api/shopee/settings/${key}`); const d = await r.json(); return d.value; },
  saveSetting: async (key: string, value: string) => (await fetch('/api/shopee/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key, value }) })).json(),
  
  // Thay thế các hàm gọi Electron File Dialog bằng Web File Input và FormData Upload
  selectImage: async () => {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      input.onchange = async (e: any) => {
        const file = e.target.files[0];
        if (!file) return resolve(null);
        const formData = new FormData();
        formData.append('file', file);
        const res = await fetch('/api/shopee/upload-image', { method: 'POST', body: formData });
        const data = await res.json();
        resolve(data.path);
      };
      input.click();
    });
  },
  selectMultipleImages: async () => {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      input.multiple = true;
      input.onchange = async (e: any) => {
        const files = Array.from(e.target.files);
        if (files.length === 0) return resolve([]);
        const formData = new FormData();
        files.forEach((f: any) => formData.append('files', f));
        const res = await fetch('/api/shopee/upload-multiple-images', { method: 'POST', body: formData });
        const data = await res.json();
        resolve(data.paths);
      };
      input.click();
    });
  },
  generateBulkAvatarsPhotoshop: async () => ({ success: false, message: 'Tính năng Photoshop cục bộ không được hỗ trợ trên Web.' }),
  
  importExcel: async () => {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.xlsx, .xls';
      input.onchange = async (e: any) => {
        const file = e.target.files[0];
        if (!file) return resolve({ success: false, message: 'Đã hủy' });
        const formData = new FormData();
        formData.append('file', file);
        const res = await fetch('/api/shopee/import-excel', { method: 'POST', body: formData });
        resolve(await res.json());
      };
      input.click();
    });
  },
  importSapoExcel: async () => {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.xlsx, .xls';
      input.onchange = async (e: any) => {
        const file = e.target.files[0];
        if (!file) return resolve({ success: false, message: 'Đã hủy' });
        const formData = new FormData();
        formData.append('file', file);
        const res = await fetch('/api/shopee/import-sapo-excel', { method: 'POST', body: formData });
        resolve(await res.json());
      };
      input.click();
    });
  },
  updateShopeeIdsFromFile: async () => ({ success: false, message: 'Tính năng không hỗ trợ' }),
  importShopeeIdsCustomExcel: async () => ({ success: false, message: 'Tính năng không hỗ trợ' }),
  selectFile: async () => {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/png, image/jpeg'; // Dành cho Watermark
      input.onchange = async (e: any) => {
        const file = e.target.files[0];
        if (!file) return resolve(null);
        const formData = new FormData();
        formData.append('file', file);
        const res = await fetch('/api/shopee/upload-watermark', { method: 'POST', body: formData });
        const data = await res.json();
        resolve(data.path);
      };
      input.click();
    });
  },
  deleteAllModels: async () => (await fetch('/api/shopee/models', { method: 'DELETE' })).json(),
  
  generateAvatar: async (variantId: string) => (await fetch(`/api/shopee/generate-avatar/${variantId}`, { method: 'POST' })).json(),
  autoMatchImagesAi: async () => (await fetch('/api/shopee/auto-match-images-ai', { method: 'POST' })).json(),
  shopeeLogin: async () => (await fetch('/api/shopee/shopee-login', { method: 'POST' })).json(),
  runFullAutoSync: async (prioritySku?: string) => (await fetch('/api/shopee/run-full-auto-sync', { 
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prioritySku })
  })).json(),
  stopAutoSync: async () => (await fetch('/api/shopee/stop-auto-sync', { method: 'POST' })).json(),
  syncShopee: async (variantId: string) => (await fetch(`/api/shopee/sync-shopee/${variantId}`, { method: 'POST' })).json(),
  testTelegramNotification: async () => ({ success: true, message: 'Web: Test Telegram' }),
  getAutoSyncLogs: async () => (await fetch('/api/shopee/auto-sync-logs')).json(),

  onSapoProgress: (callback: any) => {},
  onSyncProgress: (callback: any) => {}
};

export default apiClient;
