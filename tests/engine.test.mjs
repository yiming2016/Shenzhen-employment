import { createRequire } from 'node:module';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
const { calculate, DEFAULT_PARAMS } = require('../dist/core/engine.js');

function closeTo(actual, expected, tolerance = 1e-9) {
  assert.ok(
    Math.abs(actual - expected) < tolerance,
    `期望 ${expected}，实际 ${actual}`,
  );
}

function makeInput(overrides = {}) {
  return {
    wage: 5000,
    participationType: 'employee',
    household: 'deep',
    medicalTier: 1,
    injuryClass: 2,
    ...overrides,
  };
}

// 与 Excel 社保成本.xlsx 缓存值逐项对照
// 每行: [工资, 深户/非深户, 个人合计, 公司合计, 到手工资, 用工成本]
const employeeCases = [
  { wage: 3000, household: 'deep', personalTotal: 672.66, companyTotal: 1431.795, netWage: 2327.34, employmentCost: 4431.795 },
  { wage: 3000, household: 'non-deep', personalTotal: 571.665, companyTotal: 1081.06, netWage: 2428.335, employmentCost: 4081.06 },
  { wage: 5000, household: 'deep', personalTotal: 794.66, companyTotal: 1591.645, netWage: 4205.34, employmentCost: 6591.645 },
  { wage: 5000, household: 'non-deep', personalTotal: 693.665, companyTotal: 1238.66, netWage: 4306.335, employmentCost: 6238.66 },
  { wage: 7000, household: 'deep', personalTotal: 1064, companyTotal: 2070.6, netWage: 5936, employmentCost: 9070.6 },
  { wage: 7000, household: 'non-deep', personalTotal: 959, companyTotal: 1685.6, netWage: 6041, employmentCost: 8685.6 },
  { wage: 30000, household: 'deep', personalTotal: 4363.92, companyTotal: 8457.33, netWage: 25636.08, employmentCost: 38457.33 },
  { wage: 30000, household: 'non-deep', personalTotal: 3913.92, companyTotal: 6831.84, netWage: 26086.08, employmentCost: 36831.84 },
  { wage: 34000, household: 'deep', personalTotal: 4645.24, companyTotal: 8938.82, netWage: 29354.76, employmentCost: 42938.82 },
  { wage: 34000, household: 'non-deep', personalTotal: 4140.25, companyTotal: 7148.36, netWage: 29859.75, employmentCost: 41148.36 },
  // 注意：Excel 第 6 档样例把失业基数写成了上限 574101；
  // 但 45000 低于上限，按通用规则（工资<上限按工资）应为 45000。
  // 这里采用通用规则：失业个人 45000*0.2%=90，公司 45000*0.8%=360。
  { wage: 45000, household: 'deep', personalTotal: 5217.24, companyTotal: 9607.62, netWage: 39782.76, employmentCost: 54607.62 },
  { wage: 45000, household: 'non-deep', personalTotal: 4712.25, companyTotal: 7817.16, netWage: 40287.75, employmentCost: 52817.16 },
];

for (const c of employeeCases) {
  test(`职工 ${c.wage}元 ${c.household === 'deep' ? '深户' : '非深户'}`, () => {
    const result = calculate(
      makeInput({ wage: c.wage, household: c.household, medicalTier: c.household === 'deep' ? 1 : 2 }),
    );
    closeTo(result.personalTotal, c.personalTotal);
    closeTo(result.companyTotal, c.companyTotal);
    closeTo(result.netWage, c.netWage);
    closeTo(result.employmentCost, c.employmentCost);
  });
}

// 灵活就业（Excel 中 深户/非深户 灵活就业只缴养老 + 医保 + 失业）
const flexibleCases = [
  { wage: 3000, household: 'deep', personalTotal: 0.21 * 4775 + 0.08 * 6733 + 0.01 * 3000 },
  { wage: 3000, household: 'non-deep', personalTotal: 0.2 * 4775 + 0.08 * 6733 + 0.01 * 3000 },
  { wage: 5000, household: 'deep', personalTotal: 0.21 * 5000 + 0.08 * 6733 + 0.01 * 5000 },
  { wage: 45000, household: 'deep', personalTotal: 0.21 * 27549 + 0.08 * 33666 + 0.01 * 45000 },
];

for (const c of flexibleCases) {
  test(`灵活就业 ${c.wage}元 ${c.household === 'deep' ? '深户' : '非深户'}`, () => {
    const result = calculate(
      makeInput({
        wage: c.wage,
        household: c.household,
        participationType: 'flexible',
      }),
    );
    closeTo(result.personalTotal, c.personalTotal);
    closeTo(result.companyTotal, 0);
    closeTo(result.netWage, c.wage - c.personalTotal);
    closeTo(result.employmentCost, c.wage);
  });
}

// 边界值：养老下限 / 医保下限 / 养老上限 / 医保上限
test('边界值 4775、6733、27549、33666', () => {
  const cases = [
    { wage: 4775, expectPensionBase: 4775, expectMedicalBase: 6733 },
    { wage: 6733, expectPensionBase: 6733, expectMedicalBase: 6733 },
    { wage: 27549, expectPensionBase: 27549, expectMedicalBase: 27549 },
    { wage: 33666, expectPensionBase: 27549, expectMedicalBase: 33666 },
  ];
  for (const c of cases) {
    const result = calculate(makeInput({ wage: c.wage }));
    const pension = result.items.find((i) => i.key === 'pension');
    const medical = result.items.find((i) => i.key === 'medical');
    closeTo(pension.base, c.expectPensionBase);
    closeTo(medical.base, c.expectMedicalBase);
  }
});

// 工伤 8 个行业费率
test('工伤 8 个行业费率与文档一致', () => {
  const expected = [0.0014, 0.0028, 0.0049, 0.0063, 0.0066, 0.0078, 0.0096, 0.0114];
  for (let cls = 1; cls <= 8; cls++) {
    const result = calculate(makeInput({ wage: 10000, injuryClass: cls }));
    const injury = result.items.find((i) => i.key === 'injury');
    closeTo(injury.companyRate, expected[cls - 1]);
    closeTo(injury.companyAmount, 10000 * expected[cls - 1]);
  }
});

// 深户强制一档：即使传入二档也按一档费率计算
test('深户强制一档', () => {
  const result = calculate(
    makeInput({ wage: 10000, household: 'deep', medicalTier: 2 }),
  );
  const medical = result.items.find((i) => i.key === 'medical');
  closeTo(medical.personalRate, 0.02);
  closeTo(medical.companyRate, 0.06);
});

// 非深户可选一档或二档
test('非深户可选一档或二档', () => {
  const tier1 = calculate(
    makeInput({ wage: 10000, household: 'non-deep', medicalTier: 1 }),
  );
  const tier2 = calculate(
    makeInput({ wage: 10000, household: 'non-deep', medicalTier: 2 }),
  );
  const medical1 = tier1.items.find((i) => i.key === 'medical');
  const medical2 = tier2.items.find((i) => i.key === 'medical');
  closeTo(medical1.personalRate, 0.02);
  closeTo(medical2.personalRate, 0.005);
});

// 失业缴费基数下限跟随最低工资
test('失业基数下限跟随最低工资', () => {
  const params = structuredClone(DEFAULT_PARAMS);
  params.minimumWage = 2600;
  const result = calculate(makeInput({ wage: 2400 }), params);
  const unemployment = result.items.find((i) => i.key === 'unemployment');
  closeTo(unemployment.base, 2600);
  closeTo(unemployment.personalAmount, 2600 * 0.002);
  closeTo(unemployment.companyAmount, 2600 * 0.008);
});

// 参数表可编辑：改费率后结果跟着变
test('参数可覆盖（改养老费率后结果变化）', () => {
  const params = structuredClone(DEFAULT_PARAMS);
  params.pension.personalRate = 0.1;
  const result = calculate(makeInput({ wage: 10000 }), params);
  const pension = result.items.find((i) => i.key === 'pension');
  closeTo(pension.personalAmount, 10000 * 0.1);
  closeTo(pension.companyAmount, 10000 * 0.17);
});
