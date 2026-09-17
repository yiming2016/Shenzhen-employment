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
  const flexibleInsurance =
    input.participationType === 'flexible'
      ? input.flexibleInsurance ?? {
          pension: true,
          medical: true,
          unemployment: false,
          housingFund: false,
        }
      : null;

  // ---------- 养老保险 ----------
  const pensionBase = clamp(wage, params.pension.baseMin, params.pension.baseMax);
  if (input.participationType === 'employee') {
    const companyRate =
      input.household === 'deep'
        ? params.pension.companyRateDeep
        : params.pension.companyRateNonDeep;
    items.push(item('pension', '养老', pensionBase, params.pension.personalRate, companyRate));
  } else if (flexibleInsurance && flexibleInsurance.pension) {
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
  } else if (flexibleInsurance && flexibleInsurance.medical) {
    items.push(item('medical', '医保（灵活就业）', medicalBase, params.medical.flexibleRate, 0));
  }

  // ---------- 生育保险（个人不缴，灵活就业不缴） ----------
  if (input.participationType === 'employee') {
    const maternityBase = clamp(wage, params.maternity.baseMin, params.maternity.baseMax);
    items.push(item('maternity', '生育', maternityBase, 0, params.maternity.companyRate));
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
  } else if (flexibleInsurance && flexibleInsurance.unemployment) {
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
  }

  // ---------- 住房公积金（比例可自行调整） ----------
  if (input.participationType === 'employee') {
    const hf = input.housingFund;
    const hfBase = hf
      ? hf.followWage
        ? wage
        : Math.max(0, hf.base)
      : wage;
    items.push(
      item(
        'housingFund',
        '公积金',
        hfBase,
        hf ? hf.personalRate : params.housingFund.personalRate,
        hf ? hf.companyRate : params.housingFund.companyRate,
      ),
    );
  } else if (
    input.flexibleHousingFund &&
    flexibleInsurance &&
    flexibleInsurance.housingFund &&
    input.flexibleHousingFund.rate > 0 &&
    (input.flexibleHousingFund.followWage
      ? wage > 0
      : input.flexibleHousingFund.base > 0)
  ) {
    const base = input.flexibleHousingFund.followWage
      ? wage
      : Math.max(0, input.flexibleHousingFund.base);
    const rate = input.flexibleHousingFund.rate;
    items.push(
      item('housingFund', '公积金（灵活就业）', base, rate, 0, '个人自愿缴存'),
    );
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

/**
 * 反解月工资：给定目标"到手工资"，返回满足条件的月工资。
 * 到手工资 = 工资 - 个人社保合计，随工资严格单调递增（个人费率合计 < 100%），
 * 因此可以用二分法求反函数，结果与正算共用同一套 calculate 逻辑，不会出现两套规则。
 */
export function findWageByNet(
  targetNetWage: number,
  input: CalcInput,
  params: InsuranceParams = DEFAULT_PARAMS,
): number {
  return invertMonotonic(
    (w) => calculate({ ...input, wage: w }, params).netWage,
    targetNetWage,
  );
}

/** 个税起征点（元/月），随政策调整 */
export const TAX_THRESHOLD = 5000;

/**
 * 个人所得税（月度）：按年度综合所得阶梯税率折算到月。
 * 应纳税所得额(月) = max(0, 月工资 − 起征点 − 个人社保合计 − 专项附加月合计)。
 * 与界面正算共用同一函数，保证正算/反算规则一致。
 */
export function calcIncomeTaxMonthly(
  wage: number,
  personalTotal: number,
  extraMonthly = 0,
  threshold = TAX_THRESHOLD,
): number {
  const taxableMonthly = Math.max(
    0,
    wage - threshold - (personalTotal + extraMonthly),
  );
  const annual = taxableMonthly * 12;
  let rate = 0;
  let quick = 0;
  if (annual <= 36000) {
    rate = 0.03;
    quick = 0;
  } else if (annual <= 144000) {
    rate = 0.1;
    quick = 2520;
  } else if (annual <= 300000) {
    rate = 0.2;
    quick = 16920;
  } else if (annual <= 420000) {
    rate = 0.25;
    quick = 31920;
  } else if (annual <= 660000) {
    rate = 0.3;
    quick = 52920;
  } else if (annual <= 960000) {
    rate = 0.35;
    quick = 85920;
  } else {
    rate = 0.45;
    quick = 181920;
  }
  return (annual * rate - quick) / 12;
}

/**
 * 反解月工资：给定目标"税后收入"，返回满足条件的月工资。
 * 税后收入 = 月工资 − 个人社保合计 − 个人所得税，随工资严格单调递增
 * （个人费率合计 + 个税边际税率 < 100%），因此可用二分法求反函数，
 * 与正算共用同一套 calculate + calcIncomeTaxMonthly，不会出现两套规则。
 */
export function findWageByAfterTax(
  targetAfterTax: number,
  input: CalcInput,
  params: InsuranceParams = DEFAULT_PARAMS,
  extraMonthly = 0,
  threshold = TAX_THRESHOLD,
): number {
  return invertMonotonic(
    (w) => {
      const r = calculate({ ...input, wage: w }, params);
      return (
        w -
        r.personalTotal -
        calcIncomeTaxMonthly(w, r.personalTotal, extraMonthly, threshold)
      );
    },
    targetAfterTax,
  );
}

/**
 * 反解月工资：给定目标"用工成本"，返回满足条件的月工资。
 * 用工成本 = 工资 + 公司社保合计，随工资严格单调递增（公司费率合计 > -100%），可用二分法求反函数。
 */
export function findWageByCost(
  targetEmploymentCost: number,
  input: CalcInput,
  params: InsuranceParams = DEFAULT_PARAMS,
): number {
  return invertMonotonic(
    (w) => calculate({ ...input, wage: w }, params).employmentCost,
    targetEmploymentCost,
  );
}

/** 单调递增函数求反（二分法）；目标低于 f(0) 时返回 0 */
function invertMonotonic(f: (w: number) => number, target: number): number {
  const LO = 0;
  const HI = 100000000; // 1 亿，覆盖正常工资范围
  const fLo = f(LO);
  const fHi = f(HI);
  if (target <= fLo) return LO;
  if (target >= fHi) return HI;
  let lo = LO;
  let hi = HI;
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    if (f(mid) < target) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

export { DEFAULT_PARAMS } from './params';
