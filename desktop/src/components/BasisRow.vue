<script setup lang="ts">
import { ref } from 'vue';
import type { SourceLink } from '../../../core/types';
import DateSegInput from './DateSegInput.vue';

const props = defineProps<{ link: SourceLink }>();

// 发布时间 → 有效期开始 → 有效期结束 之间可用左右箭头跨越。
const pubInput = ref<InstanceType<typeof DateSegInput> | null>(null);
const startInput = ref<InstanceType<typeof DateSegInput> | null>(null);
const endInput = ref<InstanceType<typeof DateSegInput> | null>(null);

function pubAdvance() {
  startInput.value?.focusFirst();
}
function startAdvance() {
  endInput.value?.focusFirst();
}
function startRetreat() {
  pubInput.value?.focusLast();
}
function endRetreat() {
  startInput.value?.focusLast();
}

function openLink(url: string) {
  const u = (url || '').trim();
  if (!u) return;
  if (window.api) {
    window.api.openExternal(u);
  } else {
    window.open(u, '_blank');
  }
}

// ---- 与 BasisLinks 相同的日期校验/状态逻辑 ----
const MAX_YEAR = 2050;

function isLeapYear(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

function parseDateStr(s: string): { ok: boolean; num: number } {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s.trim());
  if (!m) return { ok: false, num: 0 };
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (y > MAX_YEAR || mo < 1 || mo > 12) return { ok: false, num: 0 };
  const dim = [31, isLeapYear(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (d < 1 || d > dim[mo - 1]) return { ok: false, num: 0 };
  return { ok: true, num: y * 10000 + mo * 100 + d };
}

function dateInvalid(s: string | undefined): boolean {
  if (!s || !s.trim()) return false;
  return !parseDateStr(s).ok;
}

function rangeInvalid(start: string | undefined, end: string | undefined): boolean {
  if (!start || !start.trim() || !end || !end.trim()) return false;
  const a = parseDateStr(start);
  const b = parseDateStr(end);
  if (!a.ok || !b.ok) return false;
  return a.num > b.num;
}

function validityStatus(start: string | undefined, end: string | undefined): string {
  if (!start || !start.trim() || !end || !end.trim()) return '';
  const a = parseDateStr(start);
  const b = parseDateStr(end);
  if (!a.ok || !b.ok || a.num > b.num) return '';
  const now = new Date();
  const today = now.getFullYear() * 10000 + (now.getMonth() + 1) * 100 + now.getDate();
  if (today >= a.num && today <= b.num) return 'valid';
  return 'expired';
}

function validityLabel(start: string | undefined, end: string | undefined): string {
  const st = validityStatus(start, end);
  return st === 'valid' ? '有效' : st === 'expired' ? '失效' : '';
}
</script>

<template>
  <div class="basis-row">
    <input v-model="link.name" class="basis-name-input" type="text" placeholder="依据名称" />
    <input v-model="link.url" class="basis-url-input" type="text" placeholder="https://..." />
    <DateSegInput
      ref="pubInput"
      v-model="link.publishDate"
      :invalid="dateInvalid(link.publishDate)"
      @advance="pubAdvance"
    />
    <span class="basis-validity-range">
      <DateSegInput
        ref="startInput"
        v-model="link.validityStart"
        :invalid="
          dateInvalid(link.validityStart) ||
          rangeInvalid(link.validityStart, link.validityEnd)
        "
        @advance="startAdvance"
        @retreat="startRetreat"
      />
      <span
        class="basis-validity-status"
        :class="
          validityStatus(link.validityStart, link.validityEnd) === 'valid'
            ? 'status-valid'
            : 'status-expired'
        "
      >
        {{ validityLabel(link.validityStart, link.validityEnd) }}
      </span>
      <DateSegInput
        ref="endInput"
        v-model="link.validityEnd"
        :invalid="
          dateInvalid(link.validityEnd) ||
          rangeInvalid(link.validityStart, link.validityEnd)
        "
        @retreat="endRetreat"
      />
    </span>
    <button type="button" class="basis-visit" title="在浏览器中打开该依据" @click="openLink(link.url)">
      访问
    </button>
  </div>
</template>
