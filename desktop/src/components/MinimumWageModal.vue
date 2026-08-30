<script setup lang="ts">
import { computed, ref, toRaw } from 'vue';
import type { MinimumWageGroup } from '../../../core/types';
import DateSegInput from './DateSegInput.vue';

const props = defineProps<{ groups: MinimumWageGroup[] }>();
const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'save', groups: MinimumWageGroup[]): void;
}>();

// 同一行三个日期字段串接：年/月/日 ←/→ 可跨字段移动。
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

// 编辑副本：点“确定”才通过 save 事件写回，取消/✕ 直接丢弃
const localGroups = ref<MinimumWageGroup[]>(
  structuredClone(toRaw(props.groups)),
);

// 按有效期从晚到早自动排列（无有效期的排在后面）
const sortedGroups = computed(() =>
  [...localGroups.value].sort((a, b) =>
    (b.validityEnd || '').localeCompare(a.validityEnd || ''),
  ),
);

function addGroup() {
  localGroups.value.push({
    name: '新政策',
    url: '',
    publishDate: '',
    validityStart: '',
    validityEnd: '',
    minimumWage: 0,
    minimumPartTimeWage: 0,
  });
}

function removeGroup(g: MinimumWageGroup) {
  const i = localGroups.value.indexOf(g);
  if (i >= 0) localGroups.value.splice(i, 1);
}

// 删除前弹窗二次确认
const deleteConfirmGroup = ref<MinimumWageGroup | null>(null);

function askDelete(g: MinimumWageGroup) {
  deleteConfirmGroup.value = g;
}

function confirmDelete() {
  const g = deleteConfirmGroup.value;
  if (g) removeGroup(g);
  deleteConfirmGroup.value = null;
}

function confirmSave() {
  emit('save', JSON.parse(JSON.stringify(localGroups.value)));
}

function openUrl(url: string) {
  const u = (url || '').trim();
  if (!u) return;
  if (window.api) {
    window.api.openExternal(u);
  } else {
    window.open(u, '_blank');
  }
}

// 名称：单击弹出编辑窗口，双击访问网址
const editGroup = ref<MinimumWageGroup | null>(null);

// ---- 日期校验/状态（与 BasisLinks 一致） ----
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
  <div class="modal-mask">
    <div class="modal-card minwage-modal">
      <div class="modal-head">
        <h2>最低工资政策</h2>
        <button type="button" class="modal-close" @click="emit('close')">✕</button>
      </div>
      <div class="minwage-grid">
        <span class="minwage-head">名称</span>
        <span class="minwage-head">发布时间</span>
        <span class="minwage-head">有效期</span>
        <span class="minwage-head">最低工资（元/月）</span>
        <span class="minwage-head">最低兼职（元/h）</span>
        <span class="minwage-head">操作</span>
        <template v-for="(g, i) in sortedGroups" :key="g">
          <span
            class="minwage-name"
            :title="g.url || '单击编辑，双击访问'"
            @click="editGroup = g"
            @dblclick="openUrl(g.url)"
          >
            {{ g.name || '未命名' }}
          </span>
          <DateSegInput
            v-model="g.publishDate"
            :invalid="dateInvalid(g.publishDate)"
            :min-year="2011"
            ref="pubInputs"
            @advance="pubAdvance(i)"
          />
          <span class="basis-validity-range">
            <DateSegInput
              v-model="g.validityStart"
              :min-year="2011"
              ref="startInputs"
              :invalid="
                dateInvalid(g.validityStart) ||
                rangeInvalid(g.validityStart, g.validityEnd)
              "
              @advance="startAdvance(i)"
              @retreat="startRetreat(i)"
            />
            <span
              class="basis-validity-status"
              :class="
                validityStatus(g.validityStart, g.validityEnd) === 'valid'
                  ? 'status-valid'
                  : 'status-expired'
              "
            >
              {{ validityLabel(g.validityStart, g.validityEnd) }}
            </span>
            <DateSegInput
              v-model="g.validityEnd"
              :min-year="2011"
              ref="endInputs"
              :invalid="
                dateInvalid(g.validityEnd) ||
                rangeInvalid(g.validityStart, g.validityEnd)
              "
              @retreat="endRetreat(i)"
            />
          </span>
          <input v-model.number="g.minimumWage" type="number" min="0" />
          <input v-model.number="g.minimumPartTimeWage" type="number" min="0" />
          <span class="minwage-ops">
            <button type="button" class="basis-visit" title="访问网址" @click="openUrl(g.url)">访问</button>
            <button type="button" class="basis-del" title="删除该组" @click="askDelete(g)">删除</button>
          </span>
        </template>
      </div>
      <div class="block-actions">
        <button type="button" class="basis-add" @click="addGroup">+ 添加政策</button>
        <span style="flex: 1"></span>
        <button type="button" @click="emit('close')">取消</button>
        <button type="button" class="primary" @click="confirmSave">
          确定
        </button>
      </div>
    </div>
  </div>
  <div v-if="deleteConfirmGroup" class="confirm-mask">
    <div class="confirm-card">
      <p class="confirm-danger-text">
        确认删除政策「{{ deleteConfirmGroup.name || '未命名' }}」？
      </p>
      <p class="note">删除后不可恢复，需重新添加。</p>
      <div class="actions">
        <button @click="deleteConfirmGroup = null">取消</button>
        <button class="danger" @click="confirmDelete">确认</button>
      </div>
    </div>
  </div>
  <div v-if="editGroup" class="modal-mask">
    <div class="modal-card minwage-edit-card">
      <div class="modal-head">
        <h2>编辑政策</h2>
        <button type="button" class="modal-close" @click="editGroup = null">✕</button>
      </div>
      <label class="field">
        <span>名称</span>
        <input v-model="editGroup.name" type="text" placeholder="政策名称" />
      </label>
      <label class="field">
        <span>网址</span>
        <input v-model="editGroup.url" type="text" placeholder="https://..." />
      </label>
      <div class="block-actions">
        <span style="flex: 1"></span>
        <button type="button" @click="editGroup = null">取消</button>
        <button type="button" class="primary" @click="editGroup = null">确定</button>
      </div>
    </div>
  </div>
</template>
