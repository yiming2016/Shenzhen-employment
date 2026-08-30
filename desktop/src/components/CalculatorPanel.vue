<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { calculate, findWageByCost, findWageByNet } from '../../../core/engine';
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
const drivenBy = ref<'wage' | 'net' | 'cost'>('wage');
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
          base: housingBase.value,
          personalRate: employeeHousing.value.personalRate,
          companyRate: employeeHousing.value.companyRate,
        }
      : undefined,
  flexibleHousingFund:
    participationType.value === 'flexible'
      ? {
          base: housingBase.value,
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

const netInput = ref(result.value.netWage);
const costInput = ref(result.value.employmentCost);

// 月工资变化（或参数变化）时，同步另外两个数值；
// 但当前正在被用户编辑的那个保持不变，避免覆盖用户输入
watch(result, (r) => {
  if (drivenBy.value !== 'net') netInput.value = round2(r.netWage);
  if (drivenBy.value !== 'cost') costInput.value = round2(r.employmentCost);
});

// 政策参数变化时，按当前编辑来源重新反算工资
watch(
  () => props.params,
  () => {
    if (drivenBy.value === 'net') {
      wage.value = round2(findWageByNet(netInput.value, input.value, props.params));
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

function onNetInput(event: Event) {
  const v = parseNumber(event);
  if (v === null) return;
  drivenBy.value = 'net';
  reverseWarning.value = '';
  netInput.value = v;
  const w = findWageByNet(v, input.value, props.params);
  wage.value = round2(w);
  if (w <= 0 && v > 0) {
    reverseWarning.value = '目标到手工资过低：工资为 0 时个人仍需缴纳最低社保，实际到手为负，无法达到该目标。';
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
      <h2>输入</h2>
      <div class="grid calc-grid">
        <label class="field">
          <span>月工资（元）</span>
          <input
            :value="wage"
            class="wage-input"
            type="number"
            min="0"
            step="0.01"
            @input="onWageInput"
          />
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
          <span>户籍</span>
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
          <span>医保档次{{ household === 'deep' ? '（深户仅一档）' : '' }}</span>
          <select v-model.number="medicalTier" :disabled="household === 'deep'">
            <option :value="1">一档（个人2% / 公司6%）</option>
            <option :value="2" :disabled="household === 'deep'">二档（个人0.5% / 公司1.5%）</option>
          </select>
        </label>

        <label v-else class="field">
          <span>医保档次</span>
          <select disabled>
            <option>灵活就业（个人 8%）</option>
          </select>
        </label>
        <p class="note band-note band-note-row">
          当前工资区间：
          <span class="band">{{ result.bandName }}</span>
          <span class="band-range">（{{ bandText }}）</span>
          <span class="band-help" tabindex="0" aria-label="查看全部工资区间">
            <span class="band-help-icon">ⓘ</span>
            <span class="band-help-tip">{{ allBandsTip }}</span>
          </span>
        </p>
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
        <div class="housing-settings" :class="{ 'three-cols': participationType === 'employee' }">
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
              <span>公积金公司比例</span>
              <RateInput v-model="employeeHousing.companyRate" :options="housingCompanyOptions" />
            </label>
            <label class="field">
              <span>公积金个人比例</span>
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
        <p v-if="participationType === 'employee'" class="note" style="margin-top: 8px">
          公司比例可为 0 或 5%~12%；个人比例可为 0 或 5%~12%，且不能低于公司比例；
          个人为 0 时公司必须为 0，公司为 0 时个人自动为 0。
        </p>
      </div>

    </section>

    <section class="summary">
      <div v-if="participationType === 'employee'" class="card">
        <div class="label">公司社保合计（月）</div>
        <div class="value red">{{ fmt(result.companyTotal) }} 元</div>
      </div>
      <div v-if="participationType === 'employee'" class="card">
        <div class="label">用工成本（月）</div>
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
      <div class="card">
        <div class="label">个人社保合计（月）</div>
        <div class="value green">{{ fmt(result.personalTotal) }} 元</div>
      </div>
      <div class="card">
        <div class="label">到手工资（月）</div>
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
    </section>
    <p v-if="reverseWarning" class="note red" style="margin: 0 0 12px">
      {{ reverseWarning }}
    </p>
    <p class="note" style="margin: 0 0 12px">
      <template v-if="participationType === 'employee'">
        修改"到手工资"或"用工成本"会自动反算月工资；修改月工资会同步更新另外两项。三者始终按同一套社保规则保持一致。
      </template>
      <template v-else>
        修改"到手工资"会自动反算月工资；修改月工资会同步更新到手工资。
      </template>
    </p>

    <section class="card">
      <h2>明细</h2>
      <table>
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
  </div>
</template>
