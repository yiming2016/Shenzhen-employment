import { DEFAULT_PARAMS } from './params';
import type { InsuranceParams } from './types';

/** 一个地区 = 一套完整政策参数 */
export interface RegionInfo {
  key: string;
  name: string;
  params: InsuranceParams;
}

/**
 * 地区注册表：新增地区只需在这里加一行（并准备该地区的政策参数）。
 * 后续也可以由平台远程下发地区配置。
 */
export const REGIONS: RegionInfo[] = [
  {
    key: 'shenzhen',
    name: '深圳',
    params: DEFAULT_PARAMS,
  },
];

export function getRegion(key: string): RegionInfo {
  return REGIONS.find((r) => r.key === key) ?? REGIONS[0];
}

export function getRegionOptions(): { key: string; name: string }[] {
  return REGIONS.map((r) => ({ key: r.key, name: r.name }));
}
