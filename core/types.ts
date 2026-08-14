/**
 * 核心模块的类型定义。
 * 这个模块不依赖任何框架 / Node API，纯 TypeScript，
 * 以后做手机 App 时可以直接把 core/ 目录搬过去复用。
 */

/** 参保类型：职工（单位+个人） / 灵活就业（个人全额） */
export type ParticipationType = 'employee' | 'flexible';

/** 户籍：深户 / 非深户（影响养老公司费率与医保档次） */
export type HouseholdType = 'deep' | 'non-deep';

/** 医保档次：一档 / 二档（仅职工参保时有意义） */
export type MedicalTier = 1 | 2;

/** 工伤保险行业类别：1~8 */
export type InjuryClass = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

/** 官方政策来源链接 */
export interface SourceLink {
  name: string;
  url: string;
  /** 政策发布时间（YYYY-MM-DD，可留空） */
  publishDate?: string;
}

/** 通用有效期：起止日期 + 发布时间 */
export interface PeriodDates {
  start: string;
  end: string;
  publishDate: string;
}

/** 养老有企业职工 / 机关事业单位两段有效期 */
export interface PensionValidity {
  enterpriseWorkersStart: string;
  enterpriseWorkersEnd: string;
  governmentOrgStart: string;
  governmentOrgEnd: string;
  publishDate: string;
}

/** 各险种的政策有效期与发布时间 */
export interface ValidityMap {
  pension: PensionValidity;
  medical: PeriodDates;
  maternity: PeriodDates;
  unemployment: PeriodDates;
  injury: PeriodDates;
  housingFund: PeriodDates & { note?: string };
}

/**
 * 按险种/参数分组的政策依据链接。
 * 界面在编辑对应参数时，会把这些链接列出来，点击跳转网页。
 */
export interface SourceMap {
  pension: SourceLink[];
  medical: SourceLink[];
  maternity: SourceLink[];
  unemployment: SourceLink[];
  minimumWage: SourceLink[];
  averageWage: SourceLink[];
  injury: SourceLink[];
  housingFund: SourceLink[];
}

/**
 * 政策参数表（费率、基数等）。
 * 全部集中在这里，改政策时只改这份数据，不用动计算逻辑。
 */
export interface InsuranceParams {
  /** 参数版本 / 生效说明，便于区分不同政策期 */
  version: string;
  /** 最低工资（元/月） */
  minimumWage: number;
  /** 平均工资（元/年，仅作参考展示） */
  averageWage: {
    /** 城镇非私营单位就业人员平均工资 */
    urbanNonPrivate: number;
    /** 城镇非私营单位在岗职工平均工资 */
    urbanNonPrivateOnPost: number;
    /** 城镇私营单位就业人员平均工资 */
    urbanPrivate: number;
  };
  /** 养老保险 */
  pension: {
    personalRate: number;        // 职工个人费率（8%）
    companyRateDeep: number;     // 深户单位费率（17%）
    companyRateNonDeep: number;  // 非深户单位费率（16%）
    flexibleRateDeep: number;    // 深户灵活就业费率（21%）
    flexibleRateNonDeep: number; // 非深户灵活就业费率（20%）
    baseMin: number;             // 缴费基数下限
    baseMax: number;             // 缴费基数上限
  };
  /** 医疗保险 */
  medical: {
    tier1PersonalRate: number; // 一档个人（2%）
    tier1CompanyRate: number;  // 一档单位（6%）
    tier2PersonalRate: number; // 二档个人（0.5%）
    tier2CompanyRate: number;  // 二档单位（1.5%）
    flexibleRate: number;      // 灵活就业个人（8%）
    baseMin: number;
    baseMax: number;
  };
  /** 生育保险（个人不缴） */
  maternity: {
    companyRate: number; // 0.5%
    baseMin: number;
    baseMax: number;
  };
  /** 失业保险 */
  unemployment: {
    personalRate: number;  // 职工个人（0.2%）
    companyRate: number;   // 职工单位（0.8%）
    flexibleRate: number;  // 灵活就业个人（1%）
    baseMin: number;
    baseMax: number;
  };
  /** 工伤保险（个人不缴） */
  injury: {
    personalRate: number;        // 固定 0
    companyRates: number[];      // 8 个行业类别对应的单位费率
    industryNames: string[];     // 8 个行业类别的名称（与费率一一对应）
    baseMode: 'wage';            // 目前基数 = 工资，不设上下限
  };
  /** 住房公积金（可自行调整比例） */
  housingFund: {
    personalRate: number; // 默认 5%
    companyRate: number;  // 默认 5%
  };
  /** 官方政策来源 */
  sources: SourceLink[];
  /** 按险种/参数分组的政策依据 */
  sourceBySection: SourceMap;
  /** 各险种的政策有效期与发布时间 */
  validity: ValidityMap;
}

/** 计算输入 */
export interface CalcInput {
  /** 月工资（元） */
  wage: number;
  participationType: ParticipationType;
  household: HouseholdType;
  medicalTier: MedicalTier;
  injuryClass: InjuryClass;
}

/** 单个险种的计算结果 */
export interface InsuranceItem {
  key: string;
  name: string;
  /** 该险种的缴费基数（元） */
  base: number;
  personalRate: number;
  companyRate: number;
  personalAmount: number;
  companyAmount: number;
  /** 备注，如“灵活就业不缴纳” */
  note?: string;
}

/** 整体计算结果 */
export interface CalcResult {
  items: InsuranceItem[];
  /** 个人合计（元） */
  personalTotal: number;
  /** 公司合计（元） */
  companyTotal: number;
  /** 到手工资 = 工资 - 个人合计 */
  netWage: number;
  /** 用工成本 = 工资 + 公司合计 */
  employmentCost: number;
  /** 命中的工资区间名称 */
  bandName: string;
  /** 区间起点（含） */
  bandFrom: number;
  /** 区间终点（不含），null 表示无上限 */
  bandTo: number | null;
}
