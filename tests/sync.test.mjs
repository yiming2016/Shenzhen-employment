import { createRequire } from 'node:module';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
const { DEFAULT_PARAMS } = require('../dist/core/engine.js');
const { applyRemoteParams } = require('../dist/core/sync.js');

test('只更新勾选的板块，未勾选的不动', () => {
  const remote = {
    version: '2026-09 新版',
    pension: { baseMin: 5000, baseMax: 28000 },
    medical: { baseMin: 9999 },
  };
  const { params, updated, errors } = applyRemoteParams(
    DEFAULT_PARAMS,
    remote,
    ['version', 'pension'],
  );
  assert.equal(params.version, '2026-09 新版');
  assert.equal(params.pension.baseMin, 5000);
  assert.equal(params.pension.baseMax, 28000);
  // 未勾选医保 -> 不变
  assert.equal(params.medical.baseMin, DEFAULT_PARAMS.medical.baseMin);
  assert.deepEqual(updated, ['参数版本', '养老']);
  assert.deepEqual(errors, []);
});

test('类型不正确或板块缺失时报错且不修改', () => {
  const remote = { version: 123, missing: 1 };
  const { params, updated, errors } = applyRemoteParams(DEFAULT_PARAMS, remote, ['version', 'missing']);
  assert.equal(params.version, DEFAULT_PARAMS.version);
  assert.deepEqual(updated, []);
  assert.equal(errors.length, 2);
});

test('工伤板块可同步费率数组与行业名称', () => {
  const remote = {
    injury: {
      companyRates: [0.001, 0.002, 0.003, 0.004, 0.005, 0.006, 0.007, 0.008],
      industryNames: ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'],
    },
  };
  const { params, updated, errors } = applyRemoteParams(DEFAULT_PARAMS, remote, ['injury']);
  assert.deepEqual(params.injury.companyRates, remote.injury.companyRates);
  assert.deepEqual(params.injury.industryNames, remote.injury.industryNames);
  assert.deepEqual(updated, ['工伤']);
  assert.deepEqual(errors, []);
});

test('平均工资三项可同步', () => {
  const remote = {
    averageWage: { urbanNonPrivate: 200000, urbanPrivate: 100000, allUnit: 150000 },
  };
  const { params, updated } = applyRemoteParams(DEFAULT_PARAMS, remote, ['averageWage']);
  const year = params.averageWage.year;
  assert.equal(params.averageWage.byYear[year].urbanNonPrivate, 200000);
  assert.equal(params.averageWage.byYear[year].urbanPrivate, 100000);
  assert.equal(params.averageWage.byYear[year].allUnit, 150000);
  // 未提供的在岗项保持原值
  assert.equal(
    params.averageWage.byYear[year].urbanNonPrivateOnPost,
    DEFAULT_PARAMS.averageWage.byYear[year].urbanNonPrivateOnPost,
  );
  assert.deepEqual(updated, ['平均工资（三项）']);
});

test('远程数据不是对象时报错', () => {
  const { updated, errors } = applyRemoteParams(DEFAULT_PARAMS, 'hello', ['version']);
  assert.deepEqual(updated, []);
  assert.equal(errors.length, 1);
});
