import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveEngineOrder } from './image-engine-policy.js';

test('mặc định chatgpt: chạy ChatGPT trước, Gemini dự phòng', () => {
  assert.deepEqual(resolveEngineOrder('chatgpt', 'chatgpt'), ['chatgpt', 'gemini']);
  assert.deepEqual(resolveEngineOrder(undefined, 'gemini'), ['chatgpt', 'gemini']);
  assert.deepEqual(resolveEngineOrder('thu-gi-do-la', 'gemini'), ['chatgpt', 'gemini']);
});

test('gemini: chạy Gemini trước, ChatGPT dự phòng', () => {
  assert.deepEqual(resolveEngineOrder('gemini', 'gemini'), ['gemini', 'chatgpt']);
});

test('sd: chỉ dùng SD, không dự phòng AI', () => {
  assert.deepEqual(resolveEngineOrder('sd', 'chatgpt'), ['sd']);
});

test('rotate: luân phiên theo engine lần trước', () => {
  assert.deepEqual(resolveEngineOrder('rotate', 'chatgpt'), ['chatgpt', 'gemini']);
  assert.deepEqual(resolveEngineOrder('rotate', 'gemini'), ['gemini', 'chatgpt']);
});
