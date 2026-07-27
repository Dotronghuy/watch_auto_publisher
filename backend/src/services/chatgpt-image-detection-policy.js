const normalizeSource = (value) => String(value || '').trim();

const hasUiImageSource = (src) => {
    const normalized = src.toLowerCase();
    return !normalized
        || normalized.includes('avatar')
        || normalized.includes('favicon')
        || normalized.startsWith('data:image/svg');
};

export const selectNewChatGptImageCandidate = ({
    candidates = [],
    minArea = 0,
    baselineImageSrcs = [],
    rejectedSrcs = [],
} = {}) => {
    const baselineSrcSet = new Set(baselineImageSrcs.map(normalizeSource).filter(Boolean));
    const rejectedSrcSet = new Set(rejectedSrcs.map(normalizeSource).filter(Boolean));
    const validBySrc = new Map();
    let bestVisible = null;

    for (const candidate of candidates) {
        const src = normalizeSource(candidate?.src);
        const width = Number(candidate?.width) || 0;
        const height = Number(candidate?.height) || 0;
        const area = Number(candidate?.area) || (width * height);
        const normalized = {
            ...candidate,
            src,
            width,
            height,
            area,
        };

        const isLargeVisibleImage = !candidate?.isUi
            && !hasUiImageSource(src)
            && area >= minArea;
        if (isLargeVisibleImage) bestVisible = normalized;

        const isSafeAssistantImage = candidate?.source === 'assistant';
        const isSafeFallbackImage = candidate?.source === 'fallback'
            && candidate?.isAfterLatestUser === true
            && candidate?.isConversationSurface === true;

        if (
            !isLargeVisibleImage
            || candidate?.isInUserMessage
            || candidate?.isInComposer
            || (!isSafeAssistantImage && !isSafeFallbackImage)
            || baselineSrcSet.has(src)
            || rejectedSrcSet.has(src)
        ) {
            continue;
        }

        // Cùng một ảnh có thể được ChatGPT render ở thumbnail và lightbox.
        // Giữ phần tử cuối cùng để ưu tiên bản vừa xuất hiện trong luồng hội thoại.
        if (validBySrc.has(src)) validBySrc.delete(src);
        validBySrc.set(src, normalized);
    }

    const validImages = [...validBySrc.values()];
    return {
        target: validImages.at(-1) || null,
        total: candidates.length,
        validCount: validImages.length,
        bestVisible,
    };
};
