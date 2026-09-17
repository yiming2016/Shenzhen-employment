<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import {
  calculate,
  calcIncomeTaxMonthly,
  findWageByAfterTax,
  findWageByCost,
  findWageByNet,
  TAX_THRESHOLD,
} from '../../../core/engine';
import type {
  CalcInput,
  CalculatorDefaults,
  HousingFundDefaults,
  InsuranceParams,
  InjuryClass,
} from '../../../core/types';
import SelectBox from './SelectBox.vue';
import RateInput from './RateInput.vue';

const props = defineProps<{
  params: InsuranceParams;
  calculatorDefaults?: CalculatorDefaults;
  housingFundDefaults?: HousingFundDefaults;
}>();

const wage = ref(5000);
const participationType = ref<'employee' | 'flexible'>('employee');
const household = ref<'deep' | 'non-deep'>('deep');
const medicalTier = ref<1 | 2>(1);
const injuryClass = ref<InjuryClass>(2);

// 公积金设置：职工有个人/公司比例，灵活就业只有个人比例；基数可与工资隔离
const employeeHousing = ref({
  followWage: true,
  fixedBase: 5000,
  personalRate: props.params.housingFund.personalRate,
  companyRate: props.params.housingFund.companyRate,
});
const flexibleHousing = ref({
  followWage: true,
  fixedBase: 5000,
  rate: 0.12, // 灵活就业默认 12%
});

// 灵活就业自定义参保险种（默认：养老 + 医保）
const flexibleInsurance = ref({
  pension: true,
  medical: true,
  unemployment: false,
  housingFund: false,
});

// ---- 专项附加扣除设置（本地保存） ----
interface TaxDeductionState {
  rentOn: boolean;
  rentLoan: 'none' | 'rent' | 'loan';
  loanType: 'none' | 'personal' | 'couple';
  elderly: boolean;
  siblings: number;
  infantOn: boolean;
  infantCount: number;
  infantSplit: 'alone' | 'couple';
  childEduOn: boolean;
  childEduCount: number;
  childEduSplit: 'alone' | 'couple';
  eduDegree: boolean;
  qualification: boolean;
  medicalOn: boolean;
  medicalSelfPay: number;
}

const DEFAULT_DEDUCTION: TaxDeductionState = {
  rentOn: false,
  rentLoan: 'rent',
  loanType: 'none',
  elderly: false,
  siblings: 0,
  infantOn: false,
  infantCount: 1,
  infantSplit: 'alone',
  childEduOn: false,
  childEduCount: 1,
  childEduSplit: 'alone',
  eduDegree: false,
  qualification: false,
  medicalOn: false,
  medicalSelfPay: 0,
};

function loadDeduction(): TaxDeductionState {
  try {
    const raw = localStorage.getItem('taxDeduction');
    if (raw) {
      const saved = JSON.parse(raw);
      // 所有开关默认关闭（含专项附加总开关），住房默认选一线租房
      return {
        ...DEFAULT_DEDUCTION,
        ...saved,
        rentOn: false,
        elderly: false,
        infantOn: false,
        childEduOn: false,
        eduDegree: false,
        qualification: false,
        medicalOn: false,
        rentLoan: 'rent',
      };
    }
  } catch {
    // 使用默认值
  }
  return { ...DEFAULT_DEDUCTION };
}

const deduction = ref<TaxDeductionState>(loadDeduction());
const showDeductionModal = ref(false);
const deductSpecialOnly = ref(false);

function openDeductModal(specialOnly: boolean) {
  deductSpecialOnly.value = specialOnly;
  showDeductionModal.value = true;
}

// 住房开关打开时，下拉默认“一线租房”
watch(
  () => deduction.value.rentOn,
  (on) => {
    if (on && deduction.value.rentLoan !== 'rent' && deduction.value.rentLoan !== 'loan') {
      deduction.value.rentLoan = 'rent';
    }
  },
);

watch(
  deduction,
  () => {
    try {
      localStorage.setItem('taxDeduction', JSON.stringify(deduction.value));
    } catch {
      // 保存失败不影响使用
    }
  },
  { deep: true },
);

// 各模组扣除额（月）
const rentLoanMonthly = computed(() => {
  if (!deduction.value.rentOn) return 0;
  if (deduction.value.rentLoan === 'rent') return 1500;
  if (deduction.value.rentLoan === 'loan') {
    return deduction.value.loanType === 'personal'
      ? 1000
      : deduction.value.loanType === 'couple'
        ? 500
        : 0;
  }
  return 0;
});
const elderlyMonthly = computed(() => {
  if (!deduction.value.elderly) return 0;
  return deduction.value.siblings <= 0
    ? 3000
    : 1500 / (deduction.value.siblings + 1);
});
const infantMonthly = computed(() => {
  if (!deduction.value.infantOn) return 0;
  const n = Math.max(1, deduction.value.infantCount);
  const base = n * 2000;
  return deduction.value.infantSplit === 'couple' ? base / 2 : base;
});
const childEduMonthly = computed(() => {
  if (!deduction.value.childEduOn) return 0;
  const n = Math.max(1, deduction.value.childEduCount);
  const base = n * 2000;
  return deduction.value.childEduSplit === 'couple' ? base / 2 : base;
});
const eduDegreeMonthly = computed(() => (deduction.value.eduDegree ? 400 : 0));
const qualificationAnnual = computed(() =>
  deduction.value.qualification ? 3600 : 0,
);
const medicalAnnual = computed(() => {
  if (!deduction.value.medicalOn) return 0;
  const selfPay = Number(deduction.value.medicalSelfPay) || 0;
  const excess = selfPay - 15000;
  return excess > 0 ? Math.min(excess, 80000) : 0;
});
const extraMonthly = computed(
  () =>
    rentLoanMonthly.value +
    elderlyMonthly.value +
    infantMonthly.value +
    childEduMonthly.value +
    eduDegreeMonthly.value +
    qualificationAnnual.value / 12 +
    medicalAnnual.value / 12,
);
// 月度项合计 / 年度项折算月度合计
const monthlyModulesTotal = computed(
  () =>
    rentLoanMonthly.value +
    elderlyMonthly.value +
    infantMonthly.value +
    childEduMonthly.value +
    eduDegreeMonthly.value,
);
const annualMonthlyTotal = computed(
  () => qualificationAnnual.value / 12 + medicalAnnual.value / 12,
);
// 合计抵扣 = 专项抵扣（个人社保合计） + 专项附加月合计 + 起征点
const deductionTotal = computed(
  () =>
    result.value.personalTotal + extraMonthly.value + TAX_THRESHOLD,
);

// 个人所得税（阶梯税率，按年度综合所得折算到月）
const incomeTax = computed(() =>
  calcIncomeTaxMonthly(
    Number(wage.value) || 0,
    result.value.personalTotal,
    extraMonthly.value,
  ),
);

// 税前收入 = 月工资 − 个人社保合计（月）
const pretaxIncome = computed(
  () => (Number(wage.value) || 0) - result.value.personalTotal,
);

// 税后收入 = 月工资 − 个人社保合计（月） − 个人所得税
const netAfterTax = computed(
  () =>
    (Number(wage.value) || 0) - result.value.personalTotal - incomeTax.value,
);

watch(
  () => props.housingFundDefaults,
  (d) => {
    if (!d) return;
    employeeHousing.value.followWage = d.employee.followWage;
    employeeHousing.value.fixedBase = d.employee.fixedBase;
    employeeHousing.value.personalRate = d.employee.personalRate;
    employeeHousing.value.companyRate = d.employee.companyRate;
    flexibleHousing.value.followWage = d.flexible.followWage;
    flexibleHousing.value.fixedBase = d.flexible.fixedBase;
    flexibleHousing.value.rate = d.flexible.rate;
  },
  { deep: true, immediate: true },
);

// 应用设置里的计算默认值：参保类型 / 户籍 / 医保档次 / 工伤类别
watch(
  () => props.calculatorDefaults,
  (d) => {
    if (!d) return;
    participationType.value = d.participationType;
    household.value = d.household;
    medicalTier.value = d.medicalTier;
    injuryClass.value = d.injuryClass;
  },
  { deep: true, immediate: true },
);

// 政策参数页修改公积金比例并保存后，试算页同步采用
watch(
  () => props.params.housingFund,
  (hf) => {
    if (!hf) return;
    employeeHousing.value.personalRate = hf.personalRate;
    employeeHousing.value.companyRate = hf.companyRate;
  },
  { deep: true },
);

// 三个可修改数值：月工资 / 到手工资 / 用工成本，最近修改的那个作为输入来源
const drivenBy = ref<'wage' | 'pretax' | 'net' | 'cost'>('wage');
const reverseWarning = ref('');

// 深户默认一档、非深户默认二档（可手动改）
watch(household, (h) => {
  medicalTier.value = h === 'deep' ? 1 : 2;
});

const input = computed<CalcInput>(() => ({
  wage: Number(wage.value) || 0,
  participationType: participationType.value,
  household: household.value,
  medicalTier: medicalTier.value,
  injuryClass: injuryClass.value,
  housingFund:
    participationType.value === 'employee'
      ? {
          followWage: employeeHousing.value.followWage,
          base: employeeHousing.value.fixedBase,
          personalRate: employeeHousing.value.personalRate,
          companyRate: employeeHousing.value.companyRate,
        }
      : undefined,
  flexibleHousingFund:
    participationType.value === 'flexible'
      ? {
          followWage: flexibleHousing.value.followWage,
          base: flexibleHousing.value.fixedBase,
          rate: flexibleHousing.value.rate,
        }
      : undefined,
  flexibleInsurance:
    participationType.value === 'flexible'
      ? { ...flexibleInsurance.value }
      : undefined,
}));

const housingState = computed(() =>
  participationType.value === 'employee' ? employeeHousing.value : flexibleHousing.value,
);

const housingBase = computed(() => {
  const h = housingState.value;
  return h.followWage ? Number(wage.value) || 0 : Number(h.fixedBase) || 0;
});

const housingWarning = computed(() => {
  const h = housingState.value;
  const rate = participationType.value === 'employee' ? h.personalRate : h.rate;
  if (rate * 100 > 12) {
    return `注意：当前个人比例 ${(rate * 100).toFixed(2)}%，超出 12% 的部分不能抵扣个人所得税。`;
  }
  return '';
});

// 公积金比例下拉选项：公司 0 或 5~12；个人随公司联动；灵活就业 0~24
const housingCompanyOptions = [0, 5, 6, 7, 8, 9, 10, 11, 12];
const housingPersonalOptions = computed(() => {
  const c = Math.round(employeeHousing.value.companyRate * 100);
  if (c <= 0) return [0];
  const opts: number[] = [];
  for (let v = c; v <= 12; v++) opts.push(v);
  return opts;
});
const housingFlexibleOptions = Array.from({ length: 25 }, (_, i) => i);

// 职工：个人比例 ≥ 公司比例，且最低 5%；只有公司比例为 0 时个人比例才可为 0
function employeePersonalMin(company: number): number {
  return company <= 0 ? 0 : Math.max(0.05, company);
}
watch(
  () => employeeHousing.value.companyRate,
  (c) => {
    if (c <= 0) {
      // 公司为 0 时，个人必须同时为 0
      employeeHousing.value.personalRate = 0;
    } else {
      const min = employeePersonalMin(c);
      if (employeeHousing.value.personalRate < min) {
        employeeHousing.value.personalRate = min;
      }
    }
  },
  { immediate: true },
);
watch(
  () => employeeHousing.value.personalRate,
  (p) => {
    const min = employeePersonalMin(employeeHousing.value.companyRate);
    if (p < min) {
      employeeHousing.value.personalRate = min;
    }
  },
);

const result = computed(() => calculate(input.value, props.params));

const pretaxInput = ref(pretaxIncome.value);
const netInput = ref(netAfterTax.value);
const costInput = ref(result.value.employmentCost);

// 月工资变化（或参数变化）时，同步另外两个数值；
// 但当前正在被用户编辑的那个保持不变，避免覆盖用户输入
watch(result, (r) => {
  if (drivenBy.value !== 'pretax') {
    pretaxInput.value = round2(pretaxIncome.value);
  }
  if (drivenBy.value !== 'net') netInput.value = round2(netAfterTax.value);
  if (drivenBy.value !== 'cost') costInput.value = round2(r.employmentCost);
});

// 政策参数变化时，按当前编辑来源重新反算工资
watch(
  () => props.params,
  () => {
    if (drivenBy.value === 'pretax') {
      wage.value = round2(
        findWageByNet(pretaxInput.value, input.value, props.params),
      );
    } else if (drivenBy.value === 'net') {
      wage.value = round2(
        findWageByAfterTax(
          netInput.value,
          input.value,
          props.params,
          extraMonthly.value,
        ),
      );
    } else if (drivenBy.value === 'cost') {
      wage.value = round2(findWageByCost(costInput.value, input.value, props.params));
    }
  },
  { deep: true },
);

const injuryOptions = computed(() =>
  props.params.injury.industryNames.map((name, i) => ({
    value: i + 1,
    label: `第${i + 1}类：${name}`,
  })),
);

/** 当前区间的具体数值范围，如“4,775 ~ 6,733 元” */
const bandText = computed(() => {
  const r = result.value;
  const from = r.bandFrom.toLocaleString('zh-CN');
  const to = r.bandTo === null ? '无上限' : r.bandTo.toLocaleString('zh-CN');
  return `${from} ~ ${to} 元`;
});

/** 悬浮提示：列出全部 6 个工资区间 */
const allBandsTip = computed(() => {
  const p = props.params;
  const rows = [
    ['最低工资~养老下限', `${p.minimumWage.toLocaleString('zh-CN')} ~ ${p.pension.baseMin.toLocaleString('zh-CN')} 元`],
    ['养老下限~医保下限', `${p.pension.baseMin.toLocaleString('zh-CN')} ~ ${p.medical.baseMin.toLocaleString('zh-CN')} 元`],
    ['医保下限~养老上限', `${p.medical.baseMin.toLocaleString('zh-CN')} ~ ${p.pension.baseMax.toLocaleString('zh-CN')} 元`],
    ['养老上限~医保上限', `${p.pension.baseMax.toLocaleString('zh-CN')} ~ ${p.medical.baseMax.toLocaleString('zh-CN')} 元`],
    ['医保上限~失业上限', `${p.medical.baseMax.toLocaleString('zh-CN')} ~ ${p.unemployment.baseMax.toLocaleString('zh-CN')} 元`],
    ['失业上限~无上限', `≥ ${p.unemployment.baseMax.toLocaleString('zh-CN')} 元`],
  ];
  return rows.map(([name, range]) => `${name}：${range}`).join('\n');
});

function fmt(n: number): string {
  return n.toLocaleString('zh-CN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function fmtRate(n: number): string {
  return `${(n * 100).toFixed(2)}%`;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function parseNumber(event: Event): number | null {
  const value = parseFloat((event.target as HTMLInputElement).value);
  return Number.isFinite(value) ? value : null;
}

function onWageInput(event: Event) {
  const v = parseNumber(event);
  if (v === null) return;
  drivenBy.value = 'wage';
  reverseWarning.value = '';
  wage.value = v;
}

function onPretaxInput(event: Event) {
  const v = parseNumber(event);
  if (v === null) return;
  drivenBy.value = 'pretax';
  reverseWarning.value = '';
  pretaxInput.value = v;
  const w = findWageByNet(v, input.value, props.params);
  wage.value = round2(w);
  if (w <= 0 && v > 0) {
    reverseWarning.value =
      '目标税前收入过低：工资为 0 时个人仍需缴纳最低社保，实际为负，无法达到该目标。';
  }
}

function onNetInput(event: Event) {
  const v = parseNumber(event);
  if (v === null) return;
  drivenBy.value = 'net';
  reverseWarning.value = '';
  netInput.value = v;
  const w = findWageByAfterTax(v, input.value, props.params, extraMonthly.value);
  wage.value = round2(w);
  if (w <= 0 && v > 0) {
    reverseWarning.value =
      '目标税后收入过低：工资为 0 时个人仍需缴纳最低社保和个税，实际到手为负，无法达到该目标。';
  }
}

function onCostInput(event: Event) {
  const v = parseNumber(event);
  if (v === null) return;
  drivenBy.value = 'cost';
  reverseWarning.value = '';
  costInput.value = v;
  const w = findWageByCost(v, input.value, props.params);
  wage.value = round2(w);
  if (w <= 0 && v > 0) {
    reverseWarning.value = '目标用工成本过低：工资为 0 时公司仍需缴纳最低社保成本，无法达到该目标。';
  }
}

</script>

<template>
  <div>
    <section class="card">
      <div class="grid calc-grid">
        <label class="field wage-field">
          <span>月工资（元）</span>
          <div class="wage-with-band">
            <input
              :value="wage"
              class="wage-input"
              type="number"
              min="0"
              step="0.01"
              @input="onWageInput"
            />
            <span class="band-stack">
              <span class="band-stack-line">
                <span class="band">{{ result.bandName }}</span>
                <span
                  class="band-help"
                  tabindex="0"
                  aria-label="查看全部工资区间"
                >
                  <span class="band-help-icon">ⓘ</span>
                  <span class="band-help-tip">{{ allBandsTip }}</span>
                </span>
              </span>
              <span class="band-range">（{{ bandText }}）</span>
            </span>
          </div>
        </label>

        <div class="field">
          <span>参保类型</span>
          <div class="segmented">
            <button
              type="button"
              :class="{ active: participationType === 'employee' }"
              @click="participationType = 'employee'"
            >
              职工
            </button>
            <button
              type="button"
              :class="{ active: participationType === 'flexible' }"
              @click="participationType = 'flexible'"
            >
              灵活就业
            </button>
          </div>
        </div>

        <div class="field">
          <span>
            户籍
            <span class="tip-wrap">
              <span class="tip">ⓘ</span>
              <span class="tip-tip tip-tip-short">深户地方补充养老保险公司多缴1%</span>
            </span>
          </span>
          <div class="segmented">
            <button
              type="button"
              :class="{ active: household === 'deep' }"
              @click="household = 'deep'"
            >
              深户
            </button>
            <button
              type="button"
              :class="{ active: household === 'non-deep' }"
              @click="household = 'non-deep'"
            >
              非深户
            </button>
          </div>
        </div>

        <label v-if="participationType === 'employee'" class="field">
          <span>医保档次{{ household === 'deep' ? '（深户强制一档）' : '' }}</span>
          <select
            v-model.number="medicalTier"
            class="medical-tier-select"
            :disabled="household === 'deep'"
          >
            <option :value="1">一档（个人2% / 公司6%）</option>
            <option :value="2" :disabled="household === 'deep'">二档（个人0.5% / 公司1.5%）</option>
          </select>
        </label>

        <label v-else class="field">
          <span>医保档次</span>
          <select class="medical-tier-select" disabled>
            <option>灵活就业（个人 8%）</option>
          </select>
        </label>
      </div>

      <div class="injury-row">
        <div v-if="participationType === 'employee'" class="field">
          <span>工伤行业类别</span>
          <SelectBox v-model="injuryClass" :options="injuryOptions" />
        </div>
        <div v-else class="flexible-insurance">
          <span class="field-label">灵活就业参保险种：</span>
          <label class="checkbox">
            <input type="checkbox" v-model="flexibleInsurance.pension" />
            养老
          </label>
          <label class="checkbox">
            <input type="checkbox" v-model="flexibleInsurance.medical" />
            医保
          </label>
          <label class="checkbox">
            <input type="checkbox" v-model="flexibleInsurance.unemployment" />
            失业
          </label>
          <label class="checkbox">
            <input type="checkbox" v-model="flexibleInsurance.housingFund" />
            公积金
          </label>
          <p class="note" style="margin: 8px 0 0; width: 100%">灵活就业不缴纳工伤保险。</p>
        </div>
      </div>

      <div
        v-if="participationType === 'employee' || flexibleInsurance.housingFund"
        class="housing-fund-settings"
      >
        <div class="housing-settings">
          <label class="field">
            <span>公积金缴费基数（元）</span>
            <div class="base-row">
              <label class="checkbox">
                <input type="checkbox" v-model="housingState.followWage" />
                跟随工资
              </label>
              <input
                v-model.number="housingState.fixedBase"
                class="base-fixed-input"
                type="number"
                min="0"
                step="0.01"
                :disabled="housingState.followWage"
              />
            </div>
          </label>
          <template v-if="participationType === 'employee'">
            <label class="field">
              <span>
                公司
                <span class="tip-wrap">
                  <span class="tip">ⓘ</span>
                  <span class="tip-tip tip-tip-short">可为 0 或 5%~12%</span>
                </span>
              </span>
              <RateInput v-model="employeeHousing.companyRate" :options="housingCompanyOptions" />
            </label>
            <label class="field">
              <span>
                个人
                <span class="tip-wrap">
                  <span class="tip">ⓘ</span>
                  <span class="tip-tip tip-tip-narrow">{{
                    '不得低于公司比例\n公司为0时，个人也为0'
                  }}</span>
                </span>
              </span>
              <RateInput v-model="employeeHousing.personalRate" :options="housingPersonalOptions" />
            </label>
          </template>
          <label v-else class="field">
            <span>公积金缴费比例（最高 24%）</span>
            <RateInput v-model="flexibleHousing.rate" :options="housingFlexibleOptions" />
          </label>
        </div>
        <div class="housing-warnings">
          <p
            v-if="participationType === 'employee' && employeeHousing.companyRate <= 0"
            class="note housing-warning company-zero-note"
          >
            未缴纳公积金仅需补缴，无滞纳金及罚款。
          </p>
          <p v-if="housingWarning" class="note housing-warning">{{ housingWarning }}</p>
        </div>
      </div>

    </section>

    <section class="summary">
      <div v-if="participationType === 'employee'" class="summary-group sg-2">
        <div class="sg-cell">
          <div class="sg-label">
            <span class="sg-label-text">公司社保合计（月）</span>
          </div>
          <div class="value red">{{ fmt(result.companyTotal) }} 元</div>
        </div>
        <div class="sg-cell">
          <div class="sg-label">
            <span class="sg-label-text">用工成本（月）</span>
          </div>
          <div class="editable-value">
            <input
              class="value-input red"
              type="number"
              step="0.01"
              min="0"
              :value="costInput"
              @input="onCostInput"
            />
            <span class="value-unit">元</span>
          </div>
        </div>
      </div>
      <div class="summary-group">
        <div class="sg-cell">
          <div class="sg-label">
            <span class="sg-label-text">个人社保合计（月）</span>
            <span class="tip-wrap sg-label-icon">
              <span class="tip">ⓘ</span>
              <span class="tip-tip tip-tip-short">等于专项扣除(月)</span>
            </span>
          </div>
          <div class="value green">{{ fmt(result.personalTotal) }} 元</div>
        </div>
        <span class="sg-symbol">➕</span>
        <div class="sg-cell">
          <div class="sg-label">
            <span class="sg-label-text">专项附加（月）</span>
            <button
              type="button"
              class="deduct-gear sg-label-icon"
              title="设置专项附加"
              @click="openDeductModal(true)"
            >
              ⚙️
            </button>
          </div>
          <div class="value">{{ fmt(extraMonthly) }} 元</div>
        </div>
        <span class="sg-symbol">➕</span>
        <div class="sg-cell">
          <div class="sg-label">
            <span class="sg-label-text">起征点（月）</span>
          </div>
          <div class="value">{{ fmt(TAX_THRESHOLD) }} 元</div>
        </div>
        <span class="sg-symbol">🟰</span>
        <div class="sg-cell">
          <div class="sg-label">
            <span class="sg-label-text">合计抵扣（月）</span>
          </div>
          <div class="value">{{ fmt(deductionTotal) }} 元</div>
        </div>
      </div>
      <div class="summary-group sg-4">
        <div class="sg-cell">
          <div class="sg-label">
            <span class="sg-label-text">月工资</span>
          </div>
          <div class="editable-value">
            <input
              class="value-input green"
              type="number"
              step="0.01"
              min="0"
              :value="wage"
              @input="onWageInput"
            />
            <span class="value-unit">元</span>
          </div>
        </div>
        <span class="sg-symbol">➖</span>
        <div class="sg-cell">
          <div class="sg-label">
            <span class="sg-label-text">个人社保合计（月）</span>
          </div>
          <div class="value">{{ fmt(result.personalTotal) }} 元</div>
        </div>
        <span class="sg-symbol">🟰</span>
        <div class="sg-cell">
          <div class="sg-label">
            <span class="sg-label-text">税前收入（月）</span>
          </div>
          <div class="editable-value">
            <input
              class="value-input green"
              type="number"
              step="0.01"
              min="0"
              :value="pretaxInput"
              @input="onPretaxInput"
            />
            <span class="value-unit">元</span>
          </div>
        </div>
        <span class="sg-symbol">➖</span>
        <div class="sg-cell">
          <div class="sg-label">
            <span class="sg-label-text">个人所得税（月）</span>
          </div>
          <div class="value">{{ fmt(incomeTax) }} 元</div>
        </div>
        <span class="sg-symbol">🟰</span>
        <div class="sg-cell">
          <div class="sg-label">
            <span class="sg-label-text">税后收入（月）</span>
          </div>
          <div class="editable-value">
            <input
              class="value-input green"
              type="number"
              step="0.01"
              min="0"
              :value="netInput"
              @input="onNetInput"
            />
            <span class="value-unit">元</span>
          </div>
        </div>
      </div>
    </section>
    <p v-if="reverseWarning" class="note red" style="margin: 0 0 12px">
      {{ reverseWarning }}
    </p>
    <p class="note" style="margin: 0 0 12px">
      <template v-if="participationType === 'employee'">
        修改月工资、税前收入、税后收入或用工成本均可（最后修改者为准），其余数值自动同步。
      </template>
      <template v-else>
        修改月工资、税前收入或税后收入均可（最后修改者为准），其余数值自动同步。
      </template>
    </p>

    <section class="card">
      <h2>明细</h2>
      <table class="detail-table">
        <thead>
          <tr>
            <th>险种</th>
            <th>缴费基数</th>
            <th>个人费率</th>
            <th>个人金额</th>
            <th>公司费率</th>
            <th>公司金额</th>
            <th>备注</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="it in result.items" :key="it.key">
            <td>{{ it.name }}</td>
            <td>{{ fmt(it.base) }}</td>
            <td>{{ fmtRate(it.personalRate) }}</td>
            <td class="red">{{ fmt(it.personalAmount) }}</td>
            <td>{{ fmtRate(it.companyRate) }}</td>
            <td class="red">{{ fmt(it.companyAmount) }}</td>
            <td class="note">{{ it.note || '' }}</td>
          </tr>
          <tr>
            <td><strong>合计</strong></td>
            <td></td>
            <td></td>
            <td><strong class="red">{{ fmt(result.personalTotal) }}</strong></td>
            <td></td>
            <td><strong class="red">{{ fmt(result.companyTotal) }}</strong></td>
            <td></td>
          </tr>
        </tbody>
      </table>
      <p class="note">
        金额按 Excel 公式全精度计算，界面显示四舍五入到 2 位小数；工资低于养老下限时养老按下限缴费，低于医保下限时医保/生育按下限缴费。
      </p>
    </section>

    <!-- 抵扣设置弹窗 -->
    <div v-if="showDeductionModal" class="modal-mask">
      <div class="modal-card deduct-modal">
        <div class="modal-head">
          <h2>抵扣设置</h2>
          <button type="button" class="modal-close" @click="showDeductionModal = false">✕</button>
        </div>
        <div v-if="!deductSpecialOnly" class="deduct-module">
          <span class="deduct-module-label">专项抵扣（月）</span>
          <span class="deduct-module-value">{{ fmt(result.personalTotal) }} 元</span>
        </div>
        <div class="deduct-module">
          <span class="deduct-module-label">专项附加</span>
          <span class="deduct-module-total">合计🟰 {{ fmt(extraMonthly) }} 元</span>
        </div>
        <div class="deduct-monthly">
          <div class="deduct-box-title-row">
            <span class="deduct-monthly-title">月度汇算</span>
            <span class="deduct-module-total">合计🟰 {{ fmt(monthlyModulesTotal) }} 元</span>
          </div>
            <div class="deduct-grid">
              <div class="deduct-item">
                <div class="deduct-title-row">
                  <span class="deduct-item-title">住房（二选一）</span>
                  <label class="switch">
                    <input type="checkbox" v-model="deduction.rentOn" />
                    <span class="slider"></span>
                  </label>
                </div>
                <template v-if="deduction.rentOn">
                  <div class="deduct-row">
                    <select v-model="deduction.rentLoan" class="deduct-select-small">
                      <option value="rent">一线租房（1500/月）</option>
                      <option value="loan">住房贷款</option>
                    </select>
                    <select
                      v-if="deduction.rentLoan === 'loan'"
                      v-model="deduction.loanType"
                      class="deduct-select-small"
                    >
                      <option value="none">无住贷（0）</option>
                      <option value="personal">个人住贷（1000/月）</option>
                      <option value="couple">夫妻住贷（500/月）</option>
                    </select>
                  </div>
                  <div class="deduct-result">每月 {{ fmt(rentLoanMonthly) }} 元</div>
                </template>
              </div>
            <div class="deduct-item">
              <div class="deduct-title-row">
                <span class="deduct-item-title">60+老人</span>
                <label class="switch">
                  <input type="checkbox" v-model="deduction.elderly" />
                  <span class="slider"></span>
                </label>
              </div>
              <template v-if="deduction.elderly">
                <label class="deduct-inline">
                  兄弟姐妹数
                  <select v-model.number="deduction.siblings" class="deduct-siblings-select">
                    <option v-for="n in 11" :key="n - 1" :value="n - 1">{{ n - 1 }}</option>
                  </select>
                </label>
                <div class="deduct-result">每月 {{ fmt(elderlyMonthly) }} 元</div>
              </template>
            </div>
            <div class="deduct-item">
              <div class="deduct-title-row">
                <span class="deduct-item-title">3 岁以下婴幼儿照护</span>
                <label class="switch">
                  <input type="checkbox" v-model="deduction.infantOn" />
                  <span class="slider"></span>
                </label>
              </div>
              <template v-if="deduction.infantOn">
                <div class="deduct-row">
                  <label class="deduct-inline">
                    孩子数量
                    <select v-model.number="deduction.infantCount" class="deduct-count-select">
                      <option v-for="n in 9" :key="n" :value="n">{{ n }}</option>
                    </select>
                  </label>
                  <label class="deduct-inline">
                    抵扣方式
                    <select v-model="deduction.infantSplit" class="deduct-select-small">
                      <option value="alone">独自抵扣</option>
                      <option value="couple">夫妻各抵一半</option>
                    </select>
                  </label>
                </div>
                <div class="deduct-result">每月 {{ fmt(infantMonthly) }} 元</div>
              </template>
            </div>
            <div class="deduct-item">
              <div class="deduct-title-row">
                <span class="deduct-item-title">子女教育</span>
                <label class="switch">
                  <input type="checkbox" v-model="deduction.childEduOn" />
                  <span class="slider"></span>
                </label>
              </div>
              <template v-if="deduction.childEduOn">
                <div class="deduct-row">
                  <label class="deduct-inline">
                    孩子数量
                    <select v-model.number="deduction.childEduCount" class="deduct-count-select">
                      <option v-for="n in 9" :key="n" :value="n">{{ n }}</option>
                    </select>
                  </label>
                  <label class="deduct-inline">
                    抵扣方式
                    <select v-model="deduction.childEduSplit" class="deduct-select-small">
                      <option value="alone">独自抵扣</option>
                      <option value="couple">夫妻各抵一半</option>
                    </select>
                  </label>
                </div>
                <div class="deduct-result">每月 {{ fmt(childEduMonthly) }} 元</div>
              </template>
            </div>
            <div class="deduct-item">
              <div class="deduct-title-row">
                <span class="deduct-item-title">学历学位教育</span>
                <label class="switch">
                  <input type="checkbox" v-model="deduction.eduDegree" />
                  <span class="slider"></span>
                </label>
              </div>
              <div class="deduct-result">每月 {{ fmt(eduDegreeMonthly) }} 元</div>
              </div>
            </div>
          </div>
          <div class="deduct-annual">
            <div class="deduct-box-title-row">
              <span class="deduct-annual-title">年度汇算</span>
              <span class="deduct-module-total">折算月度合计🟰 {{ fmt(annualMonthlyTotal) }} 元</span>
            </div>
            <div class="deduct-annual-row">
              <div class="deduct-item">
                <div class="deduct-title-row">
                  <span class="deduct-item-title">职业资格</span>
                  <label class="switch">
                    <input type="checkbox" v-model="deduction.qualification" />
                    <span class="slider"></span>
                  </label>
                </div>
                <div class="deduct-result">
                  年度汇算 {{ fmt(qualificationAnnual) }} 元 ｜ 折算月度 {{ fmt(qualificationAnnual / 12) }} 元
                </div>
              </div>
              <div class="deduct-item">
                <div class="deduct-title-row">
                  <span class="deduct-item-title">
                    大病医疗（个人自付）
                    <span class="tip-wrap">
                      <span class="tip">ⓘ</span>
                      <span class="tip-tip tip-tip-short">1.5w以上可抵扣，抵扣上限8w</span>
                    </span>
                  </span>
                  <label class="switch">
                    <input type="checkbox" v-model="deduction.medicalOn" />
                    <span class="slider"></span>
                  </label>
                </div>
                <template v-if="deduction.medicalOn">
                  <label class="deduct-inline">
                    个人自付金额
                    <input
                      v-model.number="deduction.medicalSelfPay"
                      type="number"
                      min="0"
                      class="deduct-number"
                    />
                  </label>
                  <div class="deduct-result">
                    年度汇算 {{ fmt(medicalAnnual) }} 元 ｜ 折算月度 {{ fmt(medicalAnnual / 12) }} 元
                  </div>
                </template>
              </div>
            </div>
          </div>
        <div class="block-actions">
          <button type="button" @click="showDeductionModal = false">取消</button>
          <button type="button" class="primary" @click="showDeductionModal = false">确定</button>
        </div>
      </div>
    </div>
  </div>
</template>
