import { EventEmitter } from 'events';

// Singleton emitter để broadcast log từ bất kỳ service nào ra SSE
const logEmitter = new EventEmitter();
logEmitter.setMaxListeners(20);

/**
 * Ghi log và phát sự kiện để SSE bắt được
 * @param {string} message
 * @param {'info'|'success'|'error'|'typing'|'highlight'} type
 * @param {string} sender
 * @param {object} extra - { image, textPreview }
 */
export const liveLog = (message, type = 'info', sender = 'System', extra = {}) => {
  const payload = {
    time: new Date().toLocaleTimeString('vi-VN'),
    sender,
    message,
    type,
    ...extra
  };
  console.log(`[${sender}] ${message}`);
  logEmitter.emit('log', payload);
};

export default logEmitter;
