<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type { Contact, ContactRating, PendingLayoff } from '../../../core/business';
import {
  calculateSeverance,
  localToday,
  splitYearsMonths,
  yearsBetween,
  yearsToN,
} from '../../../core/severance';
import type { SeveranceDefaults } from './SeverancePanel.vue';
import DateSegments from './DateSegments.vue';
import SegSelect from './SegSelect.vue';
import {
  beginDragLock,
  clampToRect,
  endDragLock,
  moveFakeCursor,
  moveRowToPoint,
} from '../dragLock';

const props = defineProps<{
  contacts: Contact[];
  pendingLayoffs: PendingLayoff[];
  companyId: string;
  defaults: SeveranceDefaults;
  tipLinks: { n: string; nPlus1: string; twoN: string };
  avgSources: { allUnit: number; nonPrivate: number; onPost: number };
  avgWage: number;
  avgManual: boolean;
}>();
const emit = defineEmits<{
  (e: 'update:avgWage', v: number): void;
  (e: 'reset:avgWage'): void;
}>();

const RATINGS: { key: ContactRating; label: string }[] = [
  { key: 'excellent', label: '极好' },
  { key: 'good', label: '良好' },
  { key: 'medium', label: '中等' },
  { key: 'poor', label: '较差' },
  { key: 'danger', label: '极差' },
];

const CASE1_TEXT =
  '患病、非因工负伤，医疗期满后不能从事原工作，也不能从事另行安排的工作；培训、调岗仍不能胜任工作；合同的客观情况发生重大变化致使无法履行，协商未能达成协议；单位被依法宣告破产、吊销营业执照、责令关闭、撤销或提前解散终止合同；固定期限合同期满，提高/保持待遇员工不愿续签之外的情况。';
const CASE2_TEXT = '合同期内没有违反制度，理由不充分，强制解除。';
const CASE3_TEXT =
  '4选1：①破产重整（法院裁定进入程序）；②经营严重困难（资不抵债/连续亏损、发不出工资，有财务证据）；③转产/技术革新/经营调整（先调岗仍需裁人）；④客观经济情况重大变化。人数要求：20人以上或总体10%以上。\n程序：提前30天向工会/全体职工说明+资料；出裁员方案；征求工会意见修改；向人社局报告（备案）；公布方案办离职给N。';

const contactId = ref('');
const entryDate = ref('');
const monthlyWage = ref(props.defaults.monthlyWage);
const bonus = ref(0);
const bonusManual = ref(false);
const ratingNew = ref<ContactRating | ''>('');
const remarkNew = ref('');
// 工作时长（年+月）：与赔偿计算器一致
const yearsNum = ref(0);
const monthsSel = ref(0);
const monthWorkOptions = Array.from({ length: 13 }, (_, i) => String(i));
// 计入时长：按 N 规则折算后的月数（如 1 年 1 个月 → 1.5 个月）
const months = ref(0);
const monthsManual = ref(false);
const wageManual = ref(false);
const deleteConfirmId = ref<string | null>(null);
const duplicateConfirmId = ref<string | null>(null);
const sortKey = ref<
  'name' | 'entryDate' | 'years' | 'monthlyWage' | 'rating' | null
>(null);
const sortAsc = ref(true);
const draggingId = ref<string | null>(null);
const tbodyRef = ref<HTMLElement | null>(null);
const listCardRef = ref<HTMLElement | null>(null);
const pendingMenu = ref<{ x: number; y: number; visible: boolean }>({
  x: 0,
  y: 0,
  visible: false,
});

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
  emit('update:avgWage', Math.min(Number(clean) || 0, 99999));
}

const effectiveAvgMonthly = computed(
  () => Number(props.avgWage) || 0,
);

let pendingDraft: PendingLayoff | null = null;
let pressTimer: ReturnType<typeof setTimeout> | null = null;
let pressed = false;

const companyContacts = computed(() => {
  // 已在待辞退列表中的员工不再显示在下拉菜单
  const addedIds = new Set(
    props.pendingLayoffs
      .filter((p) => p.companyId === props.companyId)
      .map((p) => p.contactId),
  );
  return props.contacts.filter(
    (c) => c.companyId === props.companyId && !addedIds.has(c.id),
  );
});

watch(contactId, (id) => {
  const c = props.contacts.find((x) => x.id === id);
  if (!c) return;
  // 自动带入通讯录中的月工资
  if (c.salary && c.salary > 0) {
    monthlyWage.value = c.salary;
    wageManual.value = false;
  }
  // 自动带入通讯录中的奖金
  bonus.value = c.bonus && c.bonus > 0 ? c.bonus : 0;
  bonusManual.value = false;
  if (c.entryDate) {
    // 入职时间自动带入通讯录日期，链式折算工作时长与计入时长
    entryDate.value = c.entryDate;
    monthsManual.value = false;
  }
});

// 入职时间 -> 工作时长（年 + 月）
watch(entryDate, (v) => {
  if (!v) return;
  const dec = yearsBetween(v, localToday());
  const split = splitYearsMonths(dec);
  yearsNum.value = split.years;
  monthsSel.value = split.months;
  // 入职当天折算为 0 年 0 月时也同步计入时长（最低 0.5 个月）
  months.value = Math.max(0.5, yearsToN(dec));
  monthsManual.value = false;
});

// 工作时长变化时自动折算计入时长（最低 0.5 个月）
watch([yearsNum, monthsSel], () => {
  months.value = Math.max(
    0.5,
    yearsToN(
      (Number(yearsNum.value) || 0) + (Number(monthsSel.value) || 0) / 12,
    ),
  );
  monthsManual.value = false;
});

/** 计算基数（平均月工资）= 月工资 + 奖金 ÷ 12（奖金按年分摊到月） */
const wageBase = computed(
  () =>
    (Number(monthlyWage.value) || 0) +
    (Number(bonus.value) || 0) / 12,
);

/** 3 倍封顶条件（与赔偿计算器一致） */
const capCondition = computed(
  () =>
    props.defaults.useCap &&
    effectiveAvgMonthly.value > 0 &&
    wageBase.value > effectiveAvgMonthly.value * 3,
);

/** 计入时长生效值：手动值或折算值；触发封顶时上限 12 */
const effectiveTenure = computed(() =>
  capCondition.value ? Math.min(months.value, 12) : months.value,
);

/** 当前表单的 N / N+1 / 2N 预览 */
const previewResult = computed(() =>
  calculateSeverance({
    monthlyWage: wageBase.value,
    years: effectiveTenure.value,
    preConverted: true,
    avgMonthlyWage: effectiveAvgMonthly.value,
    useCap: props.defaults.useCap,
  }),
);

function onMonthsInput(event: Event) {
  monthsManual.value = true;
  // 最多 6 个字符（如 1000.5），只保留数字与一个小数点，最低 0.5
  const el = event.target as HTMLInputElement;
  const raw = el.value.slice(0, 6).replace(/[^\d.]/g, '');
  const firstDot = raw.indexOf('.');
  const fixed =
    firstDot === -1
      ? raw
      : raw.slice(0, firstDot + 1) + raw.slice(firstDot + 1).replace(/\./g, '');
  months.value = Math.max(0.5, Number(fixed || 0.5));
}

/** 奖金：空值按 0 处理 */
function onBonusInput(event: Event) {
  bonusManual.value = true;
  const el = event.target as HTMLInputElement;
  bonus.value = el.value === '' ? 0 : Number(el.value);
}

/** 工作时长（年）：最多 2 位数字（0~99），只接受数字 */
function onYearsInput(event: Event) {
  const el = event.target as HTMLInputElement;
  const digits = el.value.replace(/\D/g, '').slice(0, 2);
  yearsNum.value = Number(digits || 0);
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

function onWageInput() {
  wageManual.value = true;
}

function buildEntry(): PendingLayoff {
  return {
    id: crypto.randomUUID(),
    contactId: contactId.value,
    companyId: props.companyId,
    monthlyWage: Number(monthlyWage.value) || 0,
    bonus: Number(bonus.value) || 0,
    years: 0,
    months: Math.max(0.5, Number(months.value) || 0),
    manualYears: false,
    manualMonths: monthsManual.value,
    manualWage: wageManual.value,
    manualBonus: bonusManual.value,
    rating: ratingNew.value || undefined,
    remark: remarkNew.value.trim() || undefined,
    nMonths: true,
  };
}

function resetManual() {
  monthsManual.value = false;
}

function add() {
  if (!contactId.value) return;
  const exists = props.pendingLayoffs.some(
    (p) => p.companyId === props.companyId && p.contactId === contactId.value,
  );
  const entry = buildEntry();
  if (exists) {
    pendingDraft = entry;
    duplicateConfirmId.value = entry.contactId;
    return;
  }
  props.pendingLayoffs.push(entry);
  resetManual();
  contactId.value = '';
  wageManual.value = false;
  bonusManual.value = false;
  ratingNew.value = '';
  remarkNew.value = '';
}

function confirmDuplicate() {
  if (pendingDraft) {
    props.pendingLayoffs.push(pendingDraft);
    pendingDraft = null;
    resetManual();
    contactId.value = '';
    wageManual.value = false;
  }
  duplicateConfirmId.value = null;
}

function askDelete(id: string) {
  deleteConfirmId.value = id;
}

function confirmDelete() {
  const id = deleteConfirmId.value;
  if (!id) return;
  const idx = props.pendingLayoffs.findIndex((p) => p.id === id);
  if (idx >= 0) props.pendingLayoffs.splice(idx, 1);
  deleteConfirmId.value = null;
}

function contactName(id: string | null): string {
  if (!id) return '';
  return props.contacts.find((c) => c.id === id)?.name ?? '';
}

/** 根据待辞退记录 id 取人员姓名（删除确认框用） */
function pendingName(pendingId: string | null): string {
  if (!pendingId) return '';
  const p = props.pendingLayoffs.find((x) => x.id === pendingId);
  if (!p) return '';
  return props.contacts.find((c) => c.id === p.contactId)?.name ?? '';
}

function ratingLabel(r?: ContactRating): string {
  return RATINGS.find((x) => x.key === r)?.label ?? '';
}

const ratingIndex = (r?: ContactRating) =>
  r ? RATINGS.findIndex((x) => x.key === r) : -1;

function sortBy(key: 'name' | 'entryDate' | 'years' | 'monthlyWage' | 'rating') {
  if (sortKey.value === key) {
    sortAsc.value = !sortAsc.value;
  } else {
    sortKey.value = key;
    sortAsc.value = true;
  }
}

function sortIndicator(
  key: 'name' | 'entryDate' | 'years' | 'monthlyWage' | 'rating',
): string {
  return sortKey.value === key ? (sortAsc.value ? ' ↑' : ' ↓') : '';
}

const PENDING_CONTEXT_SORTS: {
  key: 'name' | 'entryDate' | 'years' | 'monthlyWage' | 'rating' | null;
  label: string;
}[] = [
  { key: null, label: '自定义排序' },
  { key: 'name', label: '姓名排序' },
  { key: 'entryDate', label: '入职时间排序' },
  { key: 'years', label: '计入时长排序' },
  { key: 'monthlyWage', label: '月工资排序' },
  { key: 'rating', label: '评级排序' },
];

function openPendingMenu(event: MouseEvent) {
  const target = event.target as HTMLElement;
  if (target.closest('button')) return;
  pendingMenu.value = { x: event.clientX, y: event.clientY, visible: true };
}

function setPendingSort(
  key: 'name' | 'entryDate' | 'years' | 'monthlyWage' | 'rating' | null,
) {
  sortKey.value = key;
  sortAsc.value = true;
  pendingMenu.value.visible = false;
}

function closePendingMenu() {
  pendingMenu.value.visible = false;
}

function autosizeTextarea(el: HTMLTextAreaElement) {
  el.style.height = 'auto';
  el.style.height = el.scrollHeight + 'px';
}

const rows = computed(() => {
  let list = props.pendingLayoffs.filter((p) => p.companyId === props.companyId);
  if (sortKey.value) {
    const dir = sortAsc.value ? 1 : -1;
    list = [...list].sort((a, b) => {
      const ca = props.contacts.find((c) => c.id === a.contactId);
      const cb = props.contacts.find((c) => c.id === b.contactId);
      let r = 0;
      switch (sortKey.value) {
        case 'name':
          r = (ca?.name ?? '').localeCompare(cb?.name ?? '', 'zh-CN');
          break;
        case 'entryDate':
          r = (ca?.entryDate ?? '').localeCompare(cb?.entryDate ?? '');
          break;
        case 'years':
          r = a.months - b.months;
          break;
        case 'monthlyWage':
          r = a.monthlyWage - b.monthlyWage;
          break;
        case 'rating':
          r = ratingIndex(ca?.rating) - ratingIndex(cb?.rating);
          break;
      }
      return r * dir;
    });
  }
  return list.map((p) => {
    const contact = props.contacts.find((c) => c.id === p.contactId);
    // 手动输入的月工资固定；否则跟随通讯录中的月工资
    const wage = p.manualWage
      ? p.monthlyWage
      : contact && contact.salary && contact.salary > 0
        ? contact.salary
        : p.monthlyWage;
    const bonus = p.manualBonus
      ? Number(p.bonus) || 0
      : contact && contact.bonus && contact.bonus > 0
        ? contact.bonus
        : Number(p.bonus) || 0;
    const wageBase = wage + bonus / 12;
    const result = calculateSeverance({
      monthlyWage: wageBase,
      years: p.months,
      preConverted: true,
      avgMonthlyWage: effectiveAvgMonthly.value,
      useCap: props.defaults.useCap,
    });
    const rating = p.rating || (contact && contact.rating) || undefined;
    const remark = p.remark || (contact && contact.remark) || '';
    return { p, contact, result, wage, bonus, wageBase, rating, remark };
  });
});

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

function fmtMonths(n: number): string {
  return String(Number(n.toFixed(2)));
}

function openTip(url: string) {
  if (window.api && url) {
    window.api.openExternal(url);
  }
}

// ---- 行拖动排序（长按选中后指针锁死在框内，松开才恢复） ----
function onRowMouseDown(event: MouseEvent, id: string) {
  if (event.button !== 0) return;
  const target = event.target as HTMLElement;
  if (target.closest('input, select, button')) return;
  if (pressTimer) clearTimeout(pressTimer);
  pressed = true;
  pressTimer = setTimeout(() => {
    draggingId.value = id;
    beginDragLock(event.clientX, event.clientY);
  }, 175);
}

function onRowMouseMove(event: MouseEvent) {
  if (!pressed || !draggingId.value) return;
  const box = listCardRef.value;
  if (!box) return;
  const rect = box.getBoundingClientRect();
  const pt = clampToRect(event.clientX, event.clientY, rect);
  moveFakeCursor(pt.x, pt.y);
  moveRowToPoint(props.pendingLayoffs, draggingId.value, tbodyRef.value, pt.x, pt.y);
}

function onRowMouseUp() {
  pressed = false;
  if (pressTimer) {
    clearTimeout(pressTimer);
    pressTimer = null;
  }
  draggingId.value = null;
  endDragLock();
}

function cancelDrag() {
  draggingId.value = null;
  endDragLock();
}

onMounted(() => {
  document.addEventListener('mousemove', onRowMouseMove);
  document.addEventListener('mouseup', onRowMouseUp);
  window.addEventListener('blur', cancelDrag);
  document.addEventListener('click', closePendingMenu);
});
onBeforeUnmount(() => {
  document.removeEventListener('mousemove', onRowMouseMove);
  document.removeEventListener('mouseup', onRowMouseUp);
  window.removeEventListener('blur', cancelDrag);
  document.removeEventListener('click', closePendingMenu);
});
</script>

<template>
  <div class="pending-panel">
    <section class="card">
      <div class="pending-head">
        <h2>待辞退（从通讯录添加）</h2>
        <div class="avg-source-row">
          <span>广东省全口径城镇单位就业人员平均工资：</span>
          <input
            :value="avgWage"
            class="avg-input"
            :class="{ 'avg-manual': avgManual }"
            type="text"
            inputmode="decimal"
            @input="onAvgInput"
          />
          <span class="avg-triple">✖️3=</span>
          <span class="avg-triple-result">{{ fmtClean(avgWage * 3) }}</span>
          <button
            type="button"
            class="avg-reset-btn"
            title="重置"
            @click="emit('reset:avgWage')"
          >
            ⟳
          </button>
        </div>
      </div>
      <div class="infer-grid">
        <label class="field">
          <span>人员</span>
          <select v-model="contactId">
            <option value="" disabled>请选择人员</option>
            <option
              v-for="c in companyContacts"
              :key="c.id"
              :value="c.id"
              :class="c.rating ? 'rating-' + c.rating : ''"
            >
              {{ c.name }}
            </option>
          </select>
        </label>
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
              :class="{ 'wage-manual': wageManual }"
              type="number"
              min="0"
              step="0.01"
              @input="onWageInput"
            />
            <span class="calc-symbol">＋</span>
            <input
              :value="bonus === 0 ? '' : bonus"
              class="bonus-part-input"
              :class="{ 'bonus-manual': bonusManual }"
              type="number"
              min="0"
              step="0.01"
              @input="onBonusInput"
            />
            <span class="calc-symbol">＝</span>
            <input
              :value="fmt(wageBase)"
              class="avg-part-input"
              :class="{ 'avg-manual-red': wageManual || bonusManual }"
              type="text"
              readonly
            />
          </div>
        </div>
        <div class="field tenure-chain">
          <div class="chain-col">
            <span class="chain-col-label">入职时间</span>
            <DateSegments v-model="entryDate" :min-year="2000" />
          </div>
          <span class="chain-arrow">➡</span>
          <div class="chain-col">
            <span class="chain-col-label">工作时长</span>
            <div class="years-row">
              <input
                :value="yearsNum"
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
              :value="effectiveTenure"
              :class="{ 'tenure-manual': monthsManual }"
              class="tenure-input"
              type="number"
              min="0.5"
              step="0.5"
              @input="onMonthsInput"
            />
          </div>
        </div>
        <label class="field pending-rating-field">
          <span>评级</span>
          <select
            v-model="ratingNew"
            class="pending-rating-select"
            :class="'rating-' + (ratingNew || '')"
          >
            <option value="">未评级</option>
            <option v-for="r in RATINGS" :key="r.key" :value="r.key">
              {{ r.label }}
            </option>
          </select>
        </label>
        <div class="field add-btn-field">
          <span>&nbsp;</span>
          <div class="add-btn-right">
            <button class="primary" @click="add">添加</button>
          </div>
        </div>
        <label class="field pending-remark-field">
          <span>备注</span>
          <textarea
            v-model="remarkNew"
            rows="1"
            class="pending-remark-textarea"
            @input="autosizeTextarea($event.target)"
          ></textarea>
        </label>
      </div>
      <p class="note">
        选择人员后自动按入职时间折算工作时长与计入时长；不满 6 个月算 0.5 个月、6 个月以上不满 1 年算 1 个月、每满 1 年算 1 个月。
      </p>
      <div class="pending-preview">
        <div class="preview-card">
          <span>N</span>
          <b>{{ fmt(previewResult.n) }} 元</b>
        </div>
        <div class="preview-card">
          <span>N+1</span>
          <b>{{ fmt(previewResult.nPlus1) }} 元</b>
        </div>
        <div class="preview-card">
          <span>2N</span>
          <b>{{ fmt(previewResult.twoN) }} 元</b>
        </div>
      </div>
    </section>

    <section
      ref="listCardRef"
      class="card pending-list-card"
      @contextmenu.prevent="openPendingMenu"
    >
      <h2>待辞退列表</h2>
      <table>
        <thead>
          <tr>
            <th></th>
            <th class="sortable" @click="sortBy('name')">姓名{{ sortIndicator('name') }}</th>
            <th class="sortable" @click="sortBy('entryDate')">
              入职时间{{ sortIndicator('entryDate') }}
            </th>
            <th class="sortable" @click="sortBy('years')">
              计入时长{{ sortIndicator('years') }}
            </th>
            <th class="sortable" @click="sortBy('monthlyWage')">
              月工资{{ sortIndicator('monthlyWage') }}
            </th>
            <th>奖金</th>
            <th>平均月工资</th>
            <th>
              N
              <span class="tip-wrap">
                <span class="tip" @click="openTip(tipLinks.n)">ⓘ</span>
                <span class="tip-tip">{{ CASE3_TEXT }}</span>
              </span>
            </th>
            <th>
              N+1
              <span class="tip-wrap">
                <span class="tip" @click="openTip(tipLinks.nPlus1)">ⓘ</span>
                <span class="tip-tip">{{ CASE1_TEXT }}</span>
              </span>
            </th>
            <th>
              2N
              <span class="tip-wrap">
                <span class="tip" @click="openTip(tipLinks.twoN)">ⓘ</span>
                <span class="tip-tip">{{ CASE2_TEXT }}</span>
              </span>
            </th>
            <th class="sortable" @click="sortBy('rating')">评级{{ sortIndicator('rating') }}</th>
            <th>备注</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody ref="tbodyRef">
          <tr
            v-for="{ p, contact, result, wage, bonus, wageBase, rating, remark } in rows"
            :key="p.id"
            :data-id="p.id"
            :class="{ 'is-dragging': draggingId === p.id }"
            @mousedown="onRowMouseDown($event, p.id)"
          >
            <td><span class="pending-drag" title="拖动排序" @click.stop>⠿</span></td>
            <td>{{ contact ? contact.name : '（已删除）' }}</td>
            <td>{{ contact ? contact.entryDate : '' }}</td>
            <td>
              <span :class="{ 'red-text': p.manualMonths }">{{ fmtMonths(result.nYears) }}</span>
              个月
            </td>
            <td :class="{ 'red-text': p.manualWage }">{{ fmt(wage) }}</td>
            <td>{{ fmt(bonus) }}</td>
            <td>{{ fmt(wageBase) }}</td>
            <td>{{ fmt(result.n) }}</td>
            <td>{{ fmt(result.nPlus1) }}</td>
            <td>{{ fmt(result.twoN) }}</td>
            <td>
              <span v-if="rating" :class="'rating-' + rating">
                {{ ratingLabel(rating) }}
              </span>
              <span v-else class="note">未评级</span>
            </td>
            <td>{{ remark }}</td>
            <td><button class="danger" @click="askDelete(p.id)">删除</button></td>
          </tr>
          <tr v-if="!rows.length">
            <td colspan="13" class="note">暂无待辞退人员。</td>
          </tr>
        </tbody>
      </table>
    </section>

    <div v-if="duplicateConfirmId" class="confirm-mask">
      <div class="confirm-card">
        <p>「{{ contactName(duplicateConfirmId) }}」已在待辞退列表中，确定再次添加？</p>
        <div class="actions">
          <button @click="duplicateConfirmId = null; pendingDraft = null">取消</button>
          <button class="primary" @click="confirmDuplicate">确定</button>
        </div>
      </div>
    </div>

    <div v-if="deleteConfirmId" class="confirm-mask">
      <div class="confirm-card">
        <p class="confirm-danger-text">
          是否在待辞退列表中移除员工「{{ pendingName(deleteConfirmId) }}」？
        </p>
        <div class="actions">
          <button @click="deleteConfirmId = null">取消</button>
          <button class="danger" @click="confirmDelete">确认</button>
        </div>
      </div>
    </div>

    <div
      v-if="pendingMenu.visible"
      class="context-menu"
      :style="{ left: pendingMenu.x + 'px', top: pendingMenu.y + 'px' }"
      @click.stop
    >
      <button
        v-for="s in PENDING_CONTEXT_SORTS"
        :key="s.label"
        type="button"
        :class="{ active: sortKey === s.key }"
        @click="setPendingSort(s.key)"
      >
        {{ s.label }}
      </button>
    </div>
  </div>
</template>
