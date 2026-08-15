/**
 * Chạy trực tiếp trong trang Zalo Web qua Runtime.evaluate.
 * Hàm phải tự chứa toàn bộ dependency để có thể serialize bằng toString().
 */
export function inspectExactGroup(target, page = globalThis) {
  const document = page.document;
  const window = page.window;
  const getStyle = (element) => page.getComputedStyle(element);
  const normalize = (value) => String(value || '')
    .normalize('NFKC')
    .toLocaleLowerCase('vi-VN')
    .replace(/\s+/g, ' ')
    .trim();
  const visible = (element) => {
    const rect = element.getBoundingClientRect();
    const style = getStyle(element);
    return rect.width > 0
      && rect.height > 0
      && style.visibility !== 'hidden'
      && style.display !== 'none';
  };

  const input = document.querySelector('#contact-search-input');
  if (!input) {
    return {
      resultPoint: null,
      headerMatched: false,
      composerMatched: false,
      targetMatched: false,
    };
  }

  const inputRect = input.getBoundingClientRect();
  const viewportWidth = Math.max(
    Number(window.innerWidth) || 0,
    Number(document.documentElement?.clientWidth) || 0,
  );
  const maxPaneWidth = Math.min(
    viewportWidth * 0.55,
    Math.max(420, inputRect.width * 2.2),
  );
  const paneCandidates = [];
  for (let ancestor = input.parentElement; ancestor && ancestor !== document.body; ancestor = ancestor.parentElement) {
    const rect = ancestor.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) continue;
    if (rect.left > inputRect.left + 2 || rect.right < inputRect.right - 2) continue;
    if (rect.width > maxPaneWidth || rect.right > viewportWidth * 0.55) continue;
    paneCandidates.push(rect);
  }

  const paneRect = paneCandidates.sort((a, b) => b.right - a.right)[0];
  const estimatedPaneRight = Math.max(
    inputRect.right,
    Math.min(
      viewportWidth * 0.5,
      inputRect.right + Math.max(72, inputRect.width * 0.35),
    ),
  );
  const paneLeft = paneRect
    ? paneRect.left
    : Math.max(0, inputRect.left - inputRect.width * 0.25);
  const paneRight = paneRect
    ? Math.min(paneRect.right, estimatedPaneRight)
    : estimatedPaneRight;
  const wanted = normalize(target);
  const exactElements = [...document.querySelectorAll('h1, h2, h3, span, div, p')]
    .filter((element) => visible(element) && normalize(element.textContent) === wanted)
    .map((element) => ({ element, rect: element.getBoundingClientRect() }));

  const resultCandidates = exactElements
    .filter(({ rect }) => rect.left >= paneLeft - 2
      && rect.right <= paneRight + 2
      && rect.top > inputRect.bottom + 4)
    .sort((a, b) => (a.element.childElementCount - b.element.childElementCount)
      || ((a.rect.width * a.rect.height) - (b.rect.width * b.rect.height)));
  const uniqueRows = [];
  for (const candidate of resultCandidates) {
    const centerY = candidate.rect.top + candidate.rect.height / 2;
    if (!uniqueRows.some((row) => Math.abs(row.centerY - centerY) < 5)) {
      uniqueRows.push({ ...candidate, centerY });
    }
  }

  const firstResultRect = uniqueRows[0]?.rect;
  const resultPoint = firstResultRect
    ? {
      x: firstResultRect.left + Math.min(firstResultRect.width / 2, 120),
      y: firstResultRect.top + firstResultRect.height / 2,
      matches: uniqueRows.length,
    }
    : null;
  const headerMatched = exactElements.some(({ rect }) => rect.left >= paneRight - 2
    && rect.top >= 45
    && rect.top < 220);
  const composer = document.querySelector('#richInput');
  const composerSignals = [...document.querySelectorAll(
    '#richInput, [data-placeholder], [placeholder], [aria-label]',
  )];
  const composerAncestors = [];
  for (let ancestor = composer, depth = 0; ancestor && depth < 4; ancestor = ancestor.parentElement, depth += 1) {
    composerAncestors.push(ancestor);
    if (!composerSignals.includes(ancestor)) composerSignals.push(ancestor);
  }
  const isTargetComposerLabel = (value) => {
    const normalized = normalize(value);
    if (!normalized) return false;
    return normalized === wanted
      || normalized.endsWith(`tới ${wanted}`)
      || normalized.endsWith(`đến ${wanted}`)
      || normalized.endsWith(`cho ${wanted}`)
      || normalized.endsWith(`to ${wanted}`);
  };
  const composerMatched = composerSignals.some((element) => {
    const values = [
      element.getAttribute?.('data-placeholder'),
      element.getAttribute?.('placeholder'),
      element.getAttribute?.('aria-label'),
    ];
    if (composerAncestors.includes(element)) {
      values.push(element.innerText, element.textContent);
    }
    return values.some(isTargetComposerLabel);
  });

  return {
    resultPoint,
    headerMatched,
    composerMatched,
    targetMatched: headerMatched || composerMatched,
  };
}

export function buildExactGroupInspectionExpression(groupName) {
  return `(${inspectExactGroup.toString()})(${JSON.stringify(groupName)})`;
}
