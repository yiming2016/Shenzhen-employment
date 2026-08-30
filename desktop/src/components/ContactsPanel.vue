<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type { Contact, ContactRating, PendingLayoff } from '../../../core/business';
import {
  calculateSeverance,
  localToday,
  splitYearsMonths,
  yearsBetween,
  yearsToN,
} from '../../../core/severance';
import DateSegments from './DateSegments.vue';
import type { SeveranceDefaults } from './SeverancePanel.vue';
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
  deletedContacts: Contact[];
  deletedPendingLayoffs: PendingLayoff[];
  companyId: string;
  defaults: SeveranceDefaults;
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

const name = ref('');
const entryDate = ref(today());
const salary = ref<number | null>(null);
const bonus = ref<number | null>(null);
const remark = ref('');
const rating = ref<ContactRating | ''>('');
const deleteConfirmId = ref<string | null>(null);
const showNameToast = ref(false);
const showDateToast = ref(false);
const showRecycleBin = ref(false);
const purgeConfirmId = ref<string | null>(null);
let dateToastTimer: ReturnType<typeof setTimeout> | null = null;

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

/** 添加表单：月工资 + 奖金 ÷ 12 */
const salaryBonusTotal = computed(
  () => (Number(salary.value) || 0) + (Number(bonus.value) || 0) / 12,
);

/** 添加表单：入职时间 → 工作时长/计入时长 派生展示 */
const entryDerived = computed(() => {
  if (!entryDate.value) return { years: 0, months: 0, nMonths: 0 };
  const dec = yearsBetween(entryDate.value, localToday());
  const split = splitYearsMonths(dec);
  return {
    years: split.years,
    months: split.months,
    nMonths: Math.max(0.5, yearsToN(dec)),
  };
});

/** 表格行：按入职时间折算计入时长，并计算 N/N+1/2N（含封顶） */
function rowCalc(c: Contact) {
  const months =
    c.manualTenure != null && c.manualTenure > 0
      ? c.manualTenure
      : c.entryDate
        ? Math.max(0.5, yearsToN(yearsBetween(c.entryDate, localToday())))
        : 0;
  const wage = Number(c.salary) || 0;
  const bonus = Number(c.bonus) || 0;
  const wageBase =
    c.manualAvg != null && Number(c.manualAvg) > 0
      ? Number(c.manualAvg)
      : wage + bonus / 12;
  const result =
    months > 0
      ? calculateSeverance({
          monthlyWage: wageBase,
          years: months,
          preConverted: true,
          avgMonthlyWage: effectiveAvgMonthly.value,
          useCap: props.defaults.useCap,
        })
      : null;
  return { months, wageBase, result };
}

// ---- 备注：点击弹窗修改 ----
const remarkModalId = ref<string | null>(null);
const remarkDraft = ref('');

function openRemarkDialog(id: string) {
  const c = props.contacts.find((x) => x.id === id);
  if (!c) return;
  remarkDraft.value = c.remark || '';
  remarkModalId.value = id;
}

function confirmRemark() {
  const id = remarkModalId.value;
  const c = id ? props.contacts.find((x) => x.id === id) : null;
  if (c) {
    c.remark = remarkDraft.value.trim() || undefined;
  }
  remarkModalId.value = null;
}

function closeRemarkDialog() {
  remarkModalId.value = null;
}

function remarkName(id: string | null): string {
  return props.contacts.find((c) => c.id === id)?.name ?? '';
}

// ---- 板块一弹窗：姓名 / 入职时间➡工作时长➡计入时长(月) ----
const blockModal = ref<null | 'contact' | 'wage'>(null);
const blockContactId = ref<string | null>(null);
const contactNameDraft = ref('');
const contactDateDraft = ref('');
const tenureMonths = ref(0.5);
const tenureManual = ref(false);

const contactBlockDerived = computed(() => {
  if (!contactDateDraft.value) return { years: 0, months: 0, autoMonths: 0 };
  const dec = yearsBetween(contactDateDraft.value, localToday());
  const split = splitYearsMonths(dec);
  return {
    years: split.years,
    months: split.months,
    autoMonths: Math.max(0.5, yearsToN(dec)),
  };
});

function openContactBlock(id: string) {
  const c = props.contacts.find((x) => x.id === id);
  if (!c) return;
  contactNameDraft.value = c.name;
  contactDateDraft.value = c.entryDate;
  tenureManual.value = c.manualTenure != null && c.manualTenure > 0;
  tenureMonths.value = tenureManual.value
    ? c.manualTenure!
    : contactBlockDerived.value.autoMonths;
  blockContactId.value = id;
  blockModal.value = 'contact';
}

// 入职时间变化时，计入时长恢复自动折算（与平均月工资联动规则一致）
function onContactDateChange(v: string) {
  contactDateDraft.value = v;
  if (!v) return;
  tenureMonths.value = contactBlockDerived.value.autoMonths;
  tenureManual.value = false;
}

function onTenureInput(event: Event) {
  tenureManual.value = true;
  // 最多 6 个字符（如 1000.5），只保留数字与一个小数点，最低 0.5
  const el = event.target as HTMLInputElement;
  const raw = el.value.slice(0, 6).replace(/[^\d.]/g, '');
  const firstDot = raw.indexOf('.');
  const fixed =
    firstDot === -1
      ? raw
      : raw.slice(0, firstDot + 1) + raw.slice(firstDot + 1).replace(/\./g, '');
  tenureMonths.value = Math.max(0.5, Number(fixed || 0.5));
}

// ---- 板块二弹窗：月工资＋奖金÷12＝平均月工资 ----
const wageSalaryDraft = ref('');
const wageBonusDraft = ref('');
const wageAvgDraft = ref('');

const wageBlockTotal = computed(
  () => (Number(wageSalaryDraft.value) || 0) + (Number(wageBonusDraft.value) || 0) / 12,
);

function openWageBlock(id: string) {
  const c = props.contacts.find((x) => x.id === id);
  if (!c) return;
  wageSalaryDraft.value = c.salary != null ? String(c.salary) : '';
  wageBonusDraft.value = c.bonus != null ? String(c.bonus) : '';
  wageAvgDraft.value = c.manualAvg != null ? String(c.manualAvg) : '';
  blockContactId.value = id;
  blockModal.value = 'wage';
}

function onWageSalaryInput(event: Event) {
  wageSalaryDraft.value = (event.target as HTMLInputElement).value;
  // 修改月工资/奖金后，平均月工资恢复为 月工资+奖金÷12
  wageAvgDraft.value = '';
}

function onWageBonusInput(event: Event) {
  wageBonusDraft.value = (event.target as HTMLInputElement).value;
  wageAvgDraft.value = '';
}

function onWageAvgInput(event: Event) {
  wageAvgDraft.value = (event.target as HTMLInputElement).value;
}

function closeBlock() {
  blockModal.value = null;
  blockContactId.value = null;
}

function confirmBlock() {
  const id = blockContactId.value;
  if (!id) return;
  const c = props.contacts.find((x) => x.id === id);
  if (!c) return;
  if (blockModal.value === 'contact') {
    const n = contactNameDraft.value.trim();
    if (n) c.name = n;
    if (/^\d{4}-\d{2}-\d{2}$/.test(contactDateDraft.value)) {
      c.entryDate = contactDateDraft.value;
    }
    c.manualTenure = tenureManual.value ? tenureMonths.value : undefined;
  } else {
    const s = Number(wageSalaryDraft.value);
    c.salary = wageSalaryDraft.value !== '' && s > 0 ? s : undefined;
    const b = Number(wageBonusDraft.value);
    c.bonus = wageBonusDraft.value !== '' && b > 0 ? b : undefined;
    const a = Number(wageAvgDraft.value);
    c.manualAvg = wageAvgDraft.value !== '' && a > 0 ? a : undefined;
  }
  closeBlock();
}

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
const sortKey = ref<'name' | 'entryDate' | 'salary' | 'rating' | null>(null);
const sortAsc = ref(true);
const draggingId = ref<string | null>(null);
const tbodyRef = ref<HTMLElement | null>(null);
const listCardRef = ref<HTMLElement | null>(null);
const contactsMenu = ref<{ x: number; y: number; visible: boolean }>({
  x: 0,
  y: 0,
  visible: false,
});
let pressTimer: ReturnType<typeof setTimeout> | null = null;
let pressed = false;

function today(): string {
  return localToday();
}

function autosizeTextarea(el: HTMLTextAreaElement) {
  el.style.height = 'auto';
  el.style.height = el.scrollHeight + 'px';
}

const ratingIndex = (r?: ContactRating) =>
  r ? RATINGS.findIndex((x) => x.key === r) : -1;

function ratingLabel(r?: ContactRating): string {
  return RATINGS.find((x) => x.key === r)?.label ?? '';
}

const CONTEXT_SORTS: { key: 'name' | 'entryDate' | 'salary' | 'rating' | null; label: string }[] = [
  { key: null, label: '自定义排序' },
  { key: 'name', label: '姓名排序' },
  { key: 'entryDate', label: '入职时间排序' },
  { key: 'salary', label: '月工资排序' },
  { key: 'rating', label: '评级排序' },
];

const list = computed(() => {
  const arr = props.contacts.filter((c) => c.companyId === props.companyId);
  if (!sortKey.value) return arr;
  const dir = sortAsc.value ? 1 : -1;
  return [...arr].sort((a, b) => {
    let r = 0;
    switch (sortKey.value) {
      case 'name':
        r = a.name.localeCompare(b.name, 'zh-CN');
        break;
      case 'entryDate':
        r = a.entryDate.localeCompare(b.entryDate);
        break;
      case 'salary':
        r = (a.salary ?? -Infinity) - (b.salary ?? -Infinity);
        break;
      case 'rating':
        r = ratingIndex(a.rating) - ratingIndex(b.rating);
        break;
    }
    return r * dir;
  });
});

/** 人员列表行：附上按入职时间折算的计入时长与 N/N+1/2N */
const rows = computed(() => list.value.map((c) => ({ c, calc: rowCalc(c) })));

function sortBy(key: 'name' | 'entryDate' | 'salary' | 'rating') {
  if (sortKey.value === key) {
    sortAsc.value = !sortAsc.value;
  } else {
    sortKey.value = key;
    sortAsc.value = true;
  }
}

function sortIndicator(key: 'name' | 'entryDate' | 'salary' | 'rating'): string {
  return sortKey.value === key ? (sortAsc.value ? ' ↑' : ' ↓') : '';
}

function setSort(key: 'name' | 'entryDate' | 'salary' | 'rating' | null) {
  sortKey.value = key;
  sortAsc.value = true;
  closeMenus();
}

function openContactsMenu(event: MouseEvent) {
  const target = event.target as HTMLElement;
  if (target.closest('input, textarea, select, button')) return;
  contactsMenu.value = { x: event.clientX, y: event.clientY, visible: true };
}

function closeMenus() {
  contactsMenu.value.visible = false;
}

function add() {
  const n = name.value.trim();
  if (!n) {
    showNameToast.value = true;
    setTimeout(() => {
      showNameToast.value = false;
    }, 1800);
    return;
  }
  props.contacts.push({
    id: crypto.randomUUID(),
    name: n,
    companyId: props.companyId,
    entryDate: entryDate.value || today(),
    salary: salary.value && salary.value > 0 ? salary.value : undefined,
    bonus: bonus.value && bonus.value > 0 ? bonus.value : undefined,
    remark: remark.value.trim() || undefined,
    rating: rating.value || undefined,
  });
  name.value = '';
  salary.value = null;
  bonus.value = null;
  remark.value = '';
}

function onBonusInput(event: Event) {
  const el = event.target as HTMLInputElement;
  bonus.value = el.value === '' ? null : Number(el.value);
}

/** 入职时间无效（如 1922）时红字提示 */
function onDateInvalid() {
  showDateToast.value = true;
  if (dateToastTimer) clearTimeout(dateToastTimer);
  dateToastTimer = setTimeout(() => {
    showDateToast.value = false;
  }, 3000);
}


function contactName(id: string | null): string {
  if (!id) return '';
  return props.contacts.find((c) => c.id === id)?.name ?? '';
}

function askDelete(id: string) {
  deleteConfirmId.value = id;
}

function confirmDelete() {
  const id = deleteConfirmId.value;
  if (!id) return;
  const idx = props.contacts.findIndex((c) => c.id === id);
  if (idx >= 0) {
    const [removed] = props.contacts.splice(idx, 1);
    // 移入回收站，可恢复
    props.deletedContacts.push(removed);
  }
  // 待辞退记录同步移入回收站
  for (let i = props.pendingLayoffs.length - 1; i >= 0; i--) {
    if (props.pendingLayoffs[i].contactId === id) {
      const [removed] = props.pendingLayoffs.splice(i, 1);
      props.deletedPendingLayoffs.push(removed);
    }
  }
  deleteConfirmId.value = null;
}

/** 当前公司回收站中的员工 */
const deletedList = computed(() =>
  props.deletedContacts.filter((c) => c.companyId === props.companyId),
);

/** 恢复员工及其待辞退记录 */
function restoreContact(id: string) {
  const idx = props.deletedContacts.findIndex((c) => c.id === id);
  if (idx >= 0) {
    const [contact] = props.deletedContacts.splice(idx, 1);
    props.contacts.push(contact);
  }
  for (let i = props.deletedPendingLayoffs.length - 1; i >= 0; i--) {
    if (props.deletedPendingLayoffs[i].contactId === id) {
      const [record] = props.deletedPendingLayoffs.splice(i, 1);
      props.pendingLayoffs.push(record);
    }
  }
}

function deletedContactName(id: string | null): string {
  if (!id) return '';
  return props.deletedContacts.find((c) => c.id === id)?.name ?? '';
}

function askPurge(id: string) {
  purgeConfirmId.value = id;
}

function confirmPurge() {
  const id = purgeConfirmId.value;
  if (!id) return;
  const idx = props.deletedContacts.findIndex((c) => c.id === id);
  if (idx >= 0) props.deletedContacts.splice(idx, 1);
  // 待辞退记录一并永久删除
  for (let i = props.deletedPendingLayoffs.length - 1; i >= 0; i--) {
    if (props.deletedPendingLayoffs[i].contactId === id) {
      props.deletedPendingLayoffs.splice(i, 1);
    }
  }
  purgeConfirmId.value = null;
}

// ---- 行拖动排序（长按选中后指针锁死在框内，松开才恢复） ----
function onRowMouseDown(event: MouseEvent, id: string) {
  if (event.button !== 0) return;
  const target = event.target as HTMLElement;
  if (target.closest('input, textarea, select, button')) return;
  if (pressTimer) clearTimeout(pressTimer);
  pressed = true;
  // 长按约 175ms 立即变灰代表选中
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
  moveRowToPoint(props.contacts, draggingId.value, tbodyRef.value, pt.x, pt.y);
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
  document.addEventListener('click', closeMenus);
  nextTick(() => {
    document
      .querySelectorAll<HTMLTextAreaElement>('.contacts-panel textarea')
      .forEach((el) => autosizeTextarea(el));
  });
});
onBeforeUnmount(() => {
  document.removeEventListener('mousemove', onRowMouseMove);
  document.removeEventListener('mouseup', onRowMouseUp);
  window.removeEventListener('blur', cancelDrag);
  document.removeEventListener('click', closeMenus);
});

watch(
  () => props.contacts,
  () => {
    nextTick(() => {
      document
        .querySelectorAll<HTMLTextAreaElement>('.contacts-panel textarea')
        .forEach((el) => autosizeTextarea(el));
    });
  },
  { deep: true },
);
</script>

<template>
  <div class="contacts-panel">
    <section class="card">
      <div class="pending-head">
        <h2>通讯录</h2>
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
          <span>姓名（必填）</span>
          <input
            v-model="name"
            class="add-name-input"
            type="text"
            placeholder="输入姓名"
            @input="showNameToast = false"
          />
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
              v-model.number="salary"
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
              :value="fmt(salaryBonusTotal)"
              class="avg-part-input"
              type="text"
              readonly
            />
          </div>
        </div>
        <div class="field tenure-chain">
          <div class="chain-col">
            <span class="chain-col-label">入职时间</span>
            <DateSegments v-model="entryDate" :min-year="2000" @invalid="onDateInvalid" />
          </div>
          <span class="chain-arrow">➡</span>
          <div class="chain-col">
            <span class="chain-col-label">工作时长</span>
            <span class="chain-readonly">
              {{ entryDerived.years }}年{{ entryDerived.months }}月
            </span>
          </div>
          <span class="chain-arrow">➡</span>
          <div class="chain-col">
            <span class="chain-col-label">计入时长(月)</span>
            <span class="chain-readonly">{{ entryDerived.nMonths }}个月</span>
          </div>
        </div>
        <label class="field pending-rating-field">
          <span>评级</span>
          <select
            v-model="rating"
            class="pending-rating-select"
            :class="'rating-' + (rating || '')"
          >
            <option value="">未评级</option>
            <option v-for="r in RATINGS" :key="r.key" :value="r.key">{{ r.label }}</option>
          </select>
        </label>
        <div class="field add-btn-field">
          <span>&nbsp;</span>
          <div class="add-btn-right">
            <button class="primary" @click="add">添加人员</button>
          </div>
        </div>
        <label class="field pending-remark-field">
          <span>备注</span>
          <textarea
            v-model="remark"
            rows="1"
            class="pending-remark-textarea"
            placeholder="备注"
            @input="autosizeTextarea($event.target)"
          ></textarea>
        </label>
      </div>
    </section>

    <section
      ref="listCardRef"
      class="card contacts-list-card"
      @contextmenu.prevent="openContactsMenu"
    >
      <div class="card-head contacts-list-head">
        <h2>人员列表</h2>
        <button type="button" class="recycle-btn" @click="showRecycleBin = true">
          回收站
        </button>
      </div>
      <table>
        <thead>
          <tr>
            <th></th>
            <th class="sortable" @click="sortBy('name')">姓名{{ sortIndicator('name') }}</th>
            <th class="sortable" @click="sortBy('entryDate')">
              入职时间{{ sortIndicator('entryDate') }}
            </th>
            <th>计入时长</th>
            <th class="sortable" @click="sortBy('salary')">月工资{{ sortIndicator('salary') }}</th>
            <th>奖金</th>
            <th>平均月工资</th>
            <th>N</th>
            <th>N+1</th>
            <th>2N</th>
            <th class="sortable" @click="sortBy('rating')">评级{{ sortIndicator('rating') }}</th>
            <th>备注</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody ref="tbodyRef">
          <tr
            v-for="row in rows"
            :key="row.c.id"
            :data-id="row.c.id"
            :class="{ 'is-dragging': draggingId === row.c.id }"
            @mousedown="onRowMouseDown($event, row.c.id)"
          >
            <td><span class="contact-drag" title="拖动排序" @click.stop>⠿</span></td>
            <td class="cell-name" @click="openContactBlock(row.c.id)">{{ row.c.name }}</td>
            <td class="cell-entry-date" @click="openContactBlock(row.c.id)">
              {{ row.c.entryDate }}
            </td>
            <td class="cell-tenure" @click="openContactBlock(row.c.id)">
              <span :class="{ 'red-text': row.c.manualTenure != null }">
                {{ row.calc.months ? row.calc.months + ' 个月' : '' }}
              </span>
            </td>
            <td class="cell-salary" @click="openWageBlock(row.c.id)">
              {{ row.c.salary ?? '' }}
            </td>
            <td class="cell-bonus" @click="openWageBlock(row.c.id)">
              {{ row.c.bonus ?? '' }}
            </td>
            <td
              class="cell-avg"
              :class="{ 'avg-manual-red': row.c.manualAvg != null }"
              @click="openWageBlock(row.c.id)"
            >
              {{ fmt(row.calc.wageBase) }}
            </td>
            <td>{{ row.calc.result ? fmt(row.calc.result.n) : '' }}</td>
            <td>{{ row.calc.result ? fmt(row.calc.result.nPlus1) : '' }}</td>
            <td>{{ row.calc.result ? fmt(row.calc.result.twoN) : '' }}</td>
            <td class="cell-rating">
              <select
                v-model="row.c.rating"
                class="rating-cell-select"
                :class="'rating-' + (row.c.rating || '')"
              >
                <option value="">未评级</option>
                <option v-for="r in RATINGS" :key="r.key" :value="r.key">
                  {{ r.label }}
                </option>
              </select>
            </td>
            <td class="cell-remark" @click="openRemarkDialog(row.c.id)">
              {{ row.c.remark || '' }}
            </td>
            <td><button class="danger" @click="askDelete(row.c.id)">删除</button></td>
          </tr>
          <tr v-if="!rows.length">
            <td colspan="13" class="note">暂无人员，请先添加。</td>
          </tr>
        </tbody>
      </table>
      <p class="note">
        点击姓名/入职时间/计入时长或月工资/奖金/平均月工资板块弹出修改；评级直接下拉选择；备注点击弹窗修改；N、N+1、2N 不可修改。按住行左侧的拖动按钮可调整顺序。
      </p>
    </section>

    <!-- 备注修改弹窗 -->
    <div v-if="remarkModalId" class="modal-mask">
      <div class="modal-card block-edit-modal">
        <div class="modal-head">
          <h2>修改备注「{{ remarkName(remarkModalId) }}」</h2>
          <button type="button" class="modal-close" @click="closeRemarkDialog">✕</button>
        </div>
        <label class="field">
          <span>备注</span>
          <textarea
            v-model="remarkDraft"
            class="remark-modal-textarea"
            rows="3"
            placeholder="输入备注"
          ></textarea>
        </label>
        <div class="block-actions">
          <button type="button" @click="closeRemarkDialog">取消</button>
          <button type="button" class="primary" @click="confirmRemark">确定</button>
        </div>
      </div>
    </div>

    <!-- 板块一：姓名 / 入职时间➡工作时长➡计入时长(月) -->
    <div v-if="blockModal === 'contact'" class="modal-mask">
      <div class="modal-card block-edit-modal">
        <div class="modal-head">
          <h2>修改人员信息</h2>
          <button type="button" class="modal-close" @click="closeBlock">✕</button>
        </div>
        <label class="field">
          <span>姓名</span>
          <input
            v-model="contactNameDraft"
            class="block-name-input"
            type="text"
            placeholder="输入姓名"
          />
        </label>
        <div class="field block-chain-field">
          <div class="block-chain-col">
            <span class="block-chain-col-label">入职时间</span>
            <DateSegments
              :model-value="contactDateDraft"
              @update:model-value="onContactDateChange"
              @invalid="onDateInvalid"
            />
          </div>
          <span class="block-chain-arrow">➡</span>
          <div class="block-chain-col">
            <span class="block-chain-col-label">工作时长</span>
            <span class="chain-readonly">
              {{ contactBlockDerived.years }}年{{ contactBlockDerived.months }}月
            </span>
          </div>
          <span class="block-chain-arrow">➡</span>
          <div class="block-chain-col">
            <span class="block-chain-col-label">计入时长(月)</span>
            <input
              :value="tenureMonths"
              :class="{ 'tenure-manual': tenureManual }"
              class="block-tenure-input"
              type="number"
              min="0.5"
              step="0.5"
              @input="onTenureInput"
            />
          </div>
        </div>
        <div class="block-actions">
          <button type="button" @click="closeBlock">取消</button>
          <button type="button" class="primary" @click="confirmBlock">确定</button>
        </div>
      </div>
    </div>

    <!-- 板块二：月工资＋奖金÷12＝平均月工资 -->
    <div v-if="blockModal === 'wage'" class="modal-mask">
      <div class="modal-card block-edit-modal">
        <div class="modal-head">
          <h2>修改工资信息</h2>
          <button type="button" class="modal-close" @click="closeBlock">✕</button>
        </div>
        <div class="field block-chain-field">
          <div class="block-wage-labels">
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
          <div class="block-wage-row">
            <input
              :value="wageSalaryDraft"
              class="block-wage-input"
              type="number"
              min="0"
              step="0.01"
              @input="onWageSalaryInput"
            />
            <span class="calc-symbol">＋</span>
            <input
              :value="wageBonusDraft"
              class="block-bonus-input"
              type="number"
              min="0"
              step="0.01"
              @input="onWageBonusInput"
            />
            <span class="calc-symbol">＝</span>
            <input
              :value="wageAvgDraft !== '' ? wageAvgDraft : fmt(wageBlockTotal)"
              :class="{ 'avg-manual-red': wageAvgDraft !== '' }"
              class="block-avg-input"
              type="text"
              @input="onWageAvgInput"
            />
          </div>
        </div>
        <p class="note">平均月工资＝月工资＋奖金÷12；手动填入平均值后显示红字，修改月工资或奖金会自动恢复计算值。</p>
        <div class="block-actions">
          <button type="button" @click="closeBlock">取消</button>
          <button type="button" class="primary" @click="confirmBlock">确定</button>
        </div>
      </div>
    </div>

    <div v-if="deleteConfirmId" class="confirm-mask">
      <div class="confirm-card">
        <p class="confirm-danger-text">是否移除员工「{{ contactName(deleteConfirmId) }}」？</p>
        <p class="note">该员工在待辞退列表中的记录也会一并移除。</p>
        <div class="actions">
          <button @click="deleteConfirmId = null">取消</button>
          <button class="danger" @click="confirmDelete">确认</button>
        </div>
      </div>
    </div>

    <div v-if="showNameToast" class="center-toast">
      <span class="center-toast-text">请填写姓名</span>
    </div>

    <div v-if="showDateToast" class="center-toast">
      <span class="center-toast-text">入职时间需在1949-10-01至2050-12-31之间</span>
    </div>

    <div v-if="showRecycleBin" class="modal-mask">
      <div class="modal-card recycle-modal">
        <div class="modal-head">
          <h2>回收站</h2>
          <button
            type="button"
            class="modal-close"
            title="关闭"
            @click="showRecycleBin = false"
          >
            ❌
          </button>
        </div>
        <table class="recycle-table">
          <thead>
            <tr>
              <th>姓名</th>
              <th>入职时间</th>
              <th>月工资</th>
              <th>奖金</th>
              <th>评级</th>
              <th>备注</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="c in deletedList" :key="c.id" :data-id="c.id">
              <td>{{ c.name }}</td>
              <td>{{ c.entryDate }}</td>
              <td>{{ c.salary ?? '' }}</td>
              <td>{{ c.bonus ?? '' }}</td>
              <td>
                <span v-if="c.rating" :class="'rating-' + c.rating">
                  {{ ratingLabel(c.rating) }}
                </span>
                <span v-else class="note">未评级</span>
              </td>
              <td>{{ c.remark || '' }}</td>
              <td>
                <button type="button" class="primary" @click="restoreContact(c.id)">
                  恢复
                </button>
                <button type="button" class="danger" @click="askPurge(c.id)">
                  删除
                </button>
              </td>
            </tr>
            <tr v-if="!deletedList.length">
              <td colspan="7" class="note">回收站为空。</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <div v-if="purgeConfirmId" class="confirm-mask">
      <div class="confirm-card">
        <p class="confirm-danger-text">
          是否永久删除员工「{{ deletedContactName(purgeConfirmId) }}」？
        </p>
        <p class="note">删除后不可恢复，其待辞退记录也会一并删除。</p>
        <div class="actions">
          <button @click="purgeConfirmId = null">取消</button>
          <button class="danger" @click="confirmPurge">确认</button>
        </div>
      </div>
    </div>

    <div
      v-if="contactsMenu.visible"
      class="context-menu"
      :style="{ left: contactsMenu.x + 'px', top: contactsMenu.y + 'px' }"
      @click.stop
    >
      <button
        v-for="s in CONTEXT_SORTS"
        :key="s.label"
        type="button"
        :class="{ active: sortKey === s.key }"
        @click="setSort(s.key)"
      >
        {{ s.label }}
      </button>
    </div>
  </div>
</template>
