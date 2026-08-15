import { buildExactGroupInspectionExpression } from './group-selection.mjs';

const DEFAULT_BACKEND_URL = 'http://127.0.0.1:3000';
const KEEPALIVE_ALARM = 'zalo-bridge-keepalive';
const POLL_WAIT_MS = 20_000;
const RETRY_DELAY_MS = 3_000;

let pollingPromise = null;

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeBackendUrl(value) {
  const url = new URL(String(value || DEFAULT_BACKEND_URL));
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(url.hostname)) {
    throw new Error('Backend phải là địa chỉ localhost của ZenWatch Tool.');
  }
  return url.origin;
}

async function parseResponse(response) {
  if (response.status === 204) return null;
  const text = await response.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { error: text };
  }
  if (!response.ok) {
    const error = new Error(data.error || `HTTP ${response.status}`);
    error.status = response.status;
    error.code = data.code;
    throw error;
  }
  return data;
}

async function getBridgeState() {
  return chrome.storage.local.get({
    backendUrl: DEFAULT_BACKEND_URL,
    bridgeToken: '',
    deviceSecret: '',
    clientId: '',
    targetTabId: null,
    targetTitle: '',
    targetUrl: '',
    lastError: '',
  });
}

async function setBadge(text, color) {
  await chrome.action.setBadgeBackgroundColor({ color });
  await chrome.action.setBadgeText({ text });
}

async function setLastError(message) {
  await chrome.storage.local.set({ lastError: String(message || '') });
}

async function clearPairing(message = '') {
  await chrome.storage.local.set({
    bridgeToken: '',
    deviceSecret: '',
    targetTabId: null,
    targetTitle: '',
    targetUrl: '',
    lastError: message,
  });
  await setBadge('OFF', '#6b7280');
}

async function pairCurrentTab({ code, backendUrl }) {
  const normalizedBackendUrl = normalizeBackendUrl(backendUrl);
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !String(tab.url || '').startsWith('https://chat.zalo.me/')) {
    throw new Error('Hãy mở đúng tab https://chat.zalo.me/ rồi bấm Kết nối.');
  }

  const previousState = await getBridgeState();
  const clientId = previousState.clientId || crypto.randomUUID();
  const response = await fetch(`${normalizedBackendUrl}/api/zenwatch/zalo/bridge/pair`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      code: String(code || '').trim(),
      clientId,
      tabId: tab.id,
      title: tab.title || 'Zalo Web',
      url: tab.url,
    }),
  });
  const data = await parseResponse(response);
  if (!data?.token || !data?.deviceSecret) {
    throw new Error('Backend không trả về đăng ký tự kết nối Zalo Bridge.');
  }
  await chrome.storage.local.set({
    backendUrl: normalizedBackendUrl,
    bridgeToken: data.token,
    deviceSecret: data.deviceSecret,
    clientId,
    targetTabId: tab.id,
    targetTitle: tab.title || 'Zalo Web',
    targetUrl: tab.url,
    lastError: '',
  });
  await setBadge('ON', '#16a34a');
  ensurePolling();
  return {
    connected: true,
    title: tab.title || 'Zalo Web',
    url: tab.url,
  };
}

async function enrollCurrentDevice(state) {
  const response = await fetch(`${normalizeBackendUrl(state.backendUrl)}/api/zenwatch/zalo/bridge/device`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${state.bridgeToken}` },
  });
  const data = await parseResponse(response);
  if (!data?.deviceSecret || !data?.clientId) {
    throw new Error('Backend không tạo được đăng ký tự kết nối Zalo Bridge.');
  }
  const updatedState = {
    ...state,
    clientId: data.clientId,
    deviceSecret: data.deviceSecret,
    lastError: '',
  };
  await chrome.storage.local.set({
    clientId: updatedState.clientId,
    deviceSecret: updatedState.deviceSecret,
    lastError: '',
  });
  return updatedState;
}

async function resumeBridge(state, tab) {
  if (!state.deviceSecret || !state.clientId) {
    const error = new Error('Chưa có đăng ký tự kết nối Zalo Bridge.');
    error.code = 'DEVICE_NOT_ENROLLED';
    throw error;
  }
  const normalizedBackendUrl = normalizeBackendUrl(state.backendUrl);
  const response = await fetch(`${normalizedBackendUrl}/api/zenwatch/zalo/bridge/resume`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      clientId: state.clientId,
      deviceSecret: state.deviceSecret,
      tabId: tab.id,
      title: tab.title || state.targetTitle || 'Zalo Web',
      url: tab.url,
    }),
  });
  const data = await parseResponse(response);
  if (!data?.token) throw new Error('Backend không cấp lại session Zalo Bridge.');
  const updatedState = {
    ...state,
    backendUrl: normalizedBackendUrl,
    bridgeToken: data.token,
    targetTabId: tab.id,
    targetTitle: tab.title || state.targetTitle || 'Zalo Web',
    targetUrl: tab.url,
    lastError: '',
  };
  await chrome.storage.local.set({
    backendUrl: updatedState.backendUrl,
    bridgeToken: updatedState.bridgeToken,
    targetTabId: updatedState.targetTabId,
    targetTitle: updatedState.targetTitle,
    targetUrl: updatedState.targetUrl,
    lastError: '',
  });
  await setBadge('ON', '#16a34a');
  return updatedState;
}

async function disconnectBridge(message = '') {
  const state = await getBridgeState();
  if (state.bridgeToken) {
    try {
      await fetch(`${normalizeBackendUrl(state.backendUrl)}/api/zenwatch/zalo/bridge/disconnect`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${state.bridgeToken}` },
      });
    } catch {
      // Backend có thể đã tắt; vẫn xóa pairing cục bộ.
    }
  }
  await clearPairing(message);
  return { connected: false };
}

function sendCommand(tabId, method, params = {}) {
  return chrome.debugger.sendCommand({ tabId }, method, params);
}

async function evaluate(tabId, expression, { returnByValue = true } = {}) {
  const response = await sendCommand(tabId, 'Runtime.evaluate', {
    expression,
    returnByValue,
    awaitPromise: true,
    userGesture: true,
  });
  if (response.exceptionDetails) {
    throw new Error(response.exceptionDetails.text || 'Không thể thao tác DOM Zalo.');
  }
  return returnByValue ? response.result?.value : response.result;
}

async function waitForValue(tabId, expression, timeoutMs = 15_000, intervalMs = 250) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await evaluate(tabId, expression);
    if (value) return value;
    await delay(intervalMs);
  }
  return null;
}

async function clickAt(tabId, point) {
  await sendCommand(tabId, 'Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x: point.x,
    y: point.y,
    button: 'left',
    clickCount: 1,
  });
  await sendCommand(tabId, 'Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x: point.x,
    y: point.y,
    button: 'left',
    clickCount: 1,
  });
}

async function pressEnter(tabId) {
  const base = {
    key: 'Enter',
    code: 'Enter',
    windowsVirtualKeyCode: 13,
    nativeVirtualKeyCode: 13,
  };
  await sendCommand(tabId, 'Input.dispatchKeyEvent', { type: 'rawKeyDown', ...base });
  await sendCommand(tabId, 'Input.dispatchKeyEvent', { type: 'char', text: '\r', ...base });
  await sendCommand(tabId, 'Input.dispatchKeyEvent', { type: 'keyUp', ...base });
}

function waitForFileChooser(tabId, timeoutMs = 8_000) {
  return new Promise((resolve) => {
    let timer;
    const finish = (backendNodeId = null) => {
      clearTimeout(timer);
      chrome.debugger.onEvent.removeListener(listener);
      resolve(backendNodeId);
    };
    const listener = (source, method, params) => {
      if (source.tabId === tabId && method === 'Page.fileChooserOpened') {
        finish(params?.backendNodeId || null);
      }
    };
    chrome.debugger.onEvent.addListener(listener);
    timer = setTimeout(() => finish(null), timeoutMs);
  });
}

async function selectExactGroup(tabId, groupName) {
  const targetJson = JSON.stringify(groupName);
  const searchReady = await waitForValue(
    tabId,
    `Boolean(document.querySelector('#contact-search-input'))`,
    30_000,
  );
  if (!searchReady) throw new Error('Không tìm thấy ô tìm kiếm nhóm Zalo.');

  await evaluate(tabId, `(() => {
    const input = document.querySelector('#contact-search-input');
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    input.focus();
    if (setter) setter.call(input, ${targetJson}); else input.value = ${targetJson};
    input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: ${targetJson} }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`);
  await delay(2_000);

  const inspectionExpression = buildExactGroupInspectionExpression(groupName);
  const inspection = await evaluate(tabId, inspectionExpression);
  const resultPoint = inspection?.resultPoint || null;

  if (resultPoint) {
    if (resultPoint.matches > 1) {
      throw new Error(`Có ${resultPoint.matches} kết quả trùng tên nhóm "${groupName}". Đã dừng để tránh gửi nhầm.`);
    }
    await clickAt(tabId, resultPoint);
    await delay(2_000);
  }

  const headerVerified = await waitForValue(
    tabId,
    `(${inspectionExpression}).targetMatched`,
    10_000,
    300,
  );

  if (!headerVerified) {
    throw new Error(`Không xác nhận được đúng cuộc trò chuyện nhóm "${groupName}". Đã dừng để tránh gửi nhầm.`);
  }
}

async function choosePhotoFiles(tabId, filePaths) {
  await sendCommand(tabId, 'Page.setInterceptFileChooserDialog', { enabled: true });
  try {
    const buttonPoint = await evaluate(tabId, `(() => {
      const selectors = [
        'div[data-id="btn_Send_Photo"]',
        '.icon-photo',
        '[title*="hình ảnh" i]',
        '[title*="ảnh" i]'
      ];
      for (const selector of selectors) {
        const element = document.querySelector(selector);
        if (!element) continue;
        const rect = element.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
        }
      }
      return null;
    })()`);
    if (!buttonPoint) throw new Error('Không tìm thấy nút gửi ảnh trên Zalo Web.');

    const chooserPromise = waitForFileChooser(tabId);
    await clickAt(tabId, buttonPoint);
    const backendNodeId = await chooserPromise;
    if (backendNodeId) {
      await sendCommand(tabId, 'DOM.setFileInputFiles', { files: filePaths, backendNodeId });
    } else {
      const fileInput = await evaluate(tabId, `(() => {
        const inputs = [...document.querySelectorAll('input[type="file"]')];
        return inputs.reverse().find((input) => input.multiple || String(input.accept || '').includes('image')) || null;
      })()`, { returnByValue: false });
      if (!fileInput?.objectId) throw new Error('Zalo không mở được bộ chọn ảnh.');
      await sendCommand(tabId, 'DOM.setFileInputFiles', { files: filePaths, objectId: fileInput.objectId });
      await sendCommand(tabId, 'Runtime.releaseObject', { objectId: fileInput.objectId });
    }
  } finally {
    await sendCommand(tabId, 'Page.setInterceptFileChooserDialog', { enabled: false }).catch(() => {});
  }

  await delay(Math.min(90_000, Math.max(5_000, filePaths.length * 2_500 + 2_000)));
}

async function sendComposerText(tabId, content) {
  const composerReady = await waitForValue(tabId, `(() => {
    const composer = document.querySelector('#richInput');
    if (!composer) return false;
    composer.focus();
    return true;
  })()`, 15_000, 250);
  if (!composerReady) throw new Error('Không tìm thấy ô nhập nội dung Zalo.');

  await sendCommand(tabId, 'Input.insertText', { text: content });
  await delay(1_500);
  const hasText = await evaluate(tabId, `(() => {
    const composer = document.querySelector('#richInput');
    return Boolean(composer && String(composer.innerText || composer.textContent || '').trim());
  })()`);
  if (!hasText) throw new Error('Zalo không nhận nội dung bài đăng.');

  await pressEnter(tabId);
  const composerCleared = await waitForValue(tabId, `(() => {
    const composer = document.querySelector('#richInput');
    return Boolean(composer && !String(composer.innerText || composer.textContent || '').trim());
  })()`, 20_000, 400);
  if (!composerCleared) {
    throw new Error('Không xác nhận được Zalo đã gửi nội dung.');
  }
}

async function executeJob(job, state) {
  const tabId = Number(state.targetTabId);
  if (!Number.isInteger(tabId)) throw new Error('Chưa chọn tab Zalo Web.');
  const tab = await chrome.tabs.get(tabId);
  if (!String(tab.url || '').startsWith('https://chat.zalo.me/')) {
    throw new Error('Tab đã kết nối không còn là Zalo Web.');
  }
  if (!Array.isArray(job.filePaths) || job.filePaths.length === 0) {
    throw new Error('Job không có ảnh để đăng.');
  }

  await chrome.tabs.update(tabId, { active: true });
  await chrome.windows.update(tab.windowId, { focused: true }).catch(() => {});

  let attached = false;
  const heartbeat = setInterval(() => {
    fetch(`${normalizeBackendUrl(state.backendUrl)}/api/zenwatch/zalo/bridge/heartbeat`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${state.bridgeToken}` },
    }).catch(() => {});
  }, 15_000);
  try {
    await chrome.debugger.attach({ tabId }, '1.3');
    attached = true;
    await Promise.all([
      sendCommand(tabId, 'DOM.enable'),
      sendCommand(tabId, 'Page.enable'),
      sendCommand(tabId, 'Runtime.enable'),
    ]);
    await selectExactGroup(tabId, job.groupName);
    await choosePhotoFiles(tabId, job.filePaths);
    await sendComposerText(tabId, job.content);
    return {
      success: true,
      detail: `Extension đã xác nhận gửi vào ${job.groupName}`,
    };
  } catch (error) {
    if (String(error?.message || '').includes('Another debugger')) {
      throw new Error('Tab Zalo đang mở DevTools hoặc bị trình khác điều khiển. Hãy đóng DevTools rồi thử lại.');
    }
    throw error;
  } finally {
    clearInterval(heartbeat);
    if (attached) await chrome.debugger.detach({ tabId }).catch(() => {});
  }
}

async function reportJobResult(state, jobId, result) {
  const url = `${normalizeBackendUrl(state.backendUrl)}/api/zenwatch/zalo/bridge/jobs/${encodeURIComponent(jobId)}/complete`;
  let lastError;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${state.bridgeToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(result),
      });
      return await parseResponse(response);
    } catch (error) {
      lastError = error;
      await delay(1_000 * (attempt + 1));
    }
  }
  throw lastError;
}

async function pollLoop() {
  while (true) {
    let state = await getBridgeState();
    if (!Number.isInteger(Number(state.targetTabId))) return;

    let targetTab;
    try {
      targetTab = await chrome.tabs.get(Number(state.targetTabId));
      if (!String(targetTab.url || '').startsWith('https://chat.zalo.me/')) {
        await disconnectBridge('Tab đã kết nối không còn là Zalo Web. Hãy kết nối lại đúng tab.');
        return;
      }
    } catch {
      await disconnectBridge('Tab Zalo Web đã bị đóng. Hãy mở tab và kết nối lại.');
      return;
    }

    if (!state.bridgeToken) {
      if (!state.deviceSecret) return;
      try {
        await resumeBridge(state, targetTab);
        continue;
      } catch (error) {
        if (error?.code === 'INVALID_DEVICE_CREDENTIAL') {
          await clearPairing('Đăng ký tự kết nối không còn hiệu lực. Hãy tạo mã kết nối mới.');
          return;
        }
        await setLastError(error?.message || 'Đang chờ ZenWatch Tool để tự kết nối lại.');
        await setBadge('!', '#d97706');
        await delay(RETRY_DELAY_MS);
        continue;
      }
    }

    if (!state.deviceSecret) {
      try {
        state = await enrollCurrentDevice(state);
      } catch (error) {
        if (error?.status === 401) {
          await clearPairing('Kết nối cũ đã hết hiệu lực. Hãy tạo mã thêm một lần để bật tự kết nối.');
          return;
        }
        await setLastError(error?.message || 'Chưa đăng ký được chế độ tự kết nối.');
        await setBadge('!', '#d97706');
        await delay(RETRY_DELAY_MS);
        continue;
      }
    }

    const abortController = new AbortController();
    const abortTimer = setTimeout(() => abortController.abort(), POLL_WAIT_MS + 10_000);
    try {
      const response = await fetch(
        `${normalizeBackendUrl(state.backendUrl)}/api/zenwatch/zalo/bridge/jobs/next?waitMs=${POLL_WAIT_MS}`,
        {
          headers: { Authorization: `Bearer ${state.bridgeToken}` },
          signal: abortController.signal,
        },
      );
      const data = await parseResponse(response);
      await setBadge('ON', '#16a34a');
      await setLastError('');
      if (!data?.job) continue;

      let result;
      try {
        result = await executeJob(data.job, state);
      } catch (error) {
        result = { success: false, error: error?.message || String(error) };
        await setLastError(result.error);
      }
      await reportJobResult(state, data.job.id, result);
    } catch (error) {
      if (error?.status === 401) {
        await chrome.storage.local.set({ bridgeToken: '' });
        try {
          await resumeBridge({ ...state, bridgeToken: '' }, targetTab);
          continue;
        } catch (resumeError) {
          if (resumeError?.code === 'INVALID_DEVICE_CREDENTIAL') {
            await clearPairing('Đăng ký tự kết nối không còn hiệu lực. Hãy tạo mã kết nối mới.');
            return;
          }
          await setLastError(resumeError?.message || 'Đang chờ ZenWatch Tool để tự kết nối lại.');
          await setBadge('!', '#d97706');
          await delay(RETRY_DELAY_MS);
          continue;
        }
      }
      if (error?.name !== 'AbortError') {
        await setLastError(error?.message || 'Không kết nối được ZenWatch Tool.');
        await setBadge('!', '#d97706');
      }
      await delay(RETRY_DELAY_MS);
    } finally {
      clearTimeout(abortTimer);
    }
  }
}

function ensurePolling() {
  if (pollingPromise) return pollingPromise;
  pollingPromise = pollLoop().finally(() => {
    pollingPromise = null;
  });
  return pollingPromise;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const run = async () => {
    if (message?.type === 'pair-current-tab') return pairCurrentTab(message);
    if (message?.type === 'disconnect') return disconnectBridge();
    if (message?.type === 'get-status') {
      const state = await getBridgeState();
      let tabAvailable = false;
      if (Number.isInteger(Number(state.targetTabId))) {
        try {
          const tab = await chrome.tabs.get(Number(state.targetTabId));
          tabAvailable = String(tab.url || '').startsWith('https://chat.zalo.me/');
        } catch {
          tabAvailable = false;
        }
      }
      return {
        connected: Boolean(state.bridgeToken && tabAvailable),
        autoReconnect: Boolean(state.deviceSecret && tabAvailable),
        tabAvailable,
        targetTitle: state.targetTitle,
        targetUrl: state.targetUrl,
        backendUrl: state.backendUrl,
        lastError: state.lastError,
      };
    }
    throw new Error('Lệnh extension không hợp lệ.');
  };

  run().then(sendResponse).catch((error) => {
    sendResponse({ error: error?.message || String(error) });
  });
  return true;
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create(KEEPALIVE_ALARM, { periodInMinutes: 0.5 });
  ensurePolling();
});

chrome.runtime.onStartup.addListener(() => ensurePolling());
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === KEEPALIVE_ALARM) ensurePolling();
});

chrome.alarms.create(KEEPALIVE_ALARM, { periodInMinutes: 0.5 });
ensurePolling();
