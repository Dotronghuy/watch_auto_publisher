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
    };

    let sentAttempted = false;
    for (let attempt = 0; attempt < 3; attempt++) {
        await check();
        if (await acknowledged()) { confirmed(); return; }
        let currentPrompt = await findChatGPTPrompt(page, 1000);
        let sendButton = null;
        const buttonDeadline = Date.now() + (attempt === 0 ? buttonTimeout : Math.min(buttonTimeout, 4000));
        do {
            await check();
            if (await acknowledged()) { confirmed(); return; }
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
            if (await acknowledged()) { confirmed(); return; }
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
                return;
            }
            break;
        }
    }
    throw Object.assign(new Error(
        'Không xác nhận được tin nhắn user mới chứa prompt sau khi gửi ChatGPT. Dừng chờ kết quả để tránh timeout hoặc gửi trùng.',
    ), { code: 'CHATGPT_SEND_FAILED' });
};
