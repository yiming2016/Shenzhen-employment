/**
 * 员工赔偿计算：经济补偿 N / N+1（含代通知金）/ 违法解除赔偿金 2N。
 * 依据《劳动合同法》第 47、87 条，规则与计算逻辑分离，可复用于手机端。
 */

export interface SeveranceInput {
  /** 解除前十二个月平均工资（元） */
  monthlyWage: number;
  /** 在本单位工作年限（年，可为小数） */
  years: number;
  /** 当地上年度职工月平均工资（元），用于 3 倍封顶 */
  avgMonthlyWage: number;
  /** 是否启用 3 倍封顶 + 12 年上限（默认启用） */
  useCap: boolean;
  /** 传入的 years 已是按 N 规则折算后的月数（如 1.5 表示 1.5 个月工资），不再二次折算 */
  preConverted?: boolean;
}

export interface SeveranceResult {
  /** 折算后的经济补偿月数（N 的倍数，如 1.5 = 1.5 个月工资） */
  nYears: number;
  /** 封顶后的月工资基数 */
  cappedWage: number;
  /** N 经济补偿 */
  n: number;
  /** +1 代通知金（按一个月工资） */
  noticePay: number;
  /** N+1 */
  nPlus1: number;
  /** 2N */
  twoN: number;
  notes: string[];
}

/** 本地时区的今天（YYYY-MM-DD，按本地 0 点），避免 toISOString 的 UTC 偏移 */
export function localToday(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** 工作年限折算：满一年算 1 年；6 个月以上不满一年算 1 年；不满 6 个月算 0.5 年（返回"个月的工资"） */
export function yearsToN(years: number): number {
  const full = Math.floor(years);
  const rem = years - full;
  if (rem >= 0.5) return full + 1;
  if (rem > 0) return full + 0.5;
  return full;
}

export function calculateSeverance(input: SeveranceInput): SeveranceResult {
  const wage = Math.max(0, input.monthlyWage || 0);
  const years = Math.max(0, input.years || 0);
  const avg = Math.max(0, input.avgMonthlyWage || 0);
  const useCap = input.useCap !== false;

  let nYears = input.preConverted ? years : yearsToN(years);
  let cappedWage = wage;
  const notes: string[] = [];

  if (useCap && avg > 0 && wage > avg * 3) {
    cappedWage = round2(avg * 3);
    nYears = Math.min(nYears, 12);
    notes.push(
      `月工资 ${wage.toFixed(2)} 元高于当地平均工资 3 倍（${cappedWage.toFixed(2)} 元），按 3 倍封顶；经济补偿年限上限 12 年。`,
    );
  }

  const n = round2(cappedWage * nYears);
  // 代通知金按封顶后的月工资计算（与 N 的工资基数一致）
  const noticePay = round2(cappedWage);
  const nPlus1 = round2(n + noticePay);
  const twoN = round2(n * 2);

  notes.push(`折算经济补偿为 ${nYears} 个月工资。`);

  return { nYears, cappedWage, n, noticePay, nPlus1, twoN, notes };
}

/** 两个日期之间的工作年限（按 365.25 天/年折算为小数年） */
export function yearsBetween(entryDate: string, endDate: string): number {
  const a = new Date(entryDate);
  const b = new Date(endDate);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return 0;
  const ms = b.getTime() - a.getTime();
  if (ms <= 0) return 0;
  return ms / (365.25 * 24 * 3600 * 1000);
}

/** 把小数年拆成 年 + 月（月 0~11） */
export function splitYearsMonths(decimalYears: number): { years: number; months: number } {
  const years = Math.floor(decimalYears);
  const months = Math.round((decimalYears - years) * 12);
  if (months >= 12) return { years: years + 1, months: 0 };
  return { years, months };
}
