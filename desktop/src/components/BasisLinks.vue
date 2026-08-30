<script setup lang="ts">
import { ref } from 'vue';
import type { SourceLink } from '../../../core/types';
import DateSegInput from './DateSegInput.vue';

// 同一行里的三个日期字段串接：年/月/日 ←/→ 可跨字段移动。
const pubInputs = ref<InstanceType<typeof DateSegInput>[]>([]);
const startInputs = ref<InstanceType<typeof DateSegInput>[]>([]);
const endInputs = ref<InstanceType<typeof DateSegInput>[]>([]);

function pubAdvance(i: number) {
  startInputs.value[i]?.focusFirst();
}
function startAdvance(i: number) {
  endInputs.value[i]?.focusFirst();
}
function startRetreat(i: number) {
  pubInputs.value[i]?.focusLast();
}
function endRetreat(i: number) {
  startInputs.value[i]?.focusLast();
}

const props = withDefaults(
  defineProps<{
    links: SourceLink[];
    fallback?: string;
    editable?: boolean;
    /** 是否显示“+ 添加依据”按钮（默认显示） */
    addable?: boolean;
    /** 日期输入允许的最早年份 */
    minYear?: number;
  }>(),
  {
    fallback: '',
    editable: false,
    addable: true,
    minYear: 2022,
  },
);

function openLink(url: string) {
  if (window.api) {
    window.api.openExternal(url);
  } else {
    window.open(url, '_blank');
  }
}

function addLink() {
  props.links.push({ name: '新依据', url: '', publishDate: '' });
}

function removeLink(index: number) {
  props.links.splice(index, 1);
}

// ---- 日期纯文本校验：YYYY-MM-DD，年份 ≤ 2050，月/日两位，按日历校验 ----
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

// 非空且不合法 → 标红；留空允许
function dateInvalid(s: string | undefined): boolean {
  if (!s || !s.trim()) return false;
  return !parseDateStr(s).ok;
}

// 起止都有值时要求 开始 ≤ 结束
function rangeInvalid(start: string | undefined, end: string | undefined): boolean {
  if (!start || !start.trim() || !end || !end.trim()) return false;
  const a = parseDateStr(start);
  const b = parseDateStr(end);
  if (!a.ok || !b.ok) return false; // 单个字段已标红
  return a.num > b.num;
}

// 有效期状态：valid / expired / ''（信息不全）
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
  <div class="basis">
    <template v-if="editable">
      <div v-if="links.length" class="basis-grid">
        <span></span>
        <span></span>
        <span class="basis-publish-header">发布时间</span>
        <span class="basis-publish-header">有效期</span>
        <span></span>
        <span></span>
        <template v-for="(s, i) in links" :key="i">
          <input v-model="s.name" class="basis-name-input" type="text" placeholder="依据名称" />
          <input v-model="s.url" class="basis-url-input" type="text" placeholder="https://..." />
          <DateSegInput
            v-model="s.publishDate"
            :invalid="dateInvalid(s.publishDate)"
            :min-year="minYear"
            ref="pubInputs"
            @advance="pubAdvance(i)"
          />
          <span class="basis-validity-range">
            <DateSegInput
              v-model="s.validityStart"
              ref="startInputs"
              :min-year="minYear"
              :invalid="
                dateInvalid(s.validityStart) ||
                rangeInvalid(s.validityStart, s.validityEnd)
              "
              @advance="startAdvance(i)"
              @retreat="startRetreat(i)"
            />
            <span
              class="basis-validity-status"
              :class="
                validityStatus(s.validityStart, s.validityEnd) === 'valid'
                  ? 'status-valid'
                  : 'status-expired'
              "
            >
              {{ validityLabel(s.validityStart, s.validityEnd) }}
            </span>
            <DateSegInput
              v-model="s.validityEnd"
              ref="endInputs"
              :min-year="minYear"
              :invalid="
                dateInvalid(s.validityEnd) ||
                rangeInvalid(s.validityStart, s.validityEnd)
              "
              @retreat="endRetreat(i)"
            />
          </span>
          <button type="button" class="basis-visit" title="在浏览器中打开该依据" @click="openLink(s.url)">
            访问
          </button>
          <button type="button" class="basis-del" title="删除该依据" @click="removeLink(i)">
            删除
          </button>
        </template>
      </div>
      <button
        v-if="addable"
        type="button"
        class="basis-add"
        @click="addLink"
      >
        + 添加依据
      </button>
    </template>
    <template v-else>
      <a
        v-for="s in links"
        :key="s.url"
        href="#"
        title="点击打开政策网页"
        @click.prevent="openLink(s.url)"
      >
        {{ s.name }} ↗
      </a>
      <span v-if="!links.length" class="note">{{ fallback || '无固定政策依据（自行设定）' }}</span>
    </template>
  </div>
</template>
