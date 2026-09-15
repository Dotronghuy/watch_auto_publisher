import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildShopeeDiscountReply,
  buildProductFormText,
  getFocusedProductQuestion,
  getFocusedProductReply,
  getRecentCustomerImageUrl,
  getRecentExactCatalogSku,
  getRecentProductIntentText,
  isDiscountRequest,
  isProductContextFollowUp,
  isProductPhotoRequest,
  shouldSendFullProductForm
} from './chatbot.service.js';

test('size-only question returns only the confirmed product size', () => {
  const message = 'Con này size bao nhiêu shop?';
  const reply = getFocusedProductReply(message, '751G-T1', {
    'Kích thước mặt': '42 mm',
    'Giá sale': '4.650.000',
    'Link Shopee': 'https://s.shopee.vn/example'
  });

  assert.equal(getFocusedProductQuestion(message), 'size');
  assert.equal(
    reply,
    'Dạ mẫu 751G-T1 có kích thước mặt 42 mm ạ. Anh/chị cho em xin chu vi cổ tay, em tư vấn độ vừa vặn chính xác hơn nhé.'
  );
  assert.doesNotMatch(reply, /giá|shopee|thông số/i);
  assert.equal(shouldSendFullProductForm(message), false);
});

test('full product form is reserved for price, details, availability or purchase intent', () => {
  assert.equal(shouldSendFullProductForm('Mẫu này giá bao nhiêu?'), true);
  assert.equal(shouldSendFullProductForm('Mã này bao nhiêu?'), true);
  assert.equal(shouldSendFullProductForm('Cho tôi xin thông số chi tiết'), true);
  assert.equal(shouldSendFullProductForm('Shop có mẫu này không?'), true);
  assert.equal(shouldSendFullProductForm('Gửi link Shopee để tôi đặt hàng'), true);

  assert.equal(shouldSendFullProductForm('Mẫu này size bao nhiêu?'), false);
  assert.equal(shouldSendFullProductForm('Mẫu này có màu gì?'), false);
  assert.equal(shouldSendFullProductForm('Mẫu này chính hãng không?'), false);
  assert.equal(shouldSendFullProductForm('Cho xem ảnh thực tế'), false);
});

test('product images require an explicit customer photo request', () => {
  assert.equal(isProductPhotoRequest('Cho tôi xin ảnh thực tế mẫu này'), true);
  assert.equal(isProductPhotoRequest('Gửi thêm hình cho mình xem nhé'), true);
  assert.equal(isProductPhotoRequest('Mẫu này có ảnh không shop?'), true);

  assert.equal(isProductPhotoRequest('Con này size bao nhiêu?'), false);
  assert.equal(isProductPhotoRequest('Mẫu này giá bao nhiêu?'), false);
  assert.equal(isProductPhotoRequest('Shop có mẫu này không?'), false);
});

test('exact variant form includes one price and one Shopee link without asking color', () => {
  const reply = buildProductFormText({
    sku: '751G-T1',
    productInfo: {
      'Kích thước mặt': '42 mm',
      'Độ chịu nước': '50M',
      'Loại máy': 'Đồng hồ cơ (Automatic)',
      'Chất liệu dây': 'Thép không gỉ 316L',
      'Giá sale': '4.650.000'
    },
    shopeeLink: 'https://s.shopee.vn/6L3C6Rg4ms'
  });
  const [form, followUp] = reply.split('|||');

  assert.match(form, /Mã Sản Phẩm: 751G-T1/);
  assert.match(form, /Giá bán : 4\.650\.000/);
  assert.match(form, /Link Shopee: https:\/\/s\.shopee\.vn\/6L3C6Rg4ms/);
  assert.equal((form.match(/4\.650\.000/g) || []).length, 1);
  assert.doesNotMatch(followUp, /giá|màu/i);
  assert.doesNotMatch(reply, /đang ưng màu nào/i);
});

test('follow-up question reuses the latest exact variant instead of a generic family code', () => {
  const now = Date.now();
  const recentSku = getRecentExactCatalogSku([
    {
      is_from_page: 1,
      created_time: new Date(now - 20_000).toISOString(),
      message: 'Dạ mẫu 751G-T1 có kích thước mặt 42 mm ạ.'
    },
    {
      is_from_page: 1,
      created_time: new Date(now - 10_000).toISOString(),
      message: 'Mã Sản Phẩm: 751G'
    }
  ], now);

  assert.equal(recentSku, '751G-T1');
});

test('a new customer image prevents reuse of an exact SKU from the previous product turn', () => {
  const now = Date.now();
  const recentSku = getRecentExactCatalogSku([
    {
      is_from_page: 1,
      created_time: new Date(now - 20_000).toISOString(),
      message: 'Mã Sản Phẩm: 735G2-D2'
    },
    {
      is_from_page: 0,
      created_time: new Date(now - 2_000).toISOString(),
      message: 'xin giá chiếc này'
    },
    {
      is_from_page: 0,
      created_time: new Date(now - 1_000).toISOString(),
      message: '[IMAGE: https://example.com/new-watch.png]'
    }
  ], now);

  assert.equal(recentSku, null);
});

test('generic SKU follow-up can reuse the newest customer image for family matching', () => {
  const now = Date.now();
  const imageUrl = getRecentCustomerImageUrl([
    {
      is_from_page: 0,
      created_time: new Date(now - 20_000).toISOString(),
      message: '[IMAGE: https://example.com/old-watch.png]'
    },
    {
      is_from_page: 1,
      created_time: new Date(now - 10_000).toISOString(),
      message: 'Dạ em chưa chốt được đúng mã sản phẩm.'
    },
    {
      is_from_page: 0,
      created_time: new Date(now - 1_000).toISOString(),
      message: '763G nhé'
    }
  ], now);

  assert.equal(imageUrl, 'https://example.com/old-watch.png');
});

test('price intent before an image survives while the customer supplies a family SKU', () => {
  const now = Date.now();
  const intentText = getRecentProductIntentText([
    {
      is_from_page: 0,
      created_time: new Date(now - 52_000).toISOString(),
      message: 'mã này bao nhiêu'
    },
    {
      is_from_page: 0,
      created_time: new Date(now - 51_000).toISOString(),
      message: '[IMAGE: https://example.com/593l-d1.png]'
    },
    {
      is_from_page: 1,
      created_time: new Date(now - 40_000).toISOString(),
      message: 'Dạ em chưa chốt được đúng mã sản phẩm.'
    },
    {
      is_from_page: 0,
      created_time: new Date(now - 1_000).toISOString(),
      message: 'mã 593L nhé'
    }
  ], now);

  assert.equal(intentText, 'mã này bao nhiêu');
  assert.equal(shouldSendFullProductForm(`${intentText}\nmã 593L nhé`), true);
});

test('product detail follow-up can reuse the latest exact SKU', () => {
  assert.equal(isProductContextFollowUp('thông tin và giá'), true);
  assert.equal(isProductContextFollowUp('mẫu này size bao nhiêu'), true);
  assert.equal(isProductContextFollowUp('cho xem ảnh thực tế'), true);
  assert.equal(isProductContextFollowUp('chào shop'), false);
});

test('discount request with a Shopee link leads the customer to checkout on Shopee', () => {
  assert.equal(isDiscountRequest('giảm giá được không shop'), true);
  assert.equal(isDiscountRequest('shop bớt giá được không ạ'), true);
  assert.equal(isDiscountRequest('mẫu này size bao nhiêu'), false);

  const reply = buildShopeeDiscountReply({
    sku: '787G1-S4',
    shopeeLink: 'https://s.shopee.vn/example'
  });

  assert.match(reply, /787G1-S4/);
  assert.match(reply, /https:\/\/s\.shopee\.vn\/example/);
  assert.match(reply, /voucher\/freeship/i);
  assert.doesNotMatch(reply, /chuyển nhân viên/i);
});
