import { defineConfig, createLogger } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Custom logger để tắt lỗi proxy đỏ khi backend restart
const logger = createLogger();
const originalWarning = logger.warn;
const originalError = logger.error;
logger.warn = (msg, options) => {
  if (msg.includes('http proxy error')) return;
  originalWarning(msg, options);
};
logger.error = (msg, options) => {
  if (msg.includes('http proxy error')) return;
  originalError(msg, options);
};

// Helper: cấu hình proxy im lặng khi backend offline
function silentProxyConfig(proxy) {
  proxy.on('error', (err, req, res) => {
    if (!res.headersSent) {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        success: false,
        code: 'BACKEND_OFFLINE',
        message: 'Backend đang tắt hoặc đang khởi động lại. Hãy mở lại hệ thống và giữ cửa sổ chạy tool.'
      }));
    }
  });
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [tailwindcss(), react()],
  customLogger: logger,
  server: {
    port: 5173,
    open: true,
    host: true,
    allowedHosts: true,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3000',
        changeOrigin: true,
        configure: (proxy) => silentProxyConfig(proxy)
      },
      '/images': {
        target: 'http://127.0.0.1:3000',
        changeOrigin: true,
        configure: (proxy) => silentProxyConfig(proxy)
      },
      '/webhook': {
        target: 'http://127.0.0.1:3000',
        changeOrigin: true,
        configure: (proxy) => silentProxyConfig(proxy)
      }
    }
  },
})
