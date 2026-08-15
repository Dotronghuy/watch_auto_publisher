import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';

import {
  buildExactGroupInspectionExpression,
  inspectExactGroup,
} from './group-selection.mjs';

function rect(left, top, width, height) {
  return {
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
  };
}

function element(textContent, bounds, options = {}) {
  return {
    textContent,
    innerText: options.innerText ?? textContent,
    childElementCount: options.childElementCount || 0,
    parentElement: options.parentElement || null,
    getAttribute: (name) => options.attributes?.[name] || null,
    getBoundingClientRect: () => bounds,
  };
}

function createPage(exactElements, options = {}) {
  const viewportWidth = options.viewportWidth || 1920;
  const paneBounds = options.paneBounds || rect(56, 80, 408, 952);
  const inputBounds = options.inputBounds || rect(135, 97, 240, 32);
  const body = element('', rect(0, 0, viewportWidth, 1080));
  const searchPane = element('', paneBounds, { parentElement: body });
  const searchWrapper = element('', rect(inputBounds.left - 15, 92, inputBounds.width + 40, 48), { parentElement: searchPane });
  const input = element('', inputBounds, { parentElement: searchWrapper });
  const composer = options.composer || null;
  const attributeElements = options.attributeElements || (composer ? [composer] : []);
  const document = {
    body,
    documentElement: { clientWidth: viewportWidth },
    querySelector: (selector) => {
      if (selector === '#contact-search-input') return input;
      if (selector === '#richInput') return composer;
      return null;
    },
    querySelectorAll: (selector) => (selector.startsWith('h1, h2')
      ? exactElements
      : attributeElements),
  };
  return {
    document,
    window: { innerWidth: viewportWidth },
    getComputedStyle: () => ({ display: 'block', visibility: 'visible' }),
  };
}

test('không đếm tiêu đề chat bên phải là kết quả tìm kiếm thứ hai', () => {
  const searchResult = element('test', rect(196, 235, 35, 24));
  const openHeader = element('test', rect(542, 92, 40, 30));
  const inspection = inspectExactGroup('test', createPage([searchResult, openHeader]));

  assert.equal(inspection.resultPoint.matches, 1);
  assert.equal(inspection.headerMatched, true);
  assert.equal(inspection.targetMatched, true);
});

test('vẫn dừng an toàn khi có hai dòng kết quả thật sự trùng tên', () => {
  const firstResult = element('test', rect(196, 235, 35, 24));
  const secondResult = element('test', rect(196, 310, 35, 24));
  const openHeader = element('test', rect(542, 92, 40, 30));
  const inspection = inspectExactGroup('test', createPage([firstResult, secondResult, openHeader]));

  assert.equal(inspection.resultPoint.matches, 2);
  assert.equal(inspection.headerMatched, true);
});

test('gộp các node lồng nhau thuộc cùng một dòng kết quả', () => {
  const row = element('test', rect(132, 226, 330, 50), { childElementCount: 3 });
  const title = element('test', rect(196, 239, 35, 24));
  const inspection = inspectExactGroup('test', createPage([row, title]));

  assert.equal(inspection.resultPoint.matches, 1);
});

test('giữ đúng ranh giới cột tìm kiếm trên cửa sổ hẹp', () => {
  const searchResult = element('test', rect(175, 235, 35, 24));
  const openHeader = element('test', rect(440, 92, 40, 30));
  const page = createPage([searchResult, openHeader], {
    viewportWidth: 800,
    paneBounds: rect(56, 80, 344, 952),
    inputBounds: rect(110, 97, 230, 32),
  });
  const inspection = inspectExactGroup('test', page);

  assert.equal(inspection.resultPoint.matches, 1);
  assert.equal(inspection.headerMatched, true);
});

test('xác nhận đúng nhóm qua placeholder ô soạn tin khi DOM tiêu đề không khớp', () => {
  const searchResult = element('test', rect(196, 235, 35, 24));
  const composer = element('', rect(480, 980, 1200, 45), {
    attributes: { 'data-placeholder': 'Nhập @, tin nhắn tới test' },
  });
  const inspection = inspectExactGroup('test', createPage([searchResult], { composer }));

  assert.equal(inspection.headerMatched, false);
  assert.equal(inspection.composerMatched, true);
  assert.equal(inspection.targetMatched, true);
});

test('không chấp nhận placeholder của cuộc trò chuyện khác', () => {
  const searchResult = element('test', rect(196, 235, 35, 24));
  const composer = element('', rect(480, 980, 1200, 45), {
    attributes: { 'data-placeholder': 'Nhập @, tin nhắn tới nhóm khác' },
  });
  const inspection = inspectExactGroup('test', createPage([searchResult], { composer }));

  assert.equal(inspection.composerMatched, false);
  assert.equal(inspection.targetMatched, false);
});

test('xác nhận placeholder được render thành chữ trong khung soạn tin', () => {
  const searchResult = element('test', rect(196, 235, 35, 24));
  const composerWrapper = element('Nhập @, tin nhắn tới test', rect(464, 950, 1400, 80));
  const composer = element('', rect(480, 980, 1200, 45), { parentElement: composerWrapper });
  const inspection = inspectExactGroup('test', createPage([searchResult], { composer }));

  assert.equal(inspection.headerMatched, false);
  assert.equal(inspection.composerMatched, true);
  assert.equal(inspection.targetMatched, true);
});

test('expression serialize an toàn và cho cùng kết quả trong page context', () => {
  const groupName = 'Nhóm "test"';
  const searchResult = element(groupName, rect(196, 235, 120, 24));
  const page = createPage([searchResult]);
  const result = vm.runInNewContext(buildExactGroupInspectionExpression(groupName), page);

  assert.equal(result.resultPoint.matches, 1);
  assert.equal(result.headerMatched, false);
  assert.equal(result.targetMatched, false);
});
