<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { InsuranceParams, MinimumWageGroup } from '../../../core/types';

const props = defineProps<{ params: InsuranceParams }>();

// 最低兼职政策组：按有效期开始日期倒序（最新的在最前）
const groups = computed<MinimumWageGroup[]>(() =>
  [...(props.params.minimumWageGroups || [])].sort((a, b) =>
    (b.validityStart || '').localeCompare(a.validityStart || ''),
  ),
);

// 默认选中“今天处于有效期”的组，否则选最新一组
function defaultGroupIndex(): number {
  const now = new Date();
  const today =
    now.getFullYear() * 10000 + (now.getMonth() + 1) * 100 + now.getDate();
  const i = groups.value.findIndex((g) => {
    const s = g.validityStart
      ? Number(g.validityStart.replace(/-/g, ''))
      : 0;
    const e = g.validityEnd
      ? Number(g.validityEnd.replace(/-/g, ''))
      : 99999999;
    return today >= s && today <= e;
  });
  return i >= 0 ? i : 0;
}

const selectedIndex = ref(defaultGroupIndex());
const selectedGroup = computed(() => groups.value[selectedIndex.value] || null);
const partTimeWage = computed(
  () =>
    selectedGroup.value?.minimumPartTimeWage ??
    props.params.minimumPartTimeWage ??
    0,
);
const wageDisplay = computed(() =>
  partTimeWage.value > 0 ? String(partTimeWage.value) : '—',
);

// 时薪输入：默认等于最低兼职，低于最低兼职时数字变红
const hourlyWage = ref(partTimeWage.value);
const wageManual = ref(false);
const wageLow = computed(() => hourlyWage.value < partTimeWage.value);

watch(partTimeWage, (v) => {
  if (!wageManual.value) hourlyWage.value = v;
});

function onHourlyInput(event: Event) {
  const v = parseFloat((event.target as HTMLInputElement).value);
  hourlyWage.value = Number.isFinite(v) ? v : 0;
  wageManual.value = true;
}

// 超时时薪开关：关闭时按正常时薪；开启后超出“超时时间”的部分按“超时时薪”计算
interface OvertimeState {
  enabled: boolean;
  threshold: number;
  rate: number;
}

function loadOvertime(): OvertimeState {
  try {
    const raw = localStorage.getItem('parttimeOvertime');
    if (raw) {
      const s = JSON.parse(raw);
      return {
        enabled: !!s.enabled,
        threshold: Number(s.threshold) > 0 ? Number(s.threshold) : 8,
        rate: Number.isFinite(Number(s.rate))
          ? Number(s.rate)
          : hourlyWage.value,
      };
    }
  } catch {
    // 读取失败使用默认值
  }
  return { enabled: false, threshold: 8, rate: hourlyWage.value };
}

const overtime = ref<OvertimeState>(loadOvertime());
watch(
  overtime,
  (v) => {
    try {
      localStorage.setItem('parttimeOvertime', JSON.stringify(v));
    } catch {
      // 保存失败不影响使用
    }
  },
  { deep: true },
);

function onOvertimeThresholdInput(event: Event) {
  let v = parseFloat((event.target as HTMLInputElement).value);
  if (!Number.isFinite(v)) v = 0;
  if (v > 0 && v < 0.5) v = 0.5;
  overtime.value.threshold = v;
}

function onOvertimeRateInput(event: Event) {
  const v = parseFloat((event.target as HTMLInputElement).value);
  overtime.value.rate = Number.isFinite(v) ? v : 0;
}

const normalHours = computed(() =>
  overtime.value.enabled
    ? Math.min(dailyHours.value, overtime.value.threshold)
    : dailyHours.value,
);
const overtimeHours = computed(() =>
  overtime.value.enabled
    ? Math.max(0, dailyHours.value - overtime.value.threshold)
    : 0,
);
const dailyPay = computed(
  () =>
    normalHours.value * hourlyWage.value +
    overtimeHours.value * overtime.value.rate,
);
const weeklyPay = computed(() => dailyPay.value * weeklyDays.value);

function fmt(n: number): string {
  return n.toLocaleString('zh-CN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function groupLabel(g: MinimumWageGroup): string {
  if (g.validityStart || g.validityEnd)
    return `${g.validityStart || '?'} ~ ${g.validityEnd || '?'}`;
  return g.name || '未设置有效期';
}

// 每日/每周工作时长：每周 = 每日 × 7
const dailyHours = ref(1);
const weeklyDays = ref(7);
const weeklyHours = computed(() => dailyHours.value * weeklyDays.value);
const dailyOver = computed(() => dailyHours.value > 4);
const weeklyOver = computed(() => weeklyHours.value > 24);
</script>

<template>
  <div>
  <section class="card parttime-card">
    <div class="parttime-wage-row">
      <label v-if="groups.length > 0" class="field parttime-period-field">
        <span>有效期</span>
        <select v-model.number="selectedIndex">
          <option v-for="(g, i) in groups" :key="i" :value="i">
            {{ groupLabel(g) }}
          </option>
        </select>
      </label>
      <div class="parttime-wage-display">
        <span>最低兼职（元/h）</span>
        <strong>{{ wageDisplay }}</strong>
      </div>
    </div>

  </section>

    <div class="parttime-ot-head">
      <span class="parttime-ot-title">超时时薪</span>
      <label class="switch">
        <input type="checkbox" v-model="overtime.enabled" />
        <span class="slider"></span>
      </label>
    </div>

    <div class="parttime-formulas">
      <div v-if="!overtime.enabled" class="parttime-formula-box">
        <!-- 未开启超时时薪：文字在上、数字在下，运算符夹在中间 -->
        <div v-if="!overtime.enabled" class="pf-grid" style="grid-template-columns: auto auto auto auto auto">
        <span class="pf-op-mid" style="grid-column: 2; grid-row: 1 / 3">✖️</span>
        <span class="pf-op-mid" style="grid-column: 4; grid-row: 1 / 3">🟰</span>
        <span class="pf-name" style="grid-column: 1; grid-row: 1">
          每日工作时长
          <span class="tip-wrap">
            <span class="tip" :class="{ red: dailyOver }">ⓘ</span>
            <span class="tip-tip tip-tip-short">每日不超4h</span>
          </span>
        </span>
        <span class="pf-name" style="grid-column: 3; grid-row: 1">时薪</span>
        <span class="pf-name" style="grid-column: 5; grid-row: 1">日薪</span>
        <span class="pf-control" style="grid-column: 1; grid-row: 2">
          <select v-model.number="dailyHours" class="pf-input" :class="{ red: dailyOver }">
            <option v-for="h in 16" :key="h" :value="h">{{ h }}</option>
          </select>
        </span>
        <span class="pf-control" style="grid-column: 3; grid-row: 2">
          <input
            class="pf-input"
            :class="{ red: wageLow }"
            type="number"
            min="0"
            step="0.1"
            :value="hourlyWage === 0 ? '' : hourlyWage"
            @input="onHourlyInput"
          />
        </span>
        <span class="pf-result" style="grid-column: 5; grid-row: 2">{{ fmt(dailyPay) }} 元</span>
        </div>
        </div>

        <!-- 开启超时时薪 -->
        <template v-else>
        <!-- 未超过限定时长：完全复刻“每周工作天数”框的排法，每日工作时长只留一个在最前 -->
        <div v-if="overtimeHours === 0" class="parttime-formula-box parttime-week-box">
          <div class="pwb-factor">
            <span class="pf-name">
              每日工作时长
              <span class="tip-wrap">
                <span class="tip" :class="{ red: dailyOver }">ⓘ</span>
                <span class="tip-tip tip-tip-short">每日不超4h</span>
              </span>
            </span>
            <select v-model.number="dailyHours" class="pf-input" :class="{ red: dailyOver }">
              <option v-for="h in 16" :key="h" :value="h">{{ h }}</option>
            </select>
          </div>
          <div class="noover-ops">
            <span class="pwb-op pwb-op-mid">➖</span>
            <span class="pwb-op pwb-op-mid">✖️</span>
          </div>
          <div class="pwb-body">
            <!-- 超时工作 = 每日工作时长 ➖ 限定时长 -->
            <div class="pwb-term">
              <span class="pf-name">
                限定时长
                <span class="tip-wrap">
                  <span class="tip">ⓘ</span>
                  <span class="tip-tip tip-tip-short">每日超过此时长后，超出部分按超时时薪计算</span>
                </span>
              </span>
              <span class="pf-control">
                <input
                  class="pf-input"
                  type="number"
                  min="0.5"
                  step="0.5"
                  :value="overtime.threshold === 0 ? '' : overtime.threshold"
                  @input="onOvertimeThresholdInput"
                />
              </span>
            </div>
            <span class="pwb-op pwb-op-mid">🟰</span>
            <div class="pwb-term">
              <span class="pf-name">超时工作</span>
              <span class="pwb-result">{{ overtimeHours }}h</span>
            </div>
            <!-- 日薪 = 每日工作时长 ✖️ 时薪 -->
            <div class="pwb-term">
              <span class="pf-name">时薪</span>
              <span class="pf-control">
                <input
                  class="pf-input"
                  :class="{ red: wageLow }"
                  type="number"
                  min="0"
                  step="0.1"
                  :value="hourlyWage === 0 ? '' : hourlyWage"
                  @input="onHourlyInput"
                />
              </span>
            </div>
            <span class="pwb-op pwb-op-mid">🟰</span>
            <div class="pwb-term">
              <span class="pf-name">日薪</span>
              <span class="pwb-result">{{ fmt(dailyPay) }} 元</span>
            </div>
          </div>
        </div>
        <!-- 实际超时：整条公式拼成一行，超时工作只作为前面计算的结果出现一次 -->
        <template v-else>
          <div class="parttime-formula-box parttime-over-box">
            <div class="pf-grid parttime-over-grid" style="grid-template-columns: auto auto auto auto auto auto auto auto auto auto auto auto auto; grid-template-rows: auto auto">
              <!-- 名称层（第 1 行） -->
              <span class="pf-name" style="grid-column: 1; grid-row: 1">
                每日工作时长
                <span class="tip-wrap">
                  <span class="tip" :class="{ red: dailyOver }">ⓘ</span>
                  <span class="tip-tip tip-tip-short">每日不超4h</span>
                </span>
              </span>
              <span class="pf-name" style="grid-column: 3; grid-row: 1">
                限定时长
                <span class="tip-wrap">
                  <span class="tip">ⓘ</span>
                  <span class="tip-tip tip-tip-short">每日超过此时长后，超出部分按超时时薪计算</span>
                </span>
              </span>
              <span class="pf-name" style="grid-column: 5; grid-row: 1">超时工作</span>
              <span class="pf-name" style="grid-column: 7; grid-row: 1">超时时薪</span>
              <span class="pf-name" style="grid-column: 9; grid-row: 1">限定时长</span>
              <span class="pf-name" style="grid-column: 11; grid-row: 1">时薪</span>
              <span class="pf-name" style="grid-column: 13; grid-row: 1">日薪</span>
              <!-- 运算符：跨两层（名称与数值之间）居中 -->
              <span class="pf-op-mid" style="grid-column: 2; grid-row: 1 / 3">➖</span>
              <span class="pf-op-mid" style="grid-column: 4; grid-row: 1 / 3">🟰</span>
              <span class="pf-op-mid" style="grid-column: 6; grid-row: 1 / 3">✖️</span>
              <span class="pf-op-mid" style="grid-column: 8; grid-row: 1 / 3">➕</span>
              <span class="pf-op-mid" style="grid-column: 10; grid-row: 1 / 3">✖️</span>
              <span class="pf-op-mid" style="grid-column: 12; grid-row: 1 / 3">🟰</span>
              <!-- 数值层（第 2 行） -->
              <span class="pf-control" style="grid-column: 1; grid-row: 2">
                <select v-model.number="dailyHours" class="pf-input" :class="{ red: dailyOver }">
                  <option v-for="h in 16" :key="h" :value="h">{{ h }}</option>
                </select>
              </span>
              <span class="pf-control" style="grid-column: 3; grid-row: 2">
                <input
                  class="pf-input"
                  type="number"
                  min="0.5"
                  step="0.5"
                  :value="overtime.threshold === 0 ? '' : overtime.threshold"
                  @input="onOvertimeThresholdInput"
                />
              </span>
              <span class="pf-result" style="grid-column: 5; grid-row: 2">
                {{ overtimeHours }}h
              </span>
              <span class="pf-control" style="grid-column: 7; grid-row: 2">
                <input
                  class="pf-input"
                  type="number"
                  min="0"
                  step="0.1"
                  :value="overtime.rate === 0 ? '' : overtime.rate"
                  @input="onOvertimeRateInput"
                />
              </span>
              <span class="pf-readonly" style="grid-column: 9; grid-row: 2">{{ overtime.threshold }}h</span>
              <span class="pf-control" style="grid-column: 11; grid-row: 2">
                <input
                  class="pf-input"
                  :class="{ red: wageLow }"
                  type="number"
                  min="0"
                  step="0.1"
                  :value="hourlyWage === 0 ? '' : hourlyWage"
                  @input="onHourlyInput"
                />
              </span>
              <span class="pf-result" style="grid-column: 13; grid-row: 2">{{ fmt(dailyPay) }} 元</span>
            </div>
          </div>
        </template>
        </template>

        <!-- 每周工作时长 / 周薪：共用“每周工作天数”，放在最前 -->
        <div class="parttime-formula-box parttime-week-box">
          <div class="pwb-factor">
            <span class="pf-name">每周工作天数</span>
            <select v-model.number="weeklyDays" class="pf-input">
              <option v-for="d in 7" :key="d" :value="d">{{ d }}</option>
            </select>
          </div>
          <span class="pwb-op">✖️</span>
          <div class="pwb-body">
            <div class="pwb-term">
              <span class="pf-name">每日工作时长</span>
              <span class="pwb-value">{{ dailyHours }}h</span>
            </div>
            <span class="pwb-op pwb-op-mid">🟰</span>
            <div class="pwb-term">
              <span class="pf-name">
                每周工作时长
                <span class="tip-wrap">
                  <span class="tip" :class="{ red: weeklyOver }">ⓘ</span>
                  <span class="tip-tip tip-tip-short">每周不超24h</span>
                </span>
              </span>
              <span class="pwb-result" :class="{ red: weeklyOver }">{{ weeklyHours }}h</span>
            </div>
            <div class="pwb-term">
              <span class="pf-name">日薪</span>
              <span class="pwb-value">{{ fmt(dailyPay) }} 元</span>
            </div>
            <span class="pwb-op pwb-op-mid">🟰</span>
            <div class="pwb-term">
              <span class="pf-name">周薪</span>
              <span class="pwb-result">{{ fmt(weeklyPay) }} 元</span>
            </div>
          </div>
        </div>
    </div>
  </div>
</template>
