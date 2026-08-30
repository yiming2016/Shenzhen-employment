<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';

const props = withDefaults(
  defineProps<{
    modelValue?: string;
    /** 校验失败标红 */
    invalid?: boolean;
    /** 允许输入的最早年份 */
    minYear?: number;
  }>(),
  { modelValue: '', invalid: false, minYear: 2022 },
);

const emit = defineEmits<{
  (e: 'update:modelValue', v: string): void;
  /** 在“日”段按 →：跳到下一个日期字段 */
  (e: 'advance'): void;
  /** 在“年”段按 ←：跳回上一个日期字段 */
  (e: 'retreat'): void;
}>();

const y = ref('');
const m = ref('');
const d = ref('');
const yInput = ref<HTMLInputElement | null>(null);
const mInput = ref<HTMLInputElement | null>(null);
const dInput = ref<HTMLInputElement | null>(null);
// 自己发出的更新不回写分段，避免把“6”重新显示成“06”。
let suppressSync = false;
// 月/日是否“完成”：两位数字，或只剩一位且已失焦（如只输入 6 就算 06）。
const mCommitted = ref(false);
const dCommitted = ref(false);

watch(
  () => props.modelValue,
  (v) => {
    if (suppressSync) return;
    const mm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v || '');
    y.value = mm ? mm[1] : '';
    m.value = mm ? mm[2] : '';
    d.value = mm ? mm[3] : '';
    mCommitted.value = !!mm;
    dCommitted.value = !!mm;
  },
  { immediate: true },
);

// 只保留数字，并控制长度。
// 完整时按 YYYY-MM-DD 发出（月/日不足两位自动补 0 仅用于存储，界面不补）；
// 全部清空时发出空串；只删掉一半不发出，避免把年、月一起清掉。
function push() {
  const mOk = m.value.length >= 1 && m.value.length <= 2;
  const dOk = d.value.length >= 1 && d.value.length <= 2;
  if (
    y.value.length === 4 &&
    yearPrefixOk(y.value) &&
    mCommitted.value &&
    dCommitted.value &&
    mOk &&
    dOk
  ) {
    suppressSync = true;
    emit(
      'update:modelValue',
      `${y.value}-${String(m.value).padStart(2, '0')}-${String(d.value).padStart(2, '0')}`,
    );
    nextTick(() => {
      suppressSync = false;
    });
  } else if (!y.value && !m.value && !d.value) {
    suppressSync = true;
    emit('update:modelValue', '');
    nextTick(() => {
      suppressSync = false;
    });
  }
}

// ---- 即时校验：输入到一半时，如果该段已不可能组成合法日期就立刻标红 ----
function yearPrefixOk(s: string): boolean {
  if (!s) return true;
  if (!/^\d{1,4}$/.test(s)) return false;
  // 年份范围 minYear ~ 2050：前缀必须有可能落在该区间内。
  const min = Number(s.padEnd(4, '0'));
  const max = Number(s.padEnd(4, '9'));
  return max >= props.minYear && min <= 2050;
}

function monthPrefixOk(s: string): boolean {
  if (!s) return true;
  if (!/^\d{1,2}$/.test(s)) return false;
  if (s.length === 1) return true; // 单数字可补成 01~09，不算错
  const n = Number(s);
  return n >= 1 && n <= 12;
}

function dayPrefixOk(s: string): boolean {
  if (!s) return true;
  if (!/^\d{1,2}$/.test(s)) return false;
  if (s.length === 1) return true; // 单数字可补成 01~09，不算错
  const n = Number(s);
  return n >= 1 && n <= 31;
}

const segInvalid = computed(
  () =>
    !yearPrefixOk(y.value) ||
    !monthPrefixOk(m.value) ||
    !dayPrefixOk(d.value),
);

// 严格顺序：先年、再月、再日。
const yearReady = computed(
  () => y.value.length === 4 && yearPrefixOk(y.value),
);
const monthReady = computed(
  () => mCommitted.value && m.value.length >= 1 && monthPrefixOk(m.value),
);
const dayAllowed = computed(() => yearReady.value && monthReady.value);

function onYear(e: Event) {
  const el = e.target as HTMLInputElement;
  el.value = el.value.replace(/\D/g, '').slice(0, 4);
  y.value = el.value;
  // 只有年份合法时才自动跳到月，出错（如 2051、21xx）则停在当前段。
  if (el.value.length === 4 && yearPrefixOk(el.value) && mInput.value) {
    mInput.value.focus();
    mInput.value.select();
  }
  push();
}

function onMonth(e: Event) {
  const el = e.target as HTMLInputElement;
  el.value = el.value.replace(/\D/g, '').slice(0, 2);
  m.value = el.value;
  if (m.value.length === 2) {
    mCommitted.value = monthPrefixOk(m.value);
  } else if (m.value.length === 1) {
    // 2~9 只能组成 06~09，视为完成；0/1 等待第二位
    mCommitted.value = m.value >= '2' && m.value <= '9';
  } else {
    mCommitted.value = false;
  }
  // 月份完成且合法时才跳到日（13、20 等错误则停留）。
  if (mCommitted.value && dInput.value) {
    dInput.value.focus();
    dInput.value.select();
  }
  push();
}

function onDay(e: Event) {
  const el = e.target as HTMLInputElement;
  el.value = el.value.replace(/\D/g, '').slice(0, 2);
  d.value = el.value;
  if (d.value.length === 2) {
    dCommitted.value = dayPrefixOk(d.value);
  } else if (d.value.length === 1) {
    // 4~9 只能组成 04~09，视为完成；0~3 等待第二位
    dCommitted.value = d.value >= '4' && d.value <= '9';
  } else {
    dCommitted.value = false;
  }
  push();
}

// 失焦时把遗留的一位数字视为完成（保存时补 0，界面不补）。
function onMonthBlur() {
  if (m.value) mCommitted.value = true;
  push();
}

function onDayBlur() {
  if (d.value) dCommitted.value = true;
  push();
}

// 键盘：上下增减当前段；左右切换年/月/日；退格从空的月/日跳回上一位。
function onKey(e: KeyboardEvent) {
  const el = e.target as HTMLInputElement;
  const pad = (n: number, len: number) => String(n).padStart(len, '0');

  if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
    e.preventDefault();
    const delta = e.key === 'ArrowUp' ? 1 : -1;
    if (el === yInput.value) {
      // 年份只在 minYear ~ 2050 内增减，两端都不会越界
      const n = Math.max(props.minYear, Math.min(2050, (parseInt(y.value, 10) || 0) + delta));
      y.value = pad(n, 4);
      el.value = y.value;
      // 年份变化可能影响闰年 2 月，超出的日数收回
      clampDayToMonth();
    } else if (el === mInput.value) {
      // 月份循环 1 ~ 12
      let n = (parseInt(m.value, 10) || 0) + delta;
      if (n < 1) n = 12;
      else if (n > 12) n = 1;
      m.value = pad(n, 2);
      el.value = m.value;
      mCommitted.value = true;
      // 月份变化后，日超过新月份天数则收回
      clampDayToMonth();
    } else if (el === dInput.value) {
      // 日按当前年/月的实际天数循环 1 ~ 当月最后一天
      const max = currentDaysInMonth();
      let n = (parseInt(d.value, 10) || 0) + delta;
      if (n < 1) n = max;
      else if (n > max) n = 1;
      d.value = pad(n, 2);
      el.value = d.value;
      dCommitted.value = true;
    }
    push();
    return;
  }

  if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
    e.preventDefault();
    const dir = e.key === 'ArrowRight' ? 1 : -1;
    if (el === yInput.value && dir === 1 && yearReady.value && mInput.value) {
      mInput.value.focus();
      mInput.value.select();
    } else if (el === mInput.value) {
      if (dir === -1 && yInput.value) {
        yInput.value.focus();
        yInput.value.select();
      } else if (dir === 1 && monthReady.value && dInput.value) {
        dInput.value.focus();
        dInput.value.select();
      }
    } else if (el === dInput.value && dir === -1 && mInput.value) {
      mInput.value.focus();
      mInput.value.select();
    } else if (el === dInput.value && dir === 1) {
      // 日在最后一个位置：跳到下一个日期字段
      emit('advance');
    } else if (el === yInput.value && dir === -1) {
      // 年在第一个位置：跳回上一个日期字段
      emit('retreat');
    }
    return;
  }

  if (e.key === 'Backspace') {
    if (el === mInput.value && m.value === '' && yInput.value) {
      e.preventDefault();
      yInput.value.focus();
      yInput.value.select();
    } else if (el === dInput.value && d.value === '' && mInput.value) {
      e.preventDefault();
      mInput.value.focus();
      mInput.value.select();
    }
  }
}

// 当前年/月对应的当月天数（考虑闰年）；年或月无效时按 31 天处理。
function currentDaysInMonth(): number {
  // 局部变量不能与 ref 同名，否则会读取到未初始化的局部变量（TDZ）。
  const yv = parseInt(y.value, 10);
  const mv = parseInt(m.value, 10);
  if (!yv || !mv || mv < 1 || mv > 12 || yv < props.minYear || yv > 2050) return 31;
  return new Date(yv, mv, 0).getDate();
}

// 日超过当月实际天数时，收回到当月最后一天。
function clampDayToMonth() {
  const max = currentDaysInMonth();
  const n = parseInt(d.value, 10) || 0;
  if (n > max) {
    d.value = String(max).padStart(2, '0');
    if (dInput.value) dInput.value.value = d.value;
  }
}

// 点击/聚焦该段时直接全选，输入即整体替换，不显示光标。
function selectAll(e: Event) {
  (e.target as HTMLInputElement).select();
}

// 未满足前置条件时，不允许聚焦/选择月、日。
function onMonthDown(e: MouseEvent) {
  if (!yearReady.value) e.preventDefault();
}

function onDayDown(e: MouseEvent) {
  if (!dayAllowed.value) e.preventDefault();
}

function onMonthFocus(e: FocusEvent) {
  if (!yearReady.value) {
    (e.target as HTMLInputElement).blur();
    return;
  }
  (e.target as HTMLInputElement).select();
}

function onDayFocus(e: FocusEvent) {
  if (!dayAllowed.value) {
    (e.target as HTMLInputElement).blur();
    return;
  }
  (e.target as HTMLInputElement).select();
}

defineExpose({
  focusFirst() {
    if (yInput.value) {
      yInput.value.focus();
      yInput.value.select();
    }
  },
  focusLast() {
    if (dayAllowed.value && dInput.value) {
      dInput.value.focus();
      dInput.value.select();
    } else if (monthReady.value && mInput.value) {
      mInput.value.focus();
      mInput.value.select();
    } else if (yInput.value) {
      yInput.value.focus();
      yInput.value.select();
    }
  },
});
</script>

<template>
  <span
    class="date-seg"
    :class="{ 'date-seg-invalid': invalid || segInvalid }"
  >
    <input
      ref="yInput"
      class="date-seg-part year"
      :value="y"
      type="text"
      inputmode="numeric"
      maxlength="4"
      placeholder="0000"
      @input="onYear"
      @keydown="onKey"
      @focus="selectAll"
    />
    <span class="date-seg-sep">-</span>
    <input
      ref="mInput"
      class="date-seg-part month"
      :value="m"
      type="text"
      inputmode="numeric"
      maxlength="2"
      placeholder="00"
      @input="onMonth"
      @keydown="onKey"
      @focus="onMonthFocus"
      @mousedown="onMonthDown"
      @blur="onMonthBlur"
    />
    <span class="date-seg-sep">-</span>
    <input
      ref="dInput"
      class="date-seg-part day"
      :value="d"
      type="text"
      inputmode="numeric"
      maxlength="2"
      placeholder="00"
      @input="onDay"
      @keydown="onKey"
      @focus="onDayFocus"
      @mousedown="onDayDown"
      @blur="onDayBlur"
    />
  </span>
</template>
