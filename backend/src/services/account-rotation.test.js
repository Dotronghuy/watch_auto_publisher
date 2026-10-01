import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

// Dùng state file tạm để không làm xáo trộn vòng xoay thật đang chạy.
const tmpState = path.join(os.tmpdir(), `acct-rot-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
process.env.ACCOUNT_ROTATION_STATE_FILE = tmpState;

const { getRotatedAccountOrder, isAccountRestrictionError } = await import('./account-rotation.js');

test.after(() => {
  try { fs.unlinkSync(tmpState); } catch (e) {}
});

test('luân phiên vòng xoay: chạy lần lượt từng tài khoản rồi quay vòng', () => {
  const accounts = [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }, { id: 'c', name: 'C' }];
  const run1 = getRotatedAccountOrder(accounts);
  assert.equal(run1[0].id, 'a');
  assert.deepEqual(run1.map(a => a.id), ['a', 'b', 'c']);

  const run2 = getRotatedAccountOrder(accounts);
  assert.equal(run2[0].id, 'b');
  assert.deepEqual(run2.map(a => a.id), ['b', 'c', 'a']);

  const run3 = getRotatedAccountOrder(accounts);
  assert.equal(run3[0].id, 'c');
  assert.deepEqual(run3.map(a => a.id), ['c', 'a', 'b']);

  const run4 = getRotatedAccountOrder(accounts);
  assert.equal(run4[0].id, 'a');
});

test('tài khoản chính bị xóa khỏi danh sách → bắt đầu lại từ đầu', () => {
  const accounts = [{ id: 'b', name: 'B' }, { id: 'c', name: 'C' }];
  const order = getRotatedAccountOrder(accounts);
  assert.equal(order[0].id, 'b');
  assert.deepEqual(order.map(a => a.id), ['b', 'c']);
});

test('1 tài khoản duy nhất → luôn là chính nó', () => {
  const order = getRotatedAccountOrder([{ id: 'solo', name: 'Solo' }]);
  assert.equal(order.length, 1);
  assert.equal(order[0].id, 'solo');
});

test('danh sách rỗng → trả về mảng rỗng', () => {
  assert.deepEqual(getRotatedAccountOrder([]), []);
});

test('nhận diện lỗi tài khoản bị hạn chế qua mã lỗi Graph API', () => {
  const fbErr = (code, message = '') => ({ response: { data: { error: { code, message } } } });
  assert.ok(isAccountRestrictionError(fbErr(190, 'Invalid OAuth access token')));
  assert.ok(isAccountRestrictionError(fbErr(368, 'The action attempted has been deemed abusive')));
  assert.ok(isAccountRestrictionError(fbErr(200, 'Permissions error')));
  assert.ok(isAccountRestrictionError(fbErr(803, 'User not allowed to publish')));
  assert.ok(isAccountRestrictionError(fbErr(10, 'App is restricted')));
  assert.ok(isAccountRestrictionError({ response: { data: { error: { error_subcode: 463 } } } }));
  assert.ok(!isAccountRestrictionError(fbErr(100, 'Invalid parameter')));
  assert.ok(!isAccountRestrictionError(fbErr(506, 'Duplicate status message')));
});

test('nhận diện qua nội dung thông báo lỗi khi không có mã', () => {
  assert.ok(isAccountRestrictionError(new Error('Page has been restricted')));
  assert.ok(isAccountRestrictionError(new Error('Session has expired')));
  assert.ok(isAccountRestrictionError(new Error('The user is not authorized')));
  assert.ok(!isAccountRestrictionError(new Error('Video file is too large')));
  assert.ok(!isAccountRestrictionError(null));
  assert.ok(!isAccountRestrictionError(undefined));
});
