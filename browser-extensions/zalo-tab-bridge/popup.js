const statusCard = document.querySelector('#statusCard');
const statusText = document.querySelector('#statusText');
const targetText = document.querySelector('#targetText');
const pairSection = document.querySelector('#pairSection');
const pairCode = document.querySelector('#pairCode');
const backendUrl = document.querySelector('#backendUrl');
const connectButton = document.querySelector('#connectButton');
const disconnectButton = document.querySelector('#disconnectButton');
const message = document.querySelector('#message');

function showMessage(text, type = '') {
  message.textContent = text || '';
  message.className = `message ${type}`.trim();
}

function sendMessage(payload) {
  return chrome.runtime.sendMessage(payload);
}

async function refreshStatus() {
  const state = await sendMessage({ type: 'get-status' });
  if (state?.error) throw new Error(state.error);
  backendUrl.value = state.backendUrl || 'http://127.0.0.1:3000';
  statusCard.classList.toggle('connected', state.connected);
  statusCard.classList.toggle('disconnected', !state.connected);
  statusText.textContent = state.connected
    ? (state.autoReconnect ? 'Đã kết nối · tự động' : 'Đã kết nối')
    : 'Chưa kết nối';
  targetText.textContent = state.connected
    ? (state.targetTitle || state.targetUrl || 'Zalo Web')
    : 'Mở chat.zalo.me để bắt đầu';
  pairSection.hidden = state.connected;
  disconnectButton.hidden = !state.connected;
  if (state.lastError) showMessage(state.lastError, 'error');
}

connectButton.addEventListener('click', async () => {
  const code = pairCode.value.replace(/\D/g, '');
  if (code.length !== 6) {
    showMessage('Hãy nhập mã kết nối gồm đúng 6 số.', 'error');
    return;
  }
  connectButton.disabled = true;
  showMessage('Đang kết nối tab hiện tại...');
  try {
    const result = await sendMessage({
      type: 'pair-current-tab',
      code,
      backendUrl: backendUrl.value,
    });
    if (result?.error) throw new Error(result.error);
    showMessage('Đã kết nối. Bạn có thể quay lại ZenWatch Tool.', 'success');
    await refreshStatus();
  } catch (error) {
    showMessage(error?.message || String(error), 'error');
  } finally {
    connectButton.disabled = false;
  }
});

disconnectButton.addEventListener('click', async () => {
  disconnectButton.disabled = true;
  try {
    const result = await sendMessage({ type: 'disconnect' });
    if (result?.error) throw new Error(result.error);
    showMessage('Đã ngắt kết nối.', 'success');
    await refreshStatus();
  } catch (error) {
    showMessage(error?.message || String(error), 'error');
  } finally {
    disconnectButton.disabled = false;
  }
});

pairCode.addEventListener('input', () => {
  pairCode.value = pairCode.value.replace(/\D/g, '').slice(0, 6);
});

refreshStatus().catch((error) => showMessage(error?.message || String(error), 'error'));
