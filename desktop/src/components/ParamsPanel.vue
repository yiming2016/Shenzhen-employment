<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, reactive, ref, toRaw, watch } from 'vue';
import type { InsuranceParams } from '../../../core/types';
import RateInput from './RateInput.vue';
import BasisLinks from './BasisLinks.vue';
import BasisRow from './BasisRow.vue';
import MinimumWageModal from './MinimumWageModal.vue';
import type { MinimumWageGroup, SourceLink } from '../../../core/types';

const props = defineProps<{ params: InsuranceParams }>();
const emit = defineEmits<{
  (e: 'save', params: InsuranceParams): void;
  (e: 'reset'): void;
}>();

// 用 toRaw 取出原始对象再克隆，避免克隆 Vue 响应式代理报错
const draft = reactive(structuredClone(toRaw(props.params)));

// 缴费基数模块内的固定依据行：独立存储，不与上方依据列表共享。
function ensureBaseBasis(link: SourceLink | undefined): SourceLink {
  if (!link) return { name: '', url: '' };
  return link;
}
const pensionBasisLink = computed(() => {
  if (!draft.pension.baseBasis) draft.pension.baseBasis = { name: '', url: '' };
  return ensureBaseBasis(draft.pension.baseBasis);
});
const medicalBasisLink = computed(() => {
  if (!draft.medical.baseBasis) draft.medical.baseBasis = { name: '', url: '' };
  return ensureBaseBasis(draft.medical.baseBasis);
});
const unemploymentBasisLink = computed(() => {
  if (!draft.unemployment.baseBasis)
    draft.unemployment.baseBasis = { name: '', url: '' };
  return ensureBaseBasis(draft.unemployment.baseBasis);
});

// ---- 最低工资政策组：⚙️ 维护，按有效期分组，模块内只读显示 ----
const minWageModalOpen = ref(false);
const activeMinWageGroupIndex = ref(0);
const activeMinWageGroup = computed<MinimumWageGroup | null>(
  () =>
    sortedMinWageGroups.value[activeMinWageGroupIndex.value] ||
    sortedMinWageGroups.value[0] ||
    null,
);

function ensureMinWageGroups(): MinimumWageGroup[] {
  const defaultStart = '2026-09-01';
  const defaultEnd = '2028-09-01';
  if (!draft.minimumWageGroups || draft.minimumWageGroups.length === 0) {
    const src = draft.sourceBySection.minimumWage[0];
    draft.minimumWageGroups = [
      {
        name: src ? src.name : '',
        url: src ? src.url : '',
        publishDate: src ? src.publishDate || '' : '',
        validityStart: src ? src.validityStart || defaultStart : defaultStart,
        validityEnd: src ? src.validityEnd || defaultEnd : defaultEnd,
        minimumWage: draft.minimumWage,
        minimumPartTimeWage: draft.minimumPartTimeWage,
      },
    ];
  } else {
    // 兼容旧种子：组存在但名称为空且没有有效期时，补上默认有效期
    const g = draft.minimumWageGroups[0];
    if (g && !g.name && !g.validityStart && !g.validityEnd) {
      g.validityStart = defaultStart;
      g.validityEnd = defaultEnd;
    }
  }
  return draft.minimumWageGroups;
}

const minWageGroups = computed(() => ensureMinWageGroups());

// 按有效期从晚到早排列
const sortedMinWageGroups = computed(() =>
  [...minWageGroups.value].sort((a, b) =>
    (b.validityEnd || '').localeCompare(a.validityEnd || ''),
  ),
);

function minWageGroupLabel(g: MinimumWageGroup): string {
  if (g.validityStart || g.validityEnd)
    return `${g.validityStart || '?'} ~ ${g.validityEnd || '?'}`;
  return g.name || '未设置有效期';
}

// 弹窗“确定”才写回；取消/✕ 直接丢弃
function onMinWageGroupsSave(groups: MinimumWageGroup[]) {
  const prev = activeMinWageGroup.value;
  draft.minimumWageGroups = structuredClone(groups);
  minWageModalOpen.value = false;
  // 重新定位之前选中的组（按有效期匹配），否则回到第 0 项
  const prevIdx = sortedMinWageGroups.value.findIndex(
    (g) =>
      g.validityStart === prev?.validityStart &&
      g.validityEnd === prev?.validityEnd,
  );
  activeMinWageGroupIndex.value = prevIdx >= 0 ? prevIdx : 0;
}

// 默认选中当前正在生效的政策组（返回下标）
function pickDefaultMinWageGroupIndex(): number {
  const now = new Date();
  const today =
    now.getFullYear() * 10000 + (now.getMonth() + 1) * 100 + now.getDate();
  for (let i = 0; i < sortedMinWageGroups.value.length; i++) {
    const g = sortedMinWageGroups.value[i];
    const s = g.validityStart ? Number(g.validityStart.replace(/-/g, '')) : 0;
    const e = g.validityEnd ? Number(g.validityEnd.replace(/-/g, '')) : 99999999;
    if (today >= s && today <= e) return i;
  }
  return 0;
}

// 选择或编辑政策组时，把数值同步到全局最低工资（供失业等模块使用）
watch(activeMinWageGroupIndex, () => {
  const g = activeMinWageGroup.value;
  if (g) {
    draft.minimumWage = g.minimumWage;
    draft.minimumPartTimeWage = g.minimumPartTimeWage;
  }
});
if (sortedMinWageGroups.value.length > 0)
  activeMinWageGroupIndex.value = pickDefaultMinWageGroupIndex();

// 兼容旧数据：平均工资平铺结构迁移为按年份保存
{
  const aw0 = draft.averageWage as unknown as Record<string, unknown>;
  if (!aw0.byYear) {
    const y = String(new Date().getFullYear());
    draft.averageWage = {
      year: (aw0.year as string) || y,
      yearAllUnit: y,
      byYear: {
        [y]: {
          urbanNonPrivate: (aw0.urbanNonPrivate as number) || 0,
          urbanNonPrivateOnPost: (aw0.urbanNonPrivateOnPost as number) || 0,
          urbanPrivate: (aw0.urbanPrivate as number) || 0,
          allUnit: (aw0.allUnit as number) || 0,
        },
      },
    } as never;
  }
}
const savedTip = ref(false);

// ---- 平均工资按年份：下拉选择年份，数据跟随变化；⚙️ 弹窗批量设置 ----
const avgYears = Array.from({ length: 2050 - 2022 + 1 }, (_, i) => String(2022 + i));
const avgModalOpen = ref(false);

// 年份下拉只显示已填写数值的年份：没填数据的年份不出现
const baseYearOptions = computed(() =>
  avgYears.filter((y) => {
    const e = draft.averageWage.byYear[y];
    return !!(e && (e.urbanNonPrivate || e.urbanNonPrivateOnPost || e.urbanPrivate));
  }),
);
const allUnitYearOptions = computed(() =>
  avgYears.filter((y) => {
    const e = draft.averageWage.byYear[y];
    return !!(e && e.allUnit);
  }),
);

function ensureAvgYear(y: string) {
  if (!draft.averageWage.byYear[y]) {
    draft.averageWage.byYear[y] = {
      urbanNonPrivate: 0,
      urbanNonPrivateOnPost: 0,
      urbanPrivate: 0,
      allUnit: 0,
    };
  }
  return draft.averageWage.byYear[y];
}

const avgYear = ref(draft.averageWage.year || String(new Date().getFullYear()));
ensureAvgYear(avgYear.value);
draft.averageWage.year = avgYear.value;

watch(avgYear, (y) => {
  ensureAvgYear(y);
  draft.averageWage.year = y;
});

// 全口径组独立年份
const avgYearAll = ref(
  draft.averageWage.yearAllUnit || draft.averageWage.year || String(new Date().getFullYear()),
);
ensureAvgYear(avgYearAll.value);
draft.averageWage.yearAllUnit = avgYearAll.value;

watch(avgYearAll, (y) => {
  ensureAvgYear(y);
  draft.averageWage.yearAllUnit = y;
});

const avgModalMode = ref<'base' | 'allUnit'>('base');

function openAvgModal(mode: 'base' | 'allUnit') {
  for (const y of avgYears) ensureAvgYear(y);
  avgModalMode.value = mode;
  avgModalOpen.value = true;
}

// ---- ⚙️ 弹窗内年份：单击添加链接、双击访问、有链接变色 ----
function hasLink(mode: 'base' | 'allUnit', y: string): boolean {
  const entry = draft.averageWage.byYear[y];
  const link = mode === 'base' ? entry && entry.link : entry && entry.linkAllUnit;
  return !!(link && link.url && link.url.trim());
}

// 年份单元格悬浮提示：有备注显示备注，否则显示默认提示。
function yearRemark(mode: 'base' | 'allUnit', y: string): string {
  const entry = draft.averageWage.byYear[y];
  const link = mode === 'base' ? entry && entry.link : entry && entry.linkAllUnit;
  return link && link.remark ? link.remark.trim() : '';
}

const linkEditor = ref<null | { mode: 'base' | 'allUnit'; year: string; url: string; remark: string }>(
  null,
);

// 单击与双击冲突：单击延迟 250ms 弹编辑框，双击取消延迟直接打开链接
let yearClickTimer: ReturnType<typeof setTimeout> | null = null;

function onYearCellClick(mode: 'base' | 'allUnit', y: string) {
  if (yearClickTimer) clearTimeout(yearClickTimer);
  yearClickTimer = setTimeout(() => {
    yearClickTimer = null;
    openYearLinkEditor(mode, y);
  }, 250);
}

function onYearCellDblClick(mode: 'base' | 'allUnit', y: string, event: Event) {
  event.preventDefault();
  if (yearClickTimer) {
    clearTimeout(yearClickTimer);
    yearClickTimer = null;
  }
  openYearLink(mode, y);
}

function openYearLinkEditor(mode: 'base' | 'allUnit', y: string) {
  const entry = ensureAvgYear(y);
  const link = mode === 'base' ? entry.link : entry.linkAllUnit;
  linkEditor.value = {
    mode,
    year: y,
    url: link ? link.url || '' : '',
    remark: link ? link.remark || '' : '',
  };
}

function saveLinkEditor() {
  if (!linkEditor.value) return;
  const { mode, year, url, remark } = linkEditor.value;
  const entry = ensureAvgYear(year);
  const link =
    mode === 'base'
      ? entry.link || (entry.link = { url: '', remark: '' })
      : entry.linkAllUnit || (entry.linkAllUnit = { url: '', remark: '' });
  link.url = url.trim();
  link.remark = remark.trim();
  linkEditor.value = null;
}

function cancelLinkEditor() {
  linkEditor.value = null;
}

function openYearLink(mode: 'base' | 'allUnit', y: string) {
  const entry = draft.averageWage.byYear[y];
  const link = mode === 'base' ? entry && entry.link : entry && entry.linkAllUnit;
  const url = link && link.url ? link.url.trim() : '';
  if (!url) return;
  if (window.api) {
    window.api.openExternal(url);
  } else {
    window.open(url, '_blank');
  }
}

// 公积金比例下拉选项（政策参数页，职工默认值）
const housingCompanyOptions = [0, 5, 6, 7, 8, 9, 10, 11, 12];
const housingPersonalOptions = computed(() => {
  const c = Math.round(draft.housingFund.companyRate * 100);
  if (c <= 0) return [0];
  const opts: number[] = [];
  for (let v = c; v <= 12; v++) opts.push(v);
  return opts;
});

// 外部重置后重新同步草稿（期间抑制自动保存，避免循环）
let suppressAutoSave = false;
watch(
  () => props.params,
  (p) => {
    suppressAutoSave = true;
    Object.assign(draft, structuredClone(toRaw(p)));
    nextTick(() => {
      suppressAutoSave = false;
    });
  },
  { deep: true },
);

// 参数修改立即自动保存：没有防抖窗口，任何时刻退出都不会丢数据
watch(
  draft,
  () => {
    if (suppressAutoSave) return;
    emit('save', structuredClone(toRaw(draft)));
  },
  { deep: true },
);

onBeforeUnmount(() => {
  if (yearClickTimer) {
    clearTimeout(yearClickTimer);
    yearClickTimer = null;
  }
});

function save() {
  emit('save', structuredClone(toRaw(draft)));
  savedTip.value = true;
  setTimeout(() => {
    savedTip.value = false;
  }, 2000);
}

function reset() {
  if (confirm('恢复默认参数？当前修改会丢失。')) {
    emit('reset');
  }
}
</script>

<template>
  <div>
    <section class="card section-basic">
      <h2>工资</h2>
      <BasisLinks :links="draft.sourceBySection.minimumWage" editable />
      <div class="param-group">
        <label class="field">
          <span>有效期</span>
          <select
            v-model.number="activeMinWageGroupIndex"
            class="minwage-period-select"
          >
            <option v-for="(g, i) in sortedMinWageGroups" :key="g" :value="i">
              {{ minWageGroupLabel(g) }}
            </option>
          </select>
        </label>
        <label class="field">
          <span>最低工资（元/月）</span>
          <span class="minwage-display">
            {{ activeMinWageGroup?.minimumWage ?? draft.minimumWage }}
          </span>
        </label>
        <label class="field">
          <span>最低兼职（元/h）</span>
          <span class="minwage-display">
            {{ activeMinWageGroup?.minimumPartTimeWage ?? draft.minimumPartTimeWage }}
          </span>
          <button
            type="button"
            class="minwage-gear"
            title="管理最低工资政策"
            @click="minWageModalOpen = true"
          >
            ⚙️
          </button>
        </label>
      </div>
      <MinimumWageModal
        v-if="minWageModalOpen"
        :groups="minWageGroups"
        @save="onMinWageGroupsSave"
        @close="minWageModalOpen = false"
      />
      <div class="param-group">
        <label class="field">
          <span>
            年份
            <span class="tip-wrap">
              <span class="tip">ⓘ</span>
              <span class="tip-tip tip-tip-short">滞后6~7个月</span>
            </span>
          </span>
          <select v-model="avgYear" class="avg-year-select">
            <option v-for="y in baseYearOptions" :key="y" :value="y">{{ y }}</option>
          </select>
        </label>
        <label class="field">
          <span>城镇非私营平均工资（元/年）</span>
          <input
            v-model.number="draft.averageWage.byYear[avgYear].urbanNonPrivate"
            type="number"
            min="0"
          />
        </label>
        <label class="field">
          <span>城镇非私营（在岗）平均工资（元/年）</span>
          <input
            v-model.number="draft.averageWage.byYear[avgYear].urbanNonPrivateOnPost"
            type="number"
            min="0"
          />
        </label>
        <label class="field">
          <span>城镇私营平均工资（元/年）</span>
          <input
            v-model.number="draft.averageWage.byYear[avgYear].urbanPrivate"
            type="number"
            min="0"
          />
        </label>
        <button
          type="button"
          class="avg-gear"
          title="按年份设置平均工资"
          @click="openAvgModal('base')"
        >
          ⚙️
        </button>
      </div>
      <div class="param-group">
        <label class="field">
          <span>
            年份
            <span class="tip-wrap">
              <span class="tip">ⓘ</span>
              <span class="tip-tip tip-tip-short">滞后10~12个月</span>
            </span>
          </span>
          <select v-model="avgYearAll" class="avg-year-select">
            <option v-for="y in allUnitYearOptions" :key="y" :value="y">{{ y }}</option>
          </select>
        </label>
        <label class="field">
          <span>广东省全口径城镇单位就业人员平均工资（元/月）</span>
          <input
            v-model.number="draft.averageWage.byYear[avgYearAll].allUnit"
            type="number"
            min="0"
          />
        </label>
        <button
          type="button"
          class="avg-gear"
          title="按年份设置全口径平均工资"
          @click="openAvgModal('allUnit')"
        >
          ⚙️
        </button>
      </div>
    </section>

    <!-- 平均工资按年份设置弹窗 -->
    <div v-if="avgModalOpen" class="modal-mask">
      <div class="modal-card avg-modal">
        <div class="modal-head">
          <h2>
            {{
              avgModalMode === 'base'
                ? '按年份设置平均工资（2022 ~ 2050）'
                : '按年份设置全口径平均工资（2022 ~ 2050）'
            }}
          </h2>
          <button type="button" class="modal-close" @click="avgModalOpen = false">✕</button>
        </div>
        <div
          class="avg-year-grid"
          :class="avgModalMode === 'base' ? 'cols-3' : 'cols-1'"
        >
          <span class="avg-year-head">年份</span>
          <template v-if="avgModalMode === 'base'">
            <span class="avg-year-head">城镇非私营</span>
            <span class="avg-year-head">在岗</span>
            <span class="avg-year-head">城镇私营</span>
          </template>
          <span v-else class="avg-year-head">全口径城镇单位就业人员平均工资(元/月)</span>
          <template v-for="y in avgYears" :key="y">
            <span
              class="avg-year-label year-link-year"
              :class="{ 'has-link': hasLink(avgModalMode, y) }"
              :title="yearRemark(avgModalMode, y) || '单击添加链接，双击打开'"
              @click="onYearCellClick(avgModalMode, y)"
              @dblclick="onYearCellDblClick(avgModalMode, y, $event)"
            >
              {{ y }}
            </span>
            <template v-if="avgModalMode === 'base'">
              <input
                v-model.number="draft.averageWage.byYear[y].urbanNonPrivate"
                type="number"
                min="0"
              />
              <input
                v-model.number="draft.averageWage.byYear[y].urbanNonPrivateOnPost"
                type="number"
                min="0"
              />
              <input
                v-model.number="draft.averageWage.byYear[y].urbanPrivate"
                type="number"
                min="0"
              />
            </template>
            <input
              v-else
              v-model.number="draft.averageWage.byYear[y].allUnit"
              type="number"
              min="0"
            />
          </template>
        </div>
        <div class="block-actions">
          <button type="button" @click="avgModalOpen = false">取消</button>
          <button type="button" class="primary" @click="avgModalOpen = false">确定</button>
        </div>
      </div>
    </div>

    <!-- 年份链接编辑弹窗 -->
    <div v-if="linkEditor" class="modal-mask">
      <div class="modal-card link-editor-card">
        <div class="modal-head">
          <h2>{{ linkEditor.year }} 年度政策链接</h2>
          <button type="button" class="modal-close" @click="cancelLinkEditor">✕</button>
        </div>
        <label class="field">
          <span>网址</span>
          <input v-model="linkEditor.url" type="text" placeholder="https://..." />
        </label>
        <label class="field">
          <span>备注</span>
          <input v-model="linkEditor.remark" type="text" placeholder="备注" />
        </label>
        <div class="block-actions">
          <button type="button" @click="cancelLinkEditor">取消</button>
          <button type="button" class="primary" @click="saveLinkEditor">确定</button>
        </div>
      </div>
    </div>

    <section class="card section-pension">
      <h2>养老</h2>
      <BasisLinks :links="draft.sourceBySection.pension" editable :min-year="2021" />
      <div class="param-group">
        <BasisRow :link="pensionBasisLink" />
        <label class="field">
          <span>
            缴费基数下限（元）
            <span class="tip-wrap">
              <span class="tip">ⓘ</span>
              <span class="tip-tip tip-tip-short">广东上年度省全口径从业人员平均工资60%</span>
            </span>
          </span>
          <input v-model.number="draft.pension.baseMin" type="number" min="0" />
        </label>
        <label class="field">
          <span>
            缴费基数上限（元）
            <span class="tip-wrap">
              <span class="tip">ⓘ</span>
              <span class="tip-tip tip-tip-short">广东省上年度全口径从业人员平均工资300%</span>
            </span>
          </span>
          <input v-model.number="draft.pension.baseMax" type="number" min="0" />
        </label>
      </div>
      <div class="param-group">
        <label class="field">
          <span>公司费率（深户）</span>
          <RateInput v-model="draft.pension.companyRateDeep" />
        </label>
        <label class="field">
          <span>公司费率（非深户）</span>
          <RateInput v-model="draft.pension.companyRateNonDeep" />
        </label>
        <label class="field">
          <span>个人费率（职工）</span>
          <RateInput v-model="draft.pension.personalRate" />
        </label>
      </div>
      <div class="param-group">
        <label class="field">
          <span>灵活就业费率（深户）</span>
          <RateInput v-model="draft.pension.flexibleRateDeep" />
        </label>
        <label class="field">
          <span>灵活就业费率（非深户）</span>
          <RateInput v-model="draft.pension.flexibleRateNonDeep" />
        </label>
      </div>
    </section>

    <section class="card section-medical">
      <h2>医保</h2>
      <BasisLinks :links="draft.sourceBySection.medical" editable />
      <div class="param-group">
        <BasisRow :link="medicalBasisLink" />
        <label class="field">
          <span>
            缴费基数下限（元）
            <span class="tip-wrap">
              <span class="tip">ⓘ</span>
              <span class="tip-tip tip-tip-short">深圳上上年度全口径城镇单位就业人员月平均工资60%</span>
            </span>
          </span>
          <input v-model.number="draft.medical.baseMin" type="number" min="0" />
        </label>
        <label class="field">
          <span>
            缴费基数上限（元）
            <span class="tip-wrap">
              <span class="tip">ⓘ</span>
              <span class="tip-tip tip-tip-short">深圳上上年度全口径城镇单位就业人员月平均工资300%</span>
            </span>
          </span>
          <input v-model.number="draft.medical.baseMax" type="number" min="0" />
        </label>
      </div>
      <div class="param-group-row">
        <div class="param-group">
          <label class="field">
            <span>一档公司费率</span>
            <RateInput v-model="draft.medical.tier1CompanyRate" />
          </label>
          <label class="field">
            <span>一档个人费率</span>
            <RateInput v-model="draft.medical.tier1PersonalRate" />
          </label>
        </div>
        <div class="param-group">
          <label class="field">
            <span>二档公司费率</span>
            <RateInput v-model="draft.medical.tier2CompanyRate" />
          </label>
          <label class="field">
            <span>二档个人费率</span>
            <RateInput v-model="draft.medical.tier2PersonalRate" />
          </label>
        </div>
      </div>
      <div class="param-group">
        <label class="field">
          <span>灵活就业个人费率</span>
          <RateInput v-model="draft.medical.flexibleRate" />
        </label>
      </div>
      <h3 class="param-sub-title">生育</h3>
      <div class="param-group">
        <label class="field">
          <span>公司费率（个人不缴）</span>
          <RateInput v-model="draft.maternity.companyRate" />
        </label>
      </div>
    </section>

    <section class="card section-unemployment">
      <h2>失业</h2>
      <BasisLinks :links="draft.sourceBySection.unemployment" editable />
      <div class="param-group">
        <BasisRow :link="unemploymentBasisLink" />
        <label class="field">
          <span>
            缴费基数下限（元）
            <span class="tip-wrap">
              <span class="tip">ⓘ</span>
              <span class="tip-tip tip-tip-short">本市月最低工资</span>
            </span>
          </span>
          <input :value="draft.minimumWage" type="number" min="0" readonly />
        </label>
        <label class="field">
          <span>
            缴费基数上限（元）
            <span class="tip-wrap">
              <span class="tip">ⓘ</span>
              <span class="tip-tip tip-tip-short">上年度深圳市在岗职工月平均工资的3倍</span>
            </span>
          </span>
          <input v-model.number="draft.unemployment.baseMax" type="number" min="0" />
        </label>
      </div>
      <div class="param-group">
        <label class="field">
          <span>公司费率（职工）</span>
          <RateInput v-model="draft.unemployment.companyRate" />
        </label>
        <label class="field">
          <span>个人费率（职工）</span>
          <RateInput v-model="draft.unemployment.personalRate" />
        </label>
      </div>
      <div class="param-group">
        <label class="field">
          <span>灵活就业个人费率</span>
          <RateInput v-model="draft.unemployment.flexibleRate" />
        </label>
      </div>
      <p class="note">
        失业缴费基数下限 = 最低工资，修改最低工资后自动同步，无需单独设置。
        Excel 公式：失业上限 = 3 × 城镇非私营平均工资 = 3 × 191367 = 574101（上限可修改）。
      </p>
    </section>

    <section class="card section-injury">
      <h2>工伤（个人不缴）</h2>
      <BasisLinks :links="draft.sourceBySection.injury" editable :min-year="2021" />
      <div class="injury-grid">
        <div v-for="(rate, i) in draft.injury.companyRates" :key="i" class="injury-item">
          <div class="injury-head">
            <span class="injury-class-label">第{{ i + 1 }}类</span>
            <RateInput v-model="draft.injury.companyRates[i]" />
          </div>
          <textarea
            v-model="draft.injury.industryNames[i]"
            class="injury-name-input"
            rows="3"
          ></textarea>
        </div>
      </div>
    </section>

    <section class="card section-housing">
      <h2>公积金</h2>
      <BasisLinks
        :links="draft.sourceBySection.housingFund"
        fallback="公积金比例由单位自行确定（默认 5%）"
        editable
      />
      <div class="param-group">
        <label class="field">
          <span>公司比例（职工，整数、最高 12%）</span>
          <RateInput v-model="draft.housingFund.companyRate" :options="housingCompanyOptions" />
        </label>
        <label class="field">
          <span>个人比例（职工，整数、最高 12%）</span>
          <RateInput v-model="draft.housingFund.personalRate" :options="housingPersonalOptions" />
        </label>
      </div>
      <p class="note">公积金比例仅限整数：职工最高 12%，灵活就业最高 24%。保存后试算页会自动采用。</p>
    </section>

    <section class="actions">
      <button class="primary" @click="save">保存参数</button>
      <button @click="reset">恢复默认</button>
      <span v-if="savedTip" class="saved-tip">已保存 ✓</span>
    </section>
  </div>
</template>
