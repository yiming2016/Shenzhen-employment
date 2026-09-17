import { createRequire } from 'node:module';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
const {
  calculate,
  findWageByNet,
  findWageByCost,
  findWageByAfterTax,
  calcIncomeTaxMonthly,
  DEFAULT_PARAMS,
} = require('../dist/core/engine.js');

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

// 灵活就业（默认只缴养老 + 医保）
const flexibleCases = [
  { wage: 3000, household: 'deep', personalTotal: 0.21 * 4775 + 0.08 * 6733 },
  { wage: 3000, household: 'non-deep', personalTotal: 0.2 * 4775 + 0.08 * 6733 },
  { wage: 5000, household: 'deep', personalTotal: 0.21 * 5000 + 0.08 * 6733 },
  { wage: 45000, household: 'deep', personalTotal: 0.21 * 27549 + 0.08 * 33666 },
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

// 反解：给定到手工资求月工资，再正算回去必须一致
test('反解到手工资：4205.34 元对应月工资 5000 元', () => {
  const base = makeInput({ wage: 5000 });
  const w = findWageByNet(4205.34, base);
  closeTo(w, 5000, 1e-6);
  closeTo(calculate({ ...base, wage: w }).netWage, 4205.34, 1e-3);
});

test('反解用工成本：6591.645 元对应月工资 5000 元', () => {
  const base = makeInput({ wage: 5000 });
  const w = findWageByCost(6591.645, base);
  closeTo(w, 5000, 1e-6);
  closeTo(calculate({ ...base, wage: w }).employmentCost, 6591.645, 1e-3);
});

// 多组目标值往返校验（深户一档 / 非深户二档）
test('反解与正算往返一致（深户一档）', () => {
  const base = makeInput({ wage: 5000, household: 'deep', medicalTier: 1 });
  for (const target of [1000, 4205.34, 10000, 30000, 50000, 100000]) {
    const w = findWageByNet(target, base);
    closeTo(calculate({ ...base, wage: w }).netWage, target, 1e-3);
  }
  for (const target of [3000, 6591.645, 10000, 30000, 60000, 120000]) {
    const w = findWageByCost(target, base);
    closeTo(calculate({ ...base, wage: w }).employmentCost, target, 1e-3);
  }
});

test('反解与正算往返一致（非深户二档）', () => {
  const base = makeInput({ wage: 7000, household: 'non-deep', medicalTier: 2 });
  for (const target of [2000, 6041, 15000, 40000]) {
    const w = findWageByNet(target, base);
    closeTo(calculate({ ...base, wage: w }).netWage, target, 1e-3);
  }
  for (const target of [4000, 8685.6, 18000, 45000]) {
    const w = findWageByCost(target, base);
    closeTo(calculate({ ...base, wage: w }).employmentCost, target, 1e-3);
  }
});

// 目标值低于可行下限时返回 0（工资为 0 仍需缴最低社保）
test('反解不可行目标返回 0', () => {
  const base = makeInput({ wage: 5000 });
  closeTo(findWageByNet(-1000, base), 0);
  closeTo(findWageByCost(1000, base), 0);
});

// 个税月度计算：阶梯税率样例
test('个税月度计算：阶梯税率样例', () => {
  closeTo(calcIncomeTaxMonthly(5000, 800, 0), 0);
  // 月应税 3000 -> 年 36000 -> 3% 档
  closeTo(calcIncomeTaxMonthly(8800, 800, 0), 90);
  // 月应税 12000 -> 年 144000 -> 10% 档
  closeTo(calcIncomeTaxMonthly(17800, 800, 0), 990);
  // 月应税 40000 -> 年 480000 -> 30% 档（专项附加 2000 参与）
  closeTo(calcIncomeTaxMonthly(50000, 3000, 2000), 7590);
  // 自定义起征点 3000：月应税 1200 -> 年 14400 -> 3% 档
  closeTo(calcIncomeTaxMonthly(5000, 800, 0, 3000), 36);
});

// 反解税后收入：与正算往返一致（深户一档）
test('反解税后收入：往返一致（深户一档）', () => {
  const base = makeInput({ wage: 20000, household: 'deep', medicalTier: 1 });
  const extra = 3000;
  for (const wage of [8000, 15000, 30000, 60000]) {
    const r = calculate({ ...base, wage }, DEFAULT_PARAMS);
    const target =
      wage -
      r.personalTotal -
      calcIncomeTaxMonthly(wage, r.personalTotal, extra);
    const w = findWageByAfterTax(target, base, DEFAULT_PARAMS, extra);
    closeTo(w, wage, 1e-3);
    const back = calculate({ ...base, wage: w }, DEFAULT_PARAMS);
    closeTo(
      w -
        back.personalTotal -
        calcIncomeTaxMonthly(w, back.personalTotal, extra),
      target,
      1e-3,
    );
  }
});

// 反解税后收入：往返一致（非深户二档）
test('反解税后收入：往返一致（非深户二档）', () => {
  const base = makeInput({ wage: 10000, household: 'non-deep', medicalTier: 2 });
  const r = calculate(base, DEFAULT_PARAMS);
  const target =
    10000 - r.personalTotal - calcIncomeTaxMonthly(10000, r.personalTotal, 0);
  const w = findWageByAfterTax(target, base, DEFAULT_PARAMS, 0);
  closeTo(w, 10000, 1e-3);
});

// 反解税后收入：目标低于可行下限时返回 0
test('反解税后收入：不可行目标返回 0', () => {
  const base = makeInput({ wage: 5000 });
  closeTo(findWageByAfterTax(-10000, base, DEFAULT_PARAMS, 0), 0);
});

// 反解税后收入：自定义起征点往返一致
test('反解税后收入：自定义起征点往返一致', () => {
  const base = makeInput({ wage: 15000, household: 'deep', medicalTier: 1 });
  const r = calculate(base, DEFAULT_PARAMS);
  const target =
    15000 -
    r.personalTotal -
    calcIncomeTaxMonthly(15000, r.personalTotal, 0, 3000);
  const w = findWageByAfterTax(target, base, DEFAULT_PARAMS, 0, 3000);
  closeTo(w, 15000, 1e-3);
});

// 公积金"跟随工资"时，反推必须按候选工资动态取基数（否则正反算不一致）
test('反解税后收入/用工成本：公积金跟随工资时往返一致', () => {
  const input = {
    ...makeInput({ wage: 20000, household: 'deep', medicalTier: 1 }),
    housingFund: {
      followWage: true,
      base: 0,
      personalRate: 0.12,
      companyRate: 0.12,
    },
  };
  const r = calculate(input, DEFAULT_PARAMS);
  const netTarget =
    20000 - r.personalTotal - calcIncomeTaxMonthly(20000, r.personalTotal, 0);
  const wNet = findWageByAfterTax(netTarget, input, DEFAULT_PARAMS, 0);
  closeTo(wNet, 20000, 1e-3);
  const backNet = calculate({ ...input, wage: wNet }, DEFAULT_PARAMS);
  closeTo(
    wNet -
      backNet.personalTotal -
      calcIncomeTaxMonthly(wNet, backNet.personalTotal, 0),
    netTarget,
    1e-3,
  );
  const costTarget = 20000 + r.companyTotal;
  const wCost = findWageByCost(costTarget, input, DEFAULT_PARAMS);
  closeTo(wCost, 20000, 1e-3);
  closeTo(
    calculate({ ...input, wage: wCost }, DEFAULT_PARAMS).employmentCost,
    costTarget,
    1e-3,
  );
  const pretaxTarget = 20000 - r.personalTotal;
  const wPretax = findWageByNet(pretaxTarget, input, DEFAULT_PARAMS);
  closeTo(wPretax, 20000, 1e-3);
  closeTo(
    calculate({ ...input, wage: wPretax }, DEFAULT_PARAMS).netWage,
    pretaxTarget,
    1e-3,
  );
});

// 灵活就业可选择缴存公积金，基数与工资隔离
test('灵活就业可选择公积金且基数与工资隔离', () => {
  const result = calculate(
    makeInput({
      wage: 5000,
      participationType: 'flexible',
      flexibleHousingFund: { base: 3000, rate: 0.08 },
      flexibleInsurance: {
        pension: true,
        medical: true,
        unemployment: true,
        housingFund: true,
      },
    }),
  );
  const fund = result.items.find((i) => i.key === 'housingFund');
  closeTo(fund.base, 3000);
  closeTo(fund.personalRate, 0.08);
  closeTo(fund.personalAmount, 240);
  closeTo(fund.companyAmount, 0);
  closeTo(result.personalTotal, 0.21 * 5000 + 0.08 * 6733 + 0.01 * 5000 + 240);
  closeTo(result.netWage, 5000 - result.personalTotal);
});

// 灵活就业未启用公积金时仍不缴纳
test('灵活就业未启用公积金仍不缴纳', () => {
  const result = calculate(
    makeInput({ wage: 5000, participationType: 'flexible' }),
  );
  const fund = result.items.find((i) => i.key === 'housingFund');
  assert.equal(fund, undefined);
  // 默认只缴养老、医保
  const keys = result.items.map((i) => i.key);
  assert.deepEqual(keys, ['pension', 'medical']);
});

// 灵活就业自定义：只勾失业
test('灵活就业只勾选失业', () => {
  const result = calculate(
    makeInput({
      wage: 5000,
      participationType: 'flexible',
      flexibleInsurance: {
        pension: false,
        medical: false,
        unemployment: true,
        housingFund: false,
      },
    }),
  );
  const keys = result.items.map((i) => i.key);
  assert.deepEqual(keys, ['unemployment']);
  closeTo(result.personalTotal, 0.01 * 5000);
});

// 职工公积金可覆盖基数和比例
test('职工公积金可覆盖基数和比例', () => {
  const result = calculate(
    makeInput({
      wage: 5000,
      housingFund: { base: 6000, personalRate: 0.1, companyRate: 0.12 },
    }),
  );
  const fund = result.items.find((i) => i.key === 'housingFund');
  closeTo(fund.base, 6000);
  closeTo(fund.personalRate, 0.1);
  closeTo(fund.companyRate, 0.12);
  closeTo(fund.personalAmount, 600);
  closeTo(fund.companyAmount, 720);
  closeTo(result.personalTotal, 400 + 134.66 + 10 + 600);
  closeTo(result.companyTotal, 850 + 403.98 + 33.665 + 40 + 14 + 720);
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
