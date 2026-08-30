import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { REGIONS, getRegion, getRegionOptions } = require('../dist/core/regions.js');

test('默认地区为深圳', () => {
  assert.equal(REGIONS.length >= 1, true);
  assert.equal(REGIONS[0].key, 'shenzhen');
  assert.equal(REGIONS[0].name, '深圳');
  assert.ok(REGIONS[0].params.pension.baseMin > 0);
});

test('未知地区回退到深圳', () => {
  const region = getRegion('unknown-region');
  assert.equal(region.key, 'shenzhen');
});

test('地区选项列表可用', () => {
  const options = getRegionOptions();
  assert.ok(options.some((o) => o.key === 'shenzhen' && o.name === '深圳'));
});
