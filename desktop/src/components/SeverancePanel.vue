<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import {
  calculateSeverance,
  localToday,
  splitYearsMonths,
  yearsBetween,
  yearsToN,
} from '../../../core/severance';
import type { Contact, PendingLayoff } from '../../../core/business';
import ContactsPanel from './ContactsPanel.vue';
import PendingLayoffsPanel from './PendingLayoffsPanel.vue';
import DateSegments from './DateSegments.vue';
import SegSelect from './SegSelect.vue';

export interface SeveranceDefaults {
  monthlyWage: number;
  years: number;
  useCap: boolean;
  /** 思源笔记块链接（情况一/二/三） */
  tipLinks: { n: string; nPlus1: string; twoN: string };
}

const props = defineProps<{
  avgSources: { allUnit: number; nonPrivate: number; onPost: number };
  regionName: string;
  defaults: SeveranceDefaults;
  contacts: Contact[];
  pendingLayoffs: PendingLayoff[];
  deletedContacts: Contact[];
  deletedPendingLayoffs: PendingLayoff[];
  companyId: string;
}>();

const subTab = ref<'calc' | 'pending' | 'contacts'>('calc');

const monthlyWage = ref(props.defaults.monthlyWage);
const bonus = ref(0);
const entryDate = ref('');
const yearsNum = ref(props.defaults.years);
const monthsSel = ref(0);
const monthWorkOptions = Array.from({ length: 13 }, (_, i) => String(i));
const useCap = ref(props.defaults.useCap);

// 平均工资固定使用“全口径城镇单位就业人员”，可手动修改（红字提示）；
// 手动值在切换子页面时保留，点“重置”或重启软件才恢复政策参数值
const avgManual = ref(false);
const avgInput = ref(Number(props.avgSources.allUnit || 0) || 0);

watch(
  () => props.avgSources.allUnit,
  (v) => {
    if (!avgManual.value) avgInput.value = Number(v || 0) || 0;
  },
);

const AVG_WAGE_MAX = 99999;

function onAvgInput(event: Event) {
  const el = event.target as HTMLInputElement;
  let clean = el.value.replace(/[^\d.]/g, '');
  const dot = clean.indexOf('.');
  if (dot !== -1) {
    clean = clean.slice(0, dot + 1) + clean.slice(dot + 1).replace(/\./g, '');
  }
  // 整数部分最多 5 位：超出的字符不被输入
  const parts = clean.split('.');
  if (parts[0].length > 5) parts[0] = parts[0].slice(0, 5);
  clean = parts.join('.');
  if (clean !== el.value) el.value = clean;
  // 输入中间态（空、"."、"5."）保留
  if (clean === '' || clean === '.' || /^\d+\.$/.test(clean)) return;
  avgInput.value = Math.min(Number(clean) || 0, AVG_WAGE_MAX);
  avgManual.value = true;
}

function setAvgWage(v: number) {
  avgInput.value = Math.min(Number(v || 0) || 0, AVG_WAGE_MAX);
  avgManual.value = true;
}

function resetAvgWage() {
  avgManual.value = false;
  avgInput.value = Number(props.avgSources.allUnit || 0) || 0;
}

/** 工作年限：最多 2 位数字（0~99），只接受数字 */
function onYearsInput(event: Event) {
  const el = event.target as HTMLInputElement;
  const digits = el.value.replace(/\D/g, '').slice(0, 2);
  yearsNum.value = Number(digits || 0);
}

/** 奖金：空值按 0 处理 */
function onBonusInput(event: Event) {
  const el = event.target as HTMLInputElement;
  bonus.value = el.value === '' ? 0 : Number(el.value);
}

/** 计入时长(月)：最多 6 个字符（如 1000.5），只保留数字与一个小数点 */
function onTenureInput(event: Event) {
  tenureManual.value = true;
  const el = event.target as HTMLInputElement;
  const raw = el.value.slice(0, 6).replace(/[^\d.]/g, '');
  const firstDot = raw.indexOf('.');
  const fixed =
    firstDot === -1
      ? raw
      : raw.slice(0, firstDot + 1) + raw.slice(firstDot + 1).replace(/\./g, '');
  tenureMonths.value = Number(fixed || 0);
}

/** 键盘：+/- 增减年限；第 3 位数字及非数字字符禁止输入 */
function onYearsKeydown(event: KeyboardEvent) {
  if (event.key === '+' || event.key === '=') {
    event.preventDefault();
    yearsNum.value = Math.min(99, (Number(yearsNum.value) || 0) + 1);
  } else if (event.key === '-' || event.key === '_') {
    event.preventDefault();
    yearsNum.value = Math.max(0, (Number(yearsNum.value) || 0) - 1);
  } else if (event.key.length === 1) {
    if (!/\d/.test(event.key)) {
      // 非数字字符（含小数点、e、正负号）不允许输入
      event.preventDefault();
    } else {
      const el = event.target as HTMLInputElement;
      const nextDigits = (el.value + event.key).replace(/\D/g, '');
      if (nextDigits.length > 2) {
        event.preventDefault();
      }
    }
  }
}

const effectiveAvgMonthly = computed(
  () => Number(avgInput.value) || 0,
);

watch(
  () => props.defaults,
  (d) => {
    monthlyWage.value = d.monthlyWage;
    yearsNum.value = d.years;
    useCap.value = d.useCap;
  },
  { deep: true },
);

const totalYears = computed(
  () => Math.floor(Number(yearsNum.value) || 0) + (Number(monthsSel.value) || 0) / 12,
);

// 入职时间有效后自动折算工作年限（年+月）
watch(entryDate, (v) => {
  if (!v) return;
  const dec = yearsBetween(v, localToday());
  const split = splitYearsMonths(dec);
  yearsNum.value = split.years;
  monthsSel.value = split.months;
});

/** 计入时长(月)：按 N 规则折算后的月数，随工作年限自动更新，也可手动修改 */
const tenureMonths = ref(yearsToN(Number(props.defaults.years) || 0));
const tenureManual = ref(false);

// 工作年限变化时自动折算并复位手动标记
watch([yearsNum, monthsSel], () => {
  tenureMonths.value = yearsToN(totalYears.value);
  tenureManual.value = false;
});

/** 计算基数（平均月工资）= 月工资 + 奖金 ÷ 12 */
const wageBase = computed(
  () =>
    (Number(monthlyWage.value) || 0) +
    (Number(bonus.value) || 0) / 12,
);

/** 3 倍封顶条件：勾选且平均工资有效且工资（含奖金）超过当地平均 3 倍 */
const capCondition = computed(
  () =>
    useCap.value &&
    effectiveAvgMonthly.value > 0 &&
    wageBase.value > effectiveAvgMonthly.value * 3,
);

/** 计入时长生效值：手动值或按工作年限折算值；触发封顶时上限 12 */
const effectiveTenure = computed(() => {
  const base = tenureManual.value
    ? tenureMonths.value
    : yearsToN(totalYears.value);
  return capCondition.value ? Math.min(base, 12) : base;
});

const result = computed(() =>
  calculateSeverance({
    monthlyWage: wageBase.value,
    years: effectiveTenure.value,
    preConverted: true,
    avgMonthlyWage: effectiveAvgMonthly.value,
    useCap: useCap.value,
  }),
);

/** 是否触发 3 倍工资封顶（红字提示用） */
const capActive = computed(() => capCondition.value);
const yearsLocked = computed(
  () => capCondition.value && effectiveTenure.value === 12,
);

function fmt(n: number): string {
  return n.toLocaleString('zh-CN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/** 金额格式：整千不带多余的 .00 */
function fmtClean(n: number): string {
  return n.toLocaleString('zh-CN', {
    maximumFractionDigits: 2,
  });
}
</script>

<template>
  <div class="severance-panel">
    <div class="sub-tabs">
      <button :class="{ active: subTab === 'calc' }" @click="subTab = 'calc'">计算器</button>
      <button :class="{ active: subTab === 'pending' }" @click="subTab = 'pending'">待辞退</button>
      <button :class="{ active: subTab === 'contacts' }" @click="subTab = 'contacts'">通讯录</button>
    </div>

    <template v-if="subTab === 'calc'">
      <section class="card">
        <div class="calc-head">
          <h2>赔偿计算（经济补偿 N / N+1 / 2N）</h2>
          <div class="avg-source-row">
            <span>广东省全口径城镇单位就业人员平均工资：</span>
            <input
              :value="avgInput"
              class="avg-input"
              :class="{ 'avg-manual': avgManual }"
              type="text"
              inputmode="decimal"
              @input="onAvgInput"
            />
            <span class="avg-triple">✖️3=</span>
            <span class="avg-triple-result">{{ fmtClean(avgInput * 3) }}</span>
            <button
              type="button"
              class="avg-reset-btn"
              title="重置"
              @click="resetAvgWage"
            >
              ⟳
            </button>
          </div>
        </div>
        <div class="infer-grid calc-grid">
          <div class="field">
            <div class="wage-bonus-labels">
              <span>
                月工资
                <span class="tip-wrap">
                  <span class="tip">ⓘ</span>
                  <span class="tip-tip tip-tip-short">终止合同前12个月前</span>
                </span>
              </span>
              <span>＋</span>
              <span>奖金</span>
              <span>＝</span>
              <span>平均月工资</span>
            </div>
            <div class="wage-bonus-row">
              <input
                v-model.number="monthlyWage"
                class="wage-part-input"
                type="number"
                min="0"
                step="0.01"
              />
              <span class="calc-symbol">＋</span>
              <input
                :value="bonus === 0 ? '' : bonus"
                class="bonus-part-input"
                type="number"
                min="0"
                step="0.01"
                @input="onBonusInput"
              />
              <span class="calc-symbol">＝</span>
              <input
                :value="fmt(wageBase)"
                class="avg-part-input"
                type="text"
                readonly
              />
            </div>
          </div>
          <div class="field tenure-chain">
            <div class="chain-col">
              <span class="chain-col-label">入职时间</span>
              <DateSegments v-model="entryDate" />
            </div>
            <span class="chain-arrow">➡</span>
            <div class="chain-col">
              <span class="chain-col-label">工作时长</span>
              <div class="years-row">
                <input
                  :value="yearsNum === 0 ? '' : yearsNum"
                  class="years-input"
                  type="number"
                  min="0"
                  max="99"
                  step="1"
                  @input="onYearsInput"
                  @keydown="onYearsKeydown"
                />
                <span class="years-unit">年</span>
                <SegSelect
                  :model-value="String(monthsSel)"
                  class="months-select"
                  :options="monthWorkOptions"
                  :columns="2"
                  @update:model-value="monthsSel = Number($event)"
                />
                <span class="years-unit">月</span>
              </div>
            </div>
            <span class="chain-arrow">➡</span>
            <div class="chain-col">
              <span class="chain-col-label">计入时长(月)</span>
              <input
                :value="effectiveTenure === 0 ? '' : effectiveTenure"
                :class="{ 'tenure-manual': tenureManual }"
                class="tenure-input"
                type="number"
                min="0"
                step="0.5"
                @input="onTenureInput"
              />
            </div>
          </div>
          <label class="checkbox" style="align-self: end; padding-bottom: 9px">
            <input type="checkbox" v-model="useCap" />
            启用 3 倍封顶 + 12 年上限
          </label>
        </div>
        <p v-if="capActive" class="red-text" style="margin-top: 10px">
          工资已超过“广东省上年度全口径城镇单位就业人员月平均工资”的3倍（{{ fmtClean(result.cappedWage) }}元），锁定工资为{{ fmtClean(result.cappedWage) }}元{{ yearsLocked ? '、年限为12个月' : '' }}
        </p>
        <p class="note" style="margin-top: 10px">
          月工资与奖金合计作为计算基数；平均工资固定使用广东省全口径城镇单位就业人员平均工资，可手动修改（手动修改显示红字，不影响政策参数）。
        </p>
        <div class="pending-preview">
          <div class="preview-card">
            <span>N</span>
            <b>{{ fmt(result.n) }} 元</b>
          </div>
          <div class="preview-card">
            <span>N+1</span>
            <b>{{ fmt(result.nPlus1) }} 元</b>
          </div>
          <div class="preview-card">
            <span>2N</span>
            <b>{{ fmt(result.twoN) }} 元</b>
          </div>
        </div>
      </section>

    </template>

    <PendingLayoffsPanel
      v-else-if="subTab === 'pending'"
      :contacts="contacts"
      :pending-layoffs="pendingLayoffs"
      :company-id="companyId"
      :avg-sources="avgSources"
      :avg-wage="avgInput"
      :avg-manual="avgManual"
      :defaults="defaults"
      :tip-links="defaults.tipLinks"
      @update:avg-wage="setAvgWage"
      @reset:avg-wage="resetAvgWage"
    />

    <ContactsPanel
      v-else
      :contacts="contacts"
      :pending-layoffs="pendingLayoffs"
      :deleted-contacts="deletedContacts"
      :deleted-pending-layoffs="deletedPendingLayoffs"
      :defaults="defaults"
      :avg-sources="avgSources"
      :avg-wage="avgInput"
      :avg-manual="avgManual"
      :company-id="companyId"
      @update:avg-wage="setAvgWage"
      @reset:avg-wage="resetAvgWage"
    />
  </div>
</template>
