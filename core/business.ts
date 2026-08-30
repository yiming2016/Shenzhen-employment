/** 公司 */
export interface Company {
  id: string;
  name: string;
}

/** 通讯录人员 */
export type ContactRating = 'excellent' | 'good' | 'medium' | 'poor' | 'danger';

export interface Contact {
  id: string;
  name: string;
  companyId: string;
  /** 入职时间 YYYY-MM-DD */
  entryDate: string;
  /** 薪资（选填） */
  salary?: number;
  /** 奖金（选填，与月工资合计作为计算基数） */
  bonus?: number;
  /** 备注（选填） */
  remark?: string;
  /** 评级（选填） */
  rating?: ContactRating;
  /** 平均月工资手动覆盖（红字显示；未设置时按 月工资+奖金÷12 计算） */
  manualAvg?: number;
  /** 计入时长（月）手动覆盖（红字显示；未设置时按入职时间自动折算） */
  manualTenure?: number;
}

/** 待辞退人员（从通讯录添加，计算 N/N+1/2N） */
export interface PendingLayoff {
  id: string;
  contactId: string;
  companyId: string;
  monthlyWage: number;
  /** 奖金（与月工资合计作为计算基数） */
  bonus?: number;
  years: number;
  months: number;
  /** 年限是否被手动修改过（列表中以红字提示） */
  manualYears?: boolean;
  manualMonths?: boolean;
  /** 月平均工资是否为手动输入（列表中以红字显示，且不跟随通讯录） */
  manualWage?: boolean;
  /** 奖金是否为手动输入（不跟随通讯录） */
  manualBonus?: boolean;
  /** 待辞退记录自己的评级（为空时跟随通讯录） */
  rating?: ContactRating;
  /** 待辞退记录自己的备注（为空时跟随通讯录） */
  remark?: string;
  /** months 是否已是按 N 规则折算后的月数（旧版本为原始总月数） */
  nMonths?: boolean;
}
