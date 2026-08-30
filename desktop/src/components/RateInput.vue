<script setup lang="ts">
/** 比例输入：默认是数字输入框；传 options 时改为下拉菜单（值为整数百分比） */
const props = withDefaults(
  defineProps<{
    modelValue: number;
    /** 允许输入的最小百分比（如 5 表示 5%），不传则不限制 */
    min?: number;
    /** 允许输入的最大百分比（如 24 表示 24%），不传则不限制 */
    max?: number;
    /** 只允许整数（如公积金比例），默认允许小数 */
    integer?: boolean;
    /** 允许 0：0 不受最小值限制（用于"可为 0 或 ≥5"的场景） */
    zeroAllowed?: boolean;
    /** 下拉菜单选项（整数百分比，如 [0, 5, 6, ...]），传了就用下拉菜单 */
    options?: number[];
  }>(),
  {
    min: undefined,
    max: undefined,
    integer: false,
    zeroAllowed: false,
    options: undefined,
  },
);
const emit = defineEmits<{ (e: 'update:modelValue', value: number): void }>();

function onInput(event: Event) {
  const el = event.target as HTMLInputElement;
  const raw = el.value;
  // text 输入框：只保留数字和一个小数点
  let clean = raw.replace(/[^\d.]/g, '');
  const dot = clean.indexOf('.');
  if (dot !== -1) {
    clean = clean.slice(0, dot + 1) + clean.slice(dot + 1).replace(/\./g, '');
  }
  if (clean !== raw) el.value = clean;
  // 输入过程中的中间态（空、"."、"14."）不处理，等后续输入
  if (clean === '' || clean === '.' || /^\d+\.$/.test(clean)) return;
  let value = parseFloat(clean);
  if (!Number.isFinite(value)) value = 0;
  if (props.integer) value = Math.round(value);
  if (props.min !== undefined) {
    if (props.zeroAllowed) {
      // 0 或 ≥min；0~min 之间按 min 处理
      if (value > 0 && value < props.min) value = props.min;
    } else if (value < props.min) {
      value = props.min;
    }
  }
  if (props.max !== undefined && value > props.max) value = props.max;
  el.value = String(value);
  emit('update:modelValue', value / 100);
}

// 失焦时把遗留的尾随小数点/空值规范化（如 "0." → "0"）
function onBlur(event: Event) {
  const el = event.target as HTMLInputElement;
  const raw = el.value;
  if (raw === '' || raw === '.' || /^\d+\.$/.test(raw)) {
    const v = raw === '' || raw === '.' ? 0 : parseFloat(raw);
    el.value = String(v);
    emit('update:modelValue', v / 100);
  }
}

// 拦截科学计数/符号键；整数模式额外拦截小数点
function onKeydown(event: KeyboardEvent) {
  if (['-', '+', 'e', 'E'].includes(event.key)) {
    event.preventDefault();
  }
  if (props.integer && event.key === '.') {
    event.preventDefault();
  }
}

function onSelect(event: Event) {
  const value = parseInt((event.target as HTMLSelectElement).value, 10);
  emit('update:modelValue', (Number.isFinite(value) ? value : 0) / 100);
}
</script>

<template>
  <span class="rate-input">
    <select
      v-if="options !== undefined"
      :value="Number((modelValue * 100).toFixed(0))"
      @change="onSelect"
    >
      <option v-for="opt in options" :key="opt" :value="opt">{{ opt }}%</option>
    </select>
    <template v-else>
      <input
        type="text"
        :inputmode="integer ? 'numeric' : 'decimal'"
        :pattern="integer ? '[0-9]*' : '[0-9]*[.]?[0-9]*'"
        :step="integer ? 1 : 0.01"
        :min="min ?? 0"
        :max="max"
        :value="Number((modelValue * 100).toFixed(integer ? 0 : 2))"
        @input="onInput"
        @blur="onBlur"
        @keydown="onKeydown"
      />
      <span class="rate-suffix">%</span>
    </template>
  </span>
</template>
