import {
  CalcInput,
  CalcResult,
  InsuranceItem,
  InsuranceParams,
} from './types';
import { DEFAULT_PARAMS } from './params';

/** 把数值限制在 [min, max] 区间内 */
function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** 构造一条险种记录 */
function item(
  key: string,
  name: string,
  base: number,
  personalRate: number,
  companyRate: number,
  note?: string,
): InsuranceItem {
  return {
    key,
    name,
    base,
    personalRate,
    companyRate,
    personalAmount: base * personalRate,
    companyAmount: base * companyRate,
    note,
  };
}

/**
 * 判断工资落在哪个缴费区间（与 Excel 的 6 个区间一致）。
 */
function resolveBand(
  wage: number,
  p: InsuranceParams,
): { bandName: string; bandFrom: number; bandTo: number | null } {
  const pensionMin = p.pension.baseMin;
  const pensionMax = p.pension.baseMax;
  const medicalMin = p.medical.baseMin;
  const medicalMax = p.medical.baseMax;
  const unemploymentMax = p.unemployment.baseMax;

  if (wage < pensionMin) {
    return { bandName: '最低工资~养老下限', bandFrom: p.minimumWage, bandTo: pensionMin };
  }
  if (wage < medicalMin) {
    return { bandName: '养老下限~医保下限', bandFrom: pensionMin, bandTo: medicalMin };
  }
  if (wage < pensionMax) {
    return { bandName: '医保下限~养老上限', bandFrom: medicalMin, bandTo: pensionMax };
  }
  if (wage < medicalMax) {
    return { bandName: '养老上限~医保上限', bandFrom: pensionMax, bandTo: medicalMax };
  }
  if (wage < unemploymentMax) {
    return { bandName: '医保上限~失业上限', bandFrom: medicalMax, bandTo: unemploymentMax };
  }
  return { bandName: '失业上限~无上限', bandFrom: unemploymentMax, bandTo: null };
}

/**
 * 核心计算函数（纯函数，不读写任何外部状态）。
 *
 * 规则（与 Excel 一致）：
 * - 养老基数 = 工资限制在 [养老下限, 养老上限]
 * - 医保基数 = 工资限制在 [医保下限, 医保上限]
 * - 生育基数 = 与医保相同
 * - 失业基数 = 工资限制在 [最低工资, 失业上限]
 * - 工伤基数 = 工资（不设上下限）
 * - 公积金基数 = 工资
 * - 深户职工医保默认一档，非深户默认二档；灵活就业按灵活就业费率
 */
export function calculate(
  input: CalcInput,
  params: InsuranceParams = DEFAULT_PARAMS,
): CalcResult {
  const wage = input.wage;
  const band = resolveBand(wage, params);
  const items: InsuranceItem[] = [];

  // ---------- 养老保险 ----------
  const pensionBase = clamp(wage, params.pension.baseMin, params.pension.baseMax);
  if (input.participationType === 'employee') {
    const companyRate =
      input.household === 'deep'
        ? params.pension.companyRateDeep
        : params.pension.companyRateNonDeep;
    items.push(item('pension', '养老', pensionBase, params.pension.personalRate, companyRate));
  } else {
    const personalRate =
      input.household === 'deep'
        ? params.pension.flexibleRateDeep
        : params.pension.flexibleRateNonDeep;
    items.push(item('pension', '养老', pensionBase, personalRate, 0));
  }

  // ---------- 医疗保险 ----------
  const medicalBase = clamp(wage, params.medical.baseMin, params.medical.baseMax);
  if (input.participationType === 'employee') {
    // 深户强制一档（二档仅限非深户）
    const tier: 1 | 2 =
      input.household === 'deep' ? 1 : input.medicalTier;
    const rates =
      tier === 1
        ? {
            personalRate: params.medical.tier1PersonalRate,
            companyRate: params.medical.tier1CompanyRate,
          }
        : {
            personalRate: params.medical.tier2PersonalRate,
            companyRate: params.medical.tier2CompanyRate,
          };
    items.push(
      item('medical', `医保（${tier}档）`, medicalBase, rates.personalRate, rates.companyRate),
    );
  } else {
    items.push(item('medical', '医保（灵活就业）', medicalBase, params.medical.flexibleRate, 0));
  }

  // ---------- 生育保险（个人不缴，灵活就业不缴） ----------
  const maternityBase = clamp(wage, params.maternity.baseMin, params.maternity.baseMax);
  if (input.participationType === 'employee') {
    items.push(item('maternity', '生育', maternityBase, 0, params.maternity.companyRate));
  } else {
    items.push(item('maternity', '生育', 0, 0, 0, '灵活就业不缴纳'));
  }

  // ---------- 失业保险 ----------
  const unemploymentBase = clamp(
    wage,
    // 失业缴费基数下限 = 最低工资（Excel：D17 = H19，修改最低工资后自动跟随）
    params.minimumWage,
    params.unemployment.baseMax,
  );
  if (input.participationType === 'employee') {
    items.push(
      item(
        'unemployment',
        '失业',
        unemploymentBase,
        params.unemployment.personalRate,
        params.unemployment.companyRate,
      ),
    );
  } else {
    items.push(
      item('unemployment', '失业（灵活就业）', unemploymentBase, params.unemployment.flexibleRate, 0),
    );
  }

  // ---------- 工伤保险（个人不缴，灵活就业不缴） ----------
  if (input.participationType === 'employee') {
    const companyRate = params.injury.companyRates[input.injuryClass - 1] ?? 0;
    items.push(
      item('injury', `工伤（${input.injuryClass}类）`, wage, params.injury.personalRate, companyRate),
    );
  } else {
    items.push(item('injury', '工伤', 0, 0, 0, '灵活就业不缴纳'));
  }

  // ---------- 住房公积金（比例可自行调整） ----------
  if (input.participationType === 'employee') {
    items.push(
      item(
        'housingFund',
        '公积金',
        wage,
        params.housingFund.personalRate,
        params.housingFund.companyRate,
      ),
    );
  } else {
    items.push(item('housingFund', '公积金', 0, 0, 0, '灵活就业不缴纳'));
  }

  const personalTotal = items.reduce((sum, it) => sum + it.personalAmount, 0);
  const companyTotal = items.reduce((sum, it) => sum + it.companyAmount, 0);

  return {
    items,
    personalTotal,
    companyTotal,
    netWage: wage - personalTotal,
    employmentCost: wage + companyTotal,
    bandName: band.bandName,
    bandFrom: band.bandFrom,
    bandTo: band.bandTo,
  };
}

export { DEFAULT_PARAMS } from './params';
