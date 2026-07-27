import test from 'node:test';
import assert from 'node:assert/strict';
import { selectNewChatGptImageCandidate } from './chatgpt-image-detection-policy.js';

const generatedFallback = {
    src: 'blob:https://chatgpt.com/new-image',
    width: 1024,
    height: 1024,
    area: 1024 * 1024,
    source: 'fallback',
    isAfterLatestUser: true,
    isConversationSurface: true,
    isInUserMessage: false,
    isInComposer: false,
    isUi: false,
};

test('accepts a generated image from the new conversation-turn DOM fallback', () => {
    const result = selectNewChatGptImageCandidate({
        candidates: [generatedFallback],
        minArea: 30_000,
    });

    assert.equal(result.target?.src, generatedFallback.src);
    assert.equal(result.validCount, 1);
});

test('rejects uploaded user images even when they are large and new', () => {
    const result = selectNewChatGptImageCandidate({
        candidates: [{
            ...generatedFallback,
            src: 'blob:https://chatgpt.com/uploaded-watch',
            isInUserMessage: true,
        }],
        minArea: 30_000,
    });

    assert.equal(result.target, null);
    assert.equal(result.validCount, 0);
});

test('rejects fallback images that are outside the conversation or before the latest user turn', () => {
    const result = selectNewChatGptImageCandidate({
        candidates: [
            { ...generatedFallback, src: 'https://chatgpt.com/sidebar.png', isConversationSurface: false },
            { ...generatedFallback, src: 'https://chatgpt.com/old.png', isAfterLatestUser: false },
        ],
        minArea: 30_000,
    });

    assert.equal(result.target, null);
    assert.equal(result.validCount, 0);
});

test('excludes baseline and rejected sources while retaining a genuinely new assistant image', () => {
    const result = selectNewChatGptImageCandidate({
        candidates: [
            { ...generatedFallback, src: 'https://chatgpt.com/old-generated.png', source: 'assistant' },
            { ...generatedFallback, src: 'https://chatgpt.com/rejected-input.png', source: 'assistant' },
            { ...generatedFallback, src: 'https://chatgpt.com/new-generated.png', source: 'assistant' },
        ],
        minArea: 30_000,
        baselineImageSrcs: ['https://chatgpt.com/old-generated.png'],
        rejectedSrcs: ['https://chatgpt.com/rejected-input.png'],
    });

    assert.equal(result.target?.src, 'https://chatgpt.com/new-generated.png');
    assert.equal(result.validCount, 1);
});
