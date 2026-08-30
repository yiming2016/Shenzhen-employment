import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  calculateSeverance,
  yearsBetween,
  splitYearsMonths,
  yearsToN,
  localToday,
} = require('../dist/core/severance.js');

function closeTo(actual, expected, tolerance = 1e-9) {
  assert.ok(Math.abs(actual - expected) < tolerance, `期望 ${expected}，实际 ${actual}`);
}

test('3.5 年：N=4 个月工资', () => {
  const r = calculateSeverance({ monthlyWage: 8000, years: 3.5, avgMonthlyWage: 10000, useCap: true });
  closeTo(r.nYears, 4);
  closeTo(r.n, 32000);
  closeTo(r.noticePay, 8000);
  closeTo(r.nPlus1, 40000);
  closeTo(r.twoN, 64000);
});

test('1.2 年折算为 1.5 年', () => {
  const r = calculateSeverance({ monthlyWage: 6000, years: 1.2, avgMonthlyWage: 10000, useCap: true });
  closeTo(r.nYears, 1.5);
  closeTo(r.n, 9000);
});

test('0.6 年按 1 年计算', () => {
  const r = calculateSeverance({ monthlyWage: 6000, years: 0.6, avgMonthlyWage: 10000, useCap: true });
  closeTo(r.nYears, 1);
  closeTo(r.n, 6000);
});

test('N 折算：入职 1 年 1 个月 → 1.5 个月', () => {
  closeTo(yearsToN(1 + 1 / 12), 1.5);
  const r = calculateSeverance({ monthlyWage: 8000, years: 1.5, preConverted: true, avgMonthlyWage: 10000, useCap: true });
  closeTo(r.nYears, 1.5);
  closeTo(r.n, 12000);
});

test('N 折算：5 年 3 个月 → 5.5 个月；5 年 6 个月 → 6 个月', () => {
  closeTo(yearsToN(5 + 3 / 12), 5.5);
  closeTo(yearsToN(5.5), 6);
});

test('N 折算：不满 6 个月 → 0.5 个月', () => {
  closeTo(yearsToN(0), 0);
  closeTo(yearsToN(0.4), 0.5);
  closeTo(yearsToN(0.5), 1);
});

test('3 倍封顶 + 12 年上限', () => {
  const r = calculateSeverance({ monthlyWage: 50000, years: 15, avgMonthlyWage: 10000, useCap: true });
  closeTo(r.cappedWage, 30000);
  closeTo(r.nYears, 12);
  closeTo(r.n, 360000);
  closeTo(r.noticePay, 30000);
  closeTo(r.nPlus1, 390000);
  closeTo(r.twoN, 720000);
});

test('关闭封顶后按原工资计算', () => {
  const r = calculateSeverance({ monthlyWage: 50000, years: 15, avgMonthlyWage: 10000, useCap: false });
  closeTo(r.cappedWage, 50000);
  closeTo(r.nYears, 15);
  closeTo(r.n, 750000);
});

test('日期折算年限与拆分', () => {
  const dec = yearsBetween('2022-01-15', '2026-08-16');
  closeTo(dec, 4.58, 0.01);
  const split = splitYearsMonths(dec);
  assert.equal(split.years, 4);
  assert.equal(split.months, 7);
});

test('拆分进位：12 个月进 1 年', () => {
  const split = splitYearsMonths(5.98);
  assert.equal(split.years, 6);
  assert.equal(split.months, 0);
});

test('localToday 返回本地日期（按本地 0 点）', () => {
  const t = localToday();
  assert.match(t, /^\d{4}-\d{2}-\d{2}$/);
  const d = new Date();
  const expected = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  assert.equal(t, expected);
});
