<script setup lang="ts">
import { ref, watch } from 'vue';
import SegSelect from './SegSelect.vue';

/**
 * 入职时间下拉模式：年（minYear~2050）/ 月（01~12）/ 日（01~31）三个下拉菜单。
 * 只允许 1949-10-01 ~ 2050-12-31。
 */
const props = withDefaults(
  defineProps<{
    modelValue: string;
    /** 年份下拉从哪一年开始显示 */
    minYear?: number;
  }>(),
  { minYear: 1949 },
);
const emit = defineEmits<{
  (e: 'update:modelValue', v: string): void;
  (e: 'invalid'): void;
}>();

const year = ref('');
const month = ref('');
const day = ref('');

const yearOptions = Array.from(
  { length: 2050 - props.minYear + 1 },
  (_, i) => String(props.minYear + i),
);
const monthOptions = Array.from(
  { length: 12 },
  (_, i) => String(i + 1).padStart(2, '0'),
);
const dayOptions = Array.from(
  { length: 31 },
  (_, i) => String(i + 1).padStart(2, '0'),
);

watch(
  () => props.modelValue,
  (v) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v || '');
    if (m) {
      year.value = m[1];
      month.value = m[2];
      day.value = m[3];
    }
  },
  { immediate: true },
);

// 三段任一变（含手动选择）后重新组合校验
watch([year, month, day], () => push());

function isValidDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  if (s < '1949-10-01' || s > '2050-12-31') return false;
  const [yy, mm, dd] = s.split('-').map(Number);
  const dt = new Date(yy, mm - 1, dd);
  return dt.getFullYear() === yy && dt.getMonth() === mm - 1 && dt.getDate() === dd;
}

function push() {
  const s = `${year.value.padStart(4, '0')}-${month.value.padStart(2, '0')}-${day.value.padStart(2, '0')}`;
  if (isValidDate(s)) {
    emit('update:modelValue', s);
    return;
  }
  emit('update:modelValue', '');
  // 三段都填满但组合无效（如 1922-01-01）：立即清空并提示，不允许"写入"
  const complete =
    year.value.length === 4 && month.value.length === 2 && day.value.length === 2;
  if (complete) {
    year.value = '';
    month.value = '';
    day.value = '';
    emit('invalid');
  }
}
</script>

<template>
  <div class="date-segments">
    <SegSelect
      v-model="year"
      class="seg-year"
      :options="yearOptions"
      :columns="3"
      scroll-to="2020"
    />
    <span class="seg-dot">-</span>
    <SegSelect
      v-model="month"
      class="seg-month"
      :options="monthOptions"
      :columns="2"
    />
    <span class="seg-dot">-</span>
    <SegSelect
      v-model="day"
      class="seg-day"
      :options="dayOptions"
      :columns="3"
    />
  </div>
</template>
