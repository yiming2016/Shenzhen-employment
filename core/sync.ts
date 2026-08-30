import { InsuranceParams } from './types';

/** 可远程同步的参数板块 */
export const SYNC_SECTIONS: { key: string; label: string }[] = [
  { key: 'version', label: '参数版本' },
  { key: 'minimumWage', label: '最低工资' },
  { key: 'averageWage', label: '平均工资（三项）' },
  { key: 'pension', label: '养老' },
  { key: 'medical', label: '医保' },
  { key: 'maternity', label: '生育' },
  { key: 'unemployment', label: '失业' },
  { key: 'injury', label: '工伤' },
  { key: 'housingFund', label: '公积金' },
];

function isObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function mergeNumberFields(
  target: Record<string, unknown>,
  remote: Record<string, unknown>,
  keys: string[],
): number {
  let updated = 0;
  for (const key of keys) {
    if (typeof remote[key] === 'number' && typeof target[key] === 'number') {
      target[key] = remote[key];
      updated++;
    }
  }
  return updated;
}

function mergeInjury(
  target: Record<string, unknown>,
  remote: Record<string, unknown>,
): number {
  let updated = 0;
  if (typeof remote.personalRate === 'number' && typeof target.personalRate === 'number') {
    target.personalRate = remote.personalRate;
    updated++;
  }
  if (
    Array.isArray(remote.companyRates) &&
    remote.companyRates.length === 8 &&
    remote.companyRates.every((n) => typeof n === 'number')
  ) {
    target.companyRates = remote.companyRates;
    updated++;
  }
  if (
    Array.isArray(remote.industryNames) &&
    remote.industryNames.length === 8 &&
    remote.industryNames.every((s) => typeof s === 'string')
  ) {
    target.industryNames = remote.industryNames;
    updated++;
  }
  return updated;
}

const NUMERIC_KEYS: Record<string, string[]> = {
  pension: [
    'personalRate',
    'companyRateDeep',
    'companyRateNonDeep',
    'flexibleRateDeep',
    'flexibleRateNonDeep',
    'baseMin',
    'baseMax',
  ],
  medical: [
    'tier1PersonalRate',
    'tier1CompanyRate',
    'tier2PersonalRate',
    'tier2CompanyRate',
    'flexibleRate',
    'baseMin',
    'baseMax',
  ],
  maternity: ['companyRate', 'baseMin', 'baseMax'],
  unemployment: ['personalRate', 'companyRate', 'flexibleRate', 'baseMin', 'baseMax'],
  housingFund: ['personalRate', 'companyRate'],
};

/**
 * 把远程参数按勾选的板块合并进本地参数。
 * 只更新勾选且类型正确的字段，其余一律不动。
 */
export function applyRemoteParams(
  base: InsuranceParams,
  remote: unknown,
  enabledKeys: string[],
): { params: InsuranceParams; updated: string[]; errors: string[] } {
  const params = structuredClone(base);
  const updated: string[] = [];
  const errors: string[] = [];

  if (!isObject(remote)) {
    errors.push('远程数据不是有效的 JSON 对象');
    return { params, updated, errors };
  }

  const sectionLabel = (key: string) =>
    SYNC_SECTIONS.find((s) => s.key === key)?.label ?? key;

  for (const key of enabledKeys) {
    const value = remote[key];
    if (value === undefined) {
      errors.push(`${sectionLabel(key)}：远程数据中不存在该板块`);
      continue;
    }

    if (key === 'version') {
      if (typeof value === 'string') {
        params.version = value;
        updated.push(sectionLabel(key));
      } else {
        errors.push(`${sectionLabel(key)}：类型不正确（应为文本）`);
      }
      continue;
    }

    if (key === 'minimumWage') {
      if (typeof value === 'number') {
        params.minimumWage = value;
        updated.push(sectionLabel(key));
      } else {
        errors.push(`${sectionLabel(key)}：类型不正确（应为数字）`);
      }
      continue;
    }

    if (key === 'averageWage') {
      if (isObject(value)) {
        const year = params.averageWage.year || String(new Date().getFullYear());
        if (!params.averageWage.byYear[year]) {
          params.averageWage.byYear[year] = {
            urbanNonPrivate: 0,
            urbanNonPrivateOnPost: 0,
            urbanPrivate: 0,
            allUnit: 0,
          };
        }
        const count = mergeNumberFields(
          params.averageWage.byYear[year] as unknown as Record<string, unknown>,
          value,
          ['urbanNonPrivate', 'urbanNonPrivateOnPost', 'urbanPrivate', 'allUnit'],
        );
        if (count > 0) updated.push(sectionLabel(key));
        else errors.push(`${sectionLabel(key)}：没有可更新的字段`);
      } else {
        errors.push(`${sectionLabel(key)}：类型不正确（应为对象）`);
      }
      continue;
    }

    if (key === 'injury') {
      if (isObject(value)) {
        const count = mergeInjury(
          params.injury as unknown as Record<string, unknown>,
          value,
        );
        if (count > 0) updated.push(sectionLabel(key));
        else errors.push(`${sectionLabel(key)}：没有可更新的字段`);
      } else {
        errors.push(`${sectionLabel(key)}：类型不正确（应为对象）`);
      }
      continue;
    }

    if (key in NUMERIC_KEYS && isObject(value)) {
      const target = (params as unknown as Record<string, unknown>)[key];
      if (isObject(target)) {
        const count = mergeNumberFields(target, value, NUMERIC_KEYS[key]);
        if (count > 0) updated.push(sectionLabel(key));
        else errors.push(`${sectionLabel(key)}：没有可更新的字段`);
      } else {
        errors.push(`${sectionLabel(key)}：本地参数结构异常`);
      }
      continue;
    }

    errors.push(`${sectionLabel(key)}：未知板块`);
  }

  return { params, updated, errors };
}
