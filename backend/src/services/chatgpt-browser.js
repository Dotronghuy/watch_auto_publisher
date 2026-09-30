import {
    CHATGPT_ASSISTANT_MESSAGE_SELECTOR,
    CHATGPT_USER_MESSAGE_SELECTOR,
} from './chatgpt-submission-policy.js';
import { isTransientChatGPTAssistantText } from './generated-content-sanitizer.js';

const PROMPT_SELECTORS = [
    '#prompt-textarea[contenteditable="true"]',
    'textarea#prompt-textarea',
    '[contenteditable="true"][data-lexical-editor]',
    '[contenteditable="true"][role="textbox"]',
    'main [contenteditable="true"]',
];
const SEND_SELECTOR = [
    'button[data-testid="send-button"]',
    'button#composer-submit-button:not([data-testid="stop-button"])',
    'button[aria-label="Send prompt" i]',
    'button[aria-label="Send message" i]',
    'button[aria-label="Send" i]',
    'button[aria-label="Gửi lời nhắc" i]',
    'button[aria-label="Gửi tin nhắn" i]',
    'button[aria-label="Gửi" i]',
    'button[type="submit"]',
].join(', ');
const STOP_SELECTOR = [
    'button[data-testid="stop-button"]',
    'button[aria-label="Stop generating" i]',
    'button[aria-label="Stop streaming" i]',
    'button[aria-label="Dừng tạo" i]',
    'button[aria-label="Dừng tạo câu trả lời" i]',
].join(', ');
const normalize = (text) => String(text || '').replace(/\s+/g, ' ').trim();
const stripTransientAssistantPrefix = (value) => String(value || '')
    .replace(/^(?:Đang tìm(?: kiếm)? ngữ cảnh(?: dự án)?|Searching project context|Đang suy luận|Thinking|Đã ngừng suy luận|Stopped reasoning)[\s.…:-]*/iu, '')
    .trim();
const readDraft = (locator) => locator.evaluate((element) => (
    'value' in element ? element.value : element.innerText
)).catch(() => null);

export const hasConfirmedChatGPTSubmission = ({ baselineUsers = [], observedUsers = [], expectedText = '' }) => {
    const latest = observedUsers.at(-1);
    if (!latest) return false;
    const baselineKeys = new Set(baselineUsers.map((turn) => `${turn.id || ''}\n${normalize(turn.text)}`));
    const latestKey = `${latest.id || ''}\n${normalize(latest.text)}`;
    return (
        (observedUsers.length > baselineUsers.length || !baselineKeys.has(latestKey))
        && normalize(latest.text).includes(normalize(expectedText))
    );
};

export const findChatGPTPrompt = async (page, timeout = 15_000) => {
    const deadline = Date.now() + timeout;
    do {
        for (const selector of PROMPT_SELECTORS) {
            const matches = page.locator(selector);
            for (let index = await matches.count() - 1; index >= 0; index--) {
                const locator = matches.nth(index);
                if (await locator.isVisible() && await locator.isEditable()) return locator;
            }
        }
        await page.waitForTimeout(250);
    } while (Date.now() < deadline);
    return null;
};

// A turn can match both role selectors. Use one DOM node per turn consistently
// for the baseline, submission acknowledgement and response extraction.
export const readChatGPTTurns = (page) => page.evaluate(({ userSelector, assistantSelector }) => {
    const turnSelector = '[data-testid^="conversation-turn-"], [data-turn]';
    const visible = (element) => element.getClientRects().length > 0
        && getComputedStyle(element).visibility !== 'hidden';
    const unique = (selector) => [...new Set([...document.querySelectorAll(selector)]
        .map((element) => element.closest(turnSelector) || element))].filter(visible);
    const users = unique(userSelector);
    const assistants = unique(assistantSelector);
    const cleanText = (root) => {
        const clone = root.cloneNode(true);
        clone.querySelectorAll('button, [role="button"], [data-testid*="citation" i], [data-testid*="source" i], [data-testid*="file" i], script, style')
            .forEach((node) => node.remove());
        clone.querySelectorAll('p, div, li, pre, h1, h2, h3, blockquote, br')
            .forEach((node) => node.append('\n'));
        return (clone.textContent || '').trim();
    };
    const serialize = (element) => ({
        id: element.getAttribute('data-message-id')
            || element.querySelector('[data-message-id]')?.getAttribute('data-message-id')
            || element.id || element.getAttribute('data-testid') || '',
        text: cleanText(element),
    });
    return {
        users: users.map(serialize),
        assistants: assistants.map((element) => {
            // Project context/thinking and the final answer may have separate
            // markdown blocks within the same assistant turn.
            const markdown = [...element.querySelectorAll('.markdown')].filter((node) => (
                visible(node) && !node.parentElement?.closest('.markdown')
            ));
            return {
                ...serialize(element),
                blocks: (markdown.length ? markdown : [element]).map(cleanText),
                afterLatestUser: Boolean(users.at(-1)
                    && (users.at(-1).compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING)),
            };
        }),
    };
}, { userSelector: CHATGPT_USER_MESSAGE_SELECTOR, assistantSelector: CHATGPT_ASSISTANT_MESSAGE_SELECTOR });

export const getChatGPTAssistantMessageCount = async (page) => (await readChatGPTTurns(page)).assistants.length;

export const getLatestChatGPTAssistantTextAfterBaseline = async ({ page, baselineAssistantMessageCount = 0 }) => {
    const turns = await readChatGPTTurns(page);
    // Prefer the assistant turn after the latest user turn. If ChatGPT
    // virtualizes/reorders the conversation DOM, fall back to the canonical
    // baseline index instead of returning no text forever.
    const afterLatestUser = turns.assistants.filter((turn) => turn.afterLatestUser);
    const candidates = afterLatestUser.length
        ? afterLatestUser
        : turns.assistants.slice(baselineAssistantMessageCount);
    for (const turn of candidates.slice().reverse()) {
        const text = turn.blocks
            .flatMap((block) => String(block || '').split(/\n+/))
            .map(stripTransientAssistantPrefix)
            .filter((line) => line && !isTransientChatGPTAssistantText(line))
            .join('\n')
            .trim();
        const cleanedText = stripTransientAssistantPrefix(text);
        if (cleanedText) return cleanedText;
    }
    return '';
};

// Đánh dấu turn cuối cùng hiện tại làm mốc trước khi gửi. Các luồng đọc chỉ
// quan tâm nội dung nằm sau mốc này để không bao giờ nhặt nhầm dữ liệu cũ.
// Ưu tiên turn article; nếu testid turn cũng đã đổi thì lấy phần tử đứng ngay
// trước ô soạn thảo (chính là turn cuối của hội thoại).
export const markChatGPTLatestTurnAsBaseline = (page) => page.evaluate(() => {
    let lastTurn = null;
    const turns = [...document.querySelectorAll('[data-testid^="conversation-turn-"]')];
    lastTurn = turns.at(-1) || null;
    if (!lastTurn) {
        const prompt = document.querySelector('#prompt-textarea')
            || document.querySelector('[contenteditable="true"][data-lexical-editor]')
            || document.querySelector('main [contenteditable="true"]');
        const composer = prompt?.closest('form')
            || prompt?.closest('[data-testid="composer"]')
            || prompt?.parentElement?.parentElement
            || null;
        lastTurn = composer?.previousElementSibling || null;
    }
    if (lastTurn) {
        lastTurn.setAttribute('data-znw-baseline', '1');
        // Tham chiếu node sống qua nhiều lần evaluate trong cùng trang.
        window.__znwBaselineNode = lastTurn;
    }
}).catch(() => {});

// Fallback DOM-agnostic: selector role (data-message-author-role/data-turn) và
// cả testid turn đều có thể đổi theo bản cập nhật giao diện ChatGPT. Thử theo
// thứ tự: (1) turn nằm sau mốc baseline (qua node sống, không phụ thuộc
// attribute), (2) turn đứng sau turn user chứa prompt, (3) cắt văn bản vùng hội
// thoại, (4) block .markdown cuối cùng. Tuyệt đối không trả về nội dung prompt
// của user — chỉ trả phản hồi mới của ChatGPT.
export const getLatestChatGPTTextFromDom = async ({ page, submittedPrompt = '' }) => page.evaluate(({ submittedPrompt }) => {
    const normalize = (value) => String(value || '').replace(/\s+/g, ' ').trim();
    const cleanText = (root) => {
        const clone = root.cloneNode(true);
        clone.querySelectorAll('button, [role="button"], [data-testid*="citation" i], [data-testid*="source" i], [data-testid*="file" i], script, style')
            .forEach((node) => node.remove());
        clone.querySelectorAll('p, div, li, pre, h1, h2, h3, blockquote, br')
            .forEach((node) => node.append('\n'));
        return (clone.textContent || '').trim();
    };
    const rendered = (element) => {
        const style = window.getComputedStyle(element);
        return style.display !== 'none' && style.visibility !== 'hidden';
    };

    const normalizedPrompt = normalize(submittedPrompt);
    const promptPrefix = normalizedPrompt.length >= 30 ? normalizedPrompt.slice(0, 80) : '';
    // Turn của user luôn chứa prompt vừa gửi. ChatGPT có thể thu gọn tin nhắn
    // dài bằng "Read more" nên so khớp nhiều độ dài + chiều ngược lại (turn bị
    // cắt ngắn chính là phần đầu của prompt).
    const isPromptEcho = (text) => {
        if (!text || !promptPrefix) return false;
        const chunks = [normalizedPrompt, ...(normalizedPrompt.length >= 200
            ? [normalizedPrompt.slice(0, 200)] : []), normalizedPrompt.slice(0, 120), promptPrefix];
        if (chunks.some((chunk) => text.includes(chunk))) return true;
        return text.length >= 40 && text.length <= normalizedPrompt.length
            && normalizedPrompt.startsWith(text);
    };

    const turns = [...document.querySelectorAll('[data-testid^="conversation-turn-"]')]
        .filter(rendered);
    // Mốc baseline lưu qua node sống: vẫn đúng cả khi attribute bị ghi lên phần
    // tử không phải turn article (fallback cạnh ô soạn thảo).
    const markerNode = document.querySelector('[data-znw-baseline]') || window.__znwBaselineNode || null;
    const isAfterMarker = (turn) => !markerNode || (
        turn !== markerNode
        && Boolean(markerNode.compareDocumentPosition(turn) & Node.DOCUMENT_POSITION_FOLLOWING)
    );

    // (1) Có mốc baseline → chỉ đọc turn nằm sau mốc, bỏ qua turn echo prompt.
    if (markerNode) {
        const newTurns = turns.filter(isAfterMarker);
        for (let index = newTurns.length - 1; index >= 0; index--) {
            const text = normalize(cleanText(newTurns[index]));
            if (!text) continue;
            if (isPromptEcho(text)) continue;
            return text;
        }
        // Testid turn cũng có thể đã đổi: thử block .markdown nằm sau mốc.
        const markdowns = [...document.querySelectorAll('.markdown')]
            .filter(rendered)
            .filter(isAfterMarker);
        for (let index = markdowns.length - 1; index >= 0; index--) {
            const text = normalize(cleanText(markdowns[index]));
            if (text && !isPromptEcho(text)) return text;
        }
        // Mốc còn đó nhưng chưa có phản hồi mới → trả rỗng, không nhặt dữ liệu cũ.
        return '';
    }

    // (2) Không có mốc (trang chuyển chat / DOM đổi hẳn): tìm turn user chứa
    // prompt, chỉ lấy văn bản của các turn ĐỨNG SAU nó (phản hồi ChatGPT).
    let userTurnIndex = -1;
    for (let index = 0; index < turns.length; index++) {
        const text = normalize(cleanText(turns[index]));
        if (text && text.includes(promptPrefix)) userTurnIndex = index;
    }
    if (userTurnIndex >= 0) {
        for (let index = userTurnIndex + 1; index < turns.length; index++) {
            const text = normalize(cleanText(turns[index]));
            if (text && !isPromptEcho(text)) return text;
        }
        return '';
    }

    // (3) Không có cấu trúc turn: cắt văn bản vùng hội thoại. Ưu tiên cắt sau
    // NGUYÊN VĂN prompt; nếu chỉ khớp 80 ký tự đầu (turn user bị thu gọn) thì
    // gọt tiếp phần đuôi còn là echo của prompt trước khi trả kết quả.
    if (promptPrefix) {
        const main = document.querySelector('main') || document.body;
        const bodyText = normalize(cleanText(main));
        let cutAt = -1;
        if (normalizedPrompt.length >= 30) {
            const fullIdx = bodyText.lastIndexOf(normalizedPrompt);
            if (fullIdx >= 0) cutAt = fullIdx + normalizedPrompt.length;
        }
        if (cutAt < 0) {
            const prefixIdx = bodyText.lastIndexOf(promptPrefix);
            if (prefixIdx >= 0) cutAt = prefixIdx + promptPrefix.length;
        }
        if (cutAt >= 0) {
            let tail = bodyText.slice(cutAt);
            while (tail && normalizedPrompt.slice(promptPrefix.length).startsWith(tail.slice(0, 40))) {
                tail = tail.slice(40).trim();
            }
            tail = tail.replace(/^(?:ChatGPT\s*(?:đã nói|said)|Assistant)\s*[:：]\s*/i, '');
            tail = tail.replace(/^(?:…|\.\.\.)?\s*(?:Read more|Xem thêm)\b[^#\n]*/i, '');
            // Bỏ dòng khước từ cố định cuối trang ChatGPT.
            tail = tail.replace(/ChatGPT có thể mắc lỗi[\s\S]*$/i, '');
            tail = tail.trim();
            if (tail) return tail;
        }
    }

    // (4) Cuối cùng: block markdown cuối cùng hiển thị, bỏ qua block echo prompt.
    const markdowns = [...document.querySelectorAll('.markdown')].filter(rendered);
    for (let index = markdowns.length - 1; index >= 0; index--) {
        const text = normalize(cleanText(markdowns[index]));
        if (text && !isPromptEcho(text)) return text;
    }
    return '';
}, { submittedPrompt });

// Chẩn đoán DOM khi không đọc được phản hồi: in số lượng phần tử khớp từng
// selector để biết giao diện ChatGPT đã đổi ở đâu.
export const diagnoseChatGPTDom = (page) => page.evaluate(() => ({
    url: window.location.href,
    title: document.title,
    turnCount: document.querySelectorAll('[data-testid^="conversation-turn-"]').length,
    userRoleCount: document.querySelectorAll('[data-message-author-role="user"], [data-turn="user"]').length,
    assistantRoleCount: document.querySelectorAll('[data-message-author-role="assistant"], [data-turn="assistant"]').length,
    markdownCount: document.querySelectorAll('.markdown').length,
    mainTextLength: (document.querySelector('main')?.innerText || '').length,
})).catch((error) => ({ error: error.message }));

export const isChatGPTGenerating = async (page) => {
    const buttons = page.locator(STOP_SELECTOR);
    for (let index = 0; index < await buttons.count(); index++) {
        if (await buttons.nth(index).isVisible()) return true;
    }
    return false;
};

export const stopChatGPTGenerationIfVisible = async (page) => {
    const buttons = page.locator(STOP_SELECTOR);
    for (let index = 0; index < await buttons.count(); index++) {
        if (await buttons.nth(index).isVisible()) {
            await buttons.nth(index).click();
            return;
        }
    }
};

// ChatGPT hiện modal góp ý ("Chia sẻ góp ý") sau mỗi lần tạo ảnh. Modal này chặn
// toàn bộ thao tác chuột ở ảnh kế tiếp nên phải đóng ngay khi phát hiện.
// Chỉ đóng bằng nút X hoặc phím Escape — tuyệt đối không bấm nút "Gửi".
export const closeChatGPTFeedbackDialogIfVisible = async (page) => {
    try {
        const dialog = page.locator([
            '[role="dialog"]:has-text("Chia sẻ góp ý")',
            '[role="dialog"]:has-text("Share feedback")',
            '[role="dialog"]:has-text("Chia sẻ chi tiết")',
            '[role="dialog"]:has-text("Share details")',
        ].join(', ')).first();
        if (!(await dialog.isVisible({ timeout: 500 }).catch(() => false))) return false;

        const closeButton = dialog.locator([
            'button[aria-label="Close"]',
            'button[aria-label="Đóng"]',
            '[data-testid="close-button"]',
        ].join(', ')).first();
        if (await closeButton.isVisible({ timeout: 500 }).catch(() => false)) {
            await closeButton.click({ force: true }).catch(() => {});
        } else {
            await page.keyboard.press('Escape');
        }
        await page.waitForTimeout(400);
        return true;
    } catch (error) {
        return false;
    }
};

const findSendButton = async (promptLocator) => {
    // Never click another form's submit button (search/share/project dialogs).
    const container = promptLocator.locator('xpath=ancestor::*[self::form or @data-type="unified-composer" or @data-testid="composer"][1]');
    const root = await container.count() ? container : promptLocator.locator('..').locator('..');
    const buttons = root.locator(SEND_SELECTOR);
    for (let index = await buttons.count() - 1; index >= 0; index--) {
        const button = buttons.nth(index);
        const label = await button.getAttribute('aria-label') || '';
        if (/stop|dừng|voice|giọng nói/i.test(label)) continue;
        if (await button.getAttribute('data-testid') === 'stop-button') continue;
        if (await button.isVisible() && await button.isEnabled()
            && await button.getAttribute('aria-disabled') !== 'true') return button;
    }
    return null;
};

export const submitChatGPTPrompt = async ({
    page, promptLocator, log = () => {}, checkStop, assertReady = async () => {},
    confirmationTimeout = 20_000, buttonTimeout = 15_000, pollInterval = 300,
}) => {
    // Trả về 'confirmed' khi xác nhận được user-turn mới qua DOM, 'assumed' khi
    // chỉ dựa vào ô nhập trống sau khi bấm gửi. Caller log đúng trạng thái.
    const baseline = await readChatGPTTurns(page);
    const expectedText = normalize(await readDraft(promptLocator));
    if (!expectedText) throw Object.assign(new Error('Ô nhập ChatGPT đang trống trước khi gửi.'), { code: 'CHATGPT_EMPTY_PROMPT' });
    const check = async () => {
        if (checkStop?.()) throw new Error('STOP_REQUESTED');
        await assertReady();
    };
    const acknowledged = async () => {
        const { users } = await readChatGPTTurns(page);
        // Match the submitted draft, so a stale/remounted user turn cannot
        // acknowledge this request. Whitespace changes from the editor are OK.
        return hasConfirmedChatGPTSubmission({
            baselineUsers: baseline.users,
            observedUsers: users,
            expectedText,
        });
    };
    const confirmed = () => {
        log('[Playwright] ✅ Đã xác nhận tin nhắn user mới chứa đúng prompt ChatGPT.');
        return 'confirmed';
    };

    let sentAttempted = false;
    for (let attempt = 0; attempt < 3; attempt++) {
        await check();
        if (await acknowledged()) return confirmed();
        let currentPrompt = await findChatGPTPrompt(page, 1000);
        let sendButton = null;
        const buttonDeadline = Date.now() + (attempt === 0 ? buttonTimeout : Math.min(buttonTimeout, 4000));
        do {
            await check();
            if (await acknowledged()) return confirmed();
            currentPrompt = await findChatGPTPrompt(page, 500);
            if (currentPrompt) sendButton = await findSendButton(currentPrompt);
            if (sendButton) break;
            await page.waitForTimeout(pollInterval);
        } while (Date.now() < buttonDeadline);

        const draft = currentPrompt ? normalize(await readDraft(currentPrompt)) : '';
        // An empty/remounted composer alone is NOT a submission acknowledgement.
        // Do not refill/resend when it clears: the request may already be in flight.
        if (draft === expectedText) {
            sentAttempted = true;
            try {
                if (sendButton) {
                    log(`[Playwright] Đang bấm nút Gửi trong ô ChatGPT (lần ${attempt + 1})...`);
                    await sendButton.click({ timeout: 8000 });
                } else {
                    log('[Playwright] Chưa thấy nút Gửi khả dụng; thử Enter trong ô ChatGPT...');
                    await currentPrompt.press('Enter', { timeout: 8000 });
                }
            } catch (error) {
                log(`[Playwright] Thao tác gửi chưa thành công: ${error.message}`);
            }
        }

        const deadline = Date.now() + confirmationTimeout;
        do {
            await check();
            if (await acknowledged()) return confirmed();
            await page.waitForTimeout(pollInterval);
        } while (Date.now() < deadline);
        currentPrompt = await findChatGPTPrompt(page, 1000);
        const currentDraft = currentPrompt ? normalize(await readDraft(currentPrompt)) : '';
        if (currentDraft !== expectedText) {
            // Ô nhập trống sau khi đã bấm gửi là tín hiệu mạnh tin nhắn ĐÃ được gửi.
            // Không xác nhận được user-turn qua DOM (selector đổi, render chậm) không
            // được dừng cả luồng; caller sẽ tự chờ phản hồi assistant với timeout riêng.
            if (sentAttempted) {
                log('[Playwright] ⚠️ Chưa xác nhận được user-turn mới trong DOM, nhưng ô nhập đã trống sau khi gửi. Coi như tin nhắn đã được gửi và tiếp tục chờ phản hồi...');
                return 'assumed';
            }
            break;
        }
    }
    throw Object.assign(new Error(
        'Không xác nhận được tin nhắn user mới chứa prompt sau khi gửi ChatGPT. Dừng chờ kết quả để tránh timeout hoặc gửi trùng.',
    ), { code: 'CHATGPT_SEND_FAILED' });
};
