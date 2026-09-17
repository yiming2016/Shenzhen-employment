<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { DEFAULT_PARAMS } from '../../core/params';
import { SYNC_SECTIONS, applyRemoteParams } from '../../core/sync';
import { REGIONS, getRegion } from '../../core/regions';
import { yearsToN } from '../../core/severance';
import pkg from '../../package.json';
import type { AppSettings, InsuranceParams, SourceLink } from '../../core/types';
import CalculatorPanel from './components/CalculatorPanel.vue';
import ParamsPanel from './components/ParamsPanel.vue';
import SettingsModal from './components/SettingsModal.vue';
import PartTimePanel from './components/PartTimePanel.vue';
import DispatchPanel from './components/DispatchPanel.vue';
import OutsourcePanel from './components/OutsourcePanel.vue';
import PolicySyncModal, {
  type PolicySyncSettings,
} from './components/PolicySyncModal.vue';
import SeverancePanel, {
  type SeveranceDefaults,
} from './components/SeverancePanel.vue';
import SeveranceSettingsModal from './components/SeveranceSettingsModal.vue';
import CompanySettingsModal from './components/CompanySettingsModal.vue';
import type { Company, Contact, PendingLayoff } from '../../core/business';
import { computed } from 'vue';

const tab = ref<'calc' | 'params' | 'severance' | 'about' | 'ad'>('calc');
const calcSubTab = ref<
  'fulltime' | 'contacts' | 'parttime' | 'dispatch' | 'outsource'
>('fulltime');
const calcSubTabNames: Record<string, string> = {
  fulltime: '全职',
  contacts: '通讯录',
  parttime: '兼职',
  dispatch: '派遣',
  outsource: '外包',
};
const calcSubOpen = ref(true);
const severanceSubOpen = ref(true);
const loaded = ref(false);

// 顶栏再次点击“用工/赔偿”：收起或展开子分类栏（从其他分类点进来时正常展开）
function onCalcNavClick() {
  if (tab.value === 'calc') {
    calcSubOpen.value = !calcSubOpen.value;
  } else {
    tab.value = 'calc';
    calcSubOpen.value = true;
  }
}

function onSeveranceNavClick() {
  if (tab.value === 'severance') {
    severanceSubOpen.value = !severanceSubOpen.value;
  } else {
    tab.value = 'severance';
    severanceSubOpen.value = true;
  }
}
const params = ref<InsuranceParams>(structuredClone(DEFAULT_PARAMS));
const regionKey = ref('shenzhen');
const showDefaults = ref(false);
const showPolicySync = ref(false);
const showSeveranceSettings = ref(false);
const showCompanySettings = ref(false);
const companyMenuOpen = ref(false);
const companyWrap = ref<HTMLElement | null>(null);
const severanceDefaults = ref<SeveranceDefaults>({
  monthlyWage: 8000,
  years: 3,
  useCap: true,
  tipLinks: { n: '', nPlus1: '', twoN: '' },
});
const policySyncSettings = ref<PolicySyncSettings>({
  url: '',
  autoSync: false,
  platformUrl: '',
  sections: Object.fromEntries(SYNC_SECTIONS.map((s) => [s.key, false])),
});
const settings = ref<AppSettings>({
  calculator: {
    participationType: 'employee',
    household: 'deep',
    medicalTier: 1,
    injuryClass: 2,
  },
  housingFund: {
    employee: {
      followWage: true,
      fixedBase: 5000,
      personalRate: DEFAULT_PARAMS.housingFund.personalRate,
      companyRate: DEFAULT_PARAMS.housingFund.companyRate,
    },
    flexible: {
      followWage: true,
      fixedBase: 5000,
      rate: 0.12, // 灵活就业默认 12%
    },
  },
});

const avgSources = computed(() => {
  const aw = params.value.averageWage;
  const cur = aw.byYear[aw.year] || {};
  const all = aw.byYear[aw.yearAllUnit || aw.year] || {};
  return {
    allUnit: all.allUnit || 0,
    nonPrivate: cur.urbanNonPrivate || 0,
    onPost: cur.urbanNonPrivateOnPost || 0,
  };
});
const regionName = computed(() => getRegion(regionKey.value).name);

// 公司 / 通讯录 / 待辞退（本地持久化）
function loadJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (raw) return JSON.parse(raw) as T;
  } catch {
    // 使用默认值
  }
  return fallback;
}
function persistJson(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // 保存失败不影响使用
  }
}

const companies = ref<Company[]>(
  loadJson('companies', [{ id: 'company-default', name: '默认公司' }]),
);
const companyKey = ref(loadJson('companyKey', companies.value[0].id));
const contacts = ref<Contact[]>(loadJson('contacts', []));
const pendingLayoffs = ref<PendingLayoff[]>(
  (loadJson<PendingLayoff[]>('pendingLayoffs', [])).map((p) => {
    // 旧版本 months 存的是原始总月数，这里一次性折算为 N 规则下的月数
    if (!p.nMonths) {
      p.months = yearsToN((p.years || 0) + (p.months || 0) / 12);
      p.years = 0;
      p.nMonths = true;
    }
    return p;
  }),
);
const deletedContacts = ref<Contact[]>(loadJson('deletedContacts', []));
const deletedPendingLayoffs = ref<PendingLayoff[]>(
  (loadJson<PendingLayoff[]>('deletedPendingLayoffs', [])).map((p) => {
    if (!p.nMonths) {
      p.months = yearsToN((p.years || 0) + (p.months || 0) / 12);
      p.years = 0;
      p.nMonths = true;
    }
    return p;
  }),
);

watch(
  [companies, contacts, pendingLayoffs, deletedContacts, deletedPendingLayoffs],
  () => {
    if (companies.value.length > 0 && !companies.value.some((c) => c.id === companyKey.value)) {
      companyKey.value = companies.value[0].id;
      persistJson('companyKey', companyKey.value);
    }
    persistJson('companies', companies.value);
    persistJson('contacts', contacts.value);
    persistJson('pendingLayoffs', pendingLayoffs.value);
    persistJson('deletedContacts', deletedContacts.value);
    persistJson('deletedPendingLayoffs', deletedPendingLayoffs.value);
  },
  { deep: true },
);

/** 把磁盘上保存的参数与默认参数合并，防止以后新增字段时读取旧文件报错 */
function mergeParams(base: InsuranceParams, saved: Record<string, unknown>): InsuranceParams {
  const merged = structuredClone(base) as Record<string, unknown>;
  for (const key of Object.keys(saved)) {
    const savedValue = saved[key];
    const baseValue = merged[key];
    if (
      baseValue &&
      typeof baseValue === 'object' &&
      !Array.isArray(baseValue) &&
      savedValue &&
      typeof savedValue === 'object' &&
      !Array.isArray(savedValue)
    ) {
      merged[key] = { ...(baseValue as object), ...(savedValue as object) };
    } else if (baseValue !== undefined && typeof baseValue === typeof savedValue) {
      merged[key] = savedValue;
    }
  }
  return merged as unknown as InsuranceParams;
}

/** 兼容旧数据：旧版平均工资是平铺结构，迁移为按年份保存 */
function migrateParams(p: InsuranceParams): InsuranceParams {
  const aw = p.averageWage as unknown as {
    urbanNonPrivate?: number;
    urbanNonPrivateOnPost?: number;
    urbanPrivate?: number;
    allUnit?: number;
    year?: string;
    byYear?: Record<string, unknown>;
  };
  if (aw && typeof aw === 'object' && !aw.byYear) {
    const year = aw.year || String(new Date().getFullYear());
    p.averageWage = {
      year,
      yearAllUnit: year,
      byYear: {
        [year]: {
          urbanNonPrivate: aw.urbanNonPrivate || 0,
          urbanNonPrivateOnPost: aw.urbanNonPrivateOnPost || 0,
          urbanPrivate: aw.urbanPrivate || 0,
          allUnit: aw.allUnit || 0,
        },
      },
    };
  }
  return p;
}

onMounted(async () => {
  try {
    const savedKey = localStorage.getItem('regionKey');
    if (savedKey && getRegion(savedKey).key === savedKey) {
      regionKey.value = savedKey;
    }
  } catch {
    // 使用默认地区
  }
  const region = getRegion(regionKey.value);
  params.value = structuredClone(region.params);
  const saved = window.api ? await window.api.loadParams(regionKey.value) : null;
  if (saved && typeof saved === 'object') {
    params.value = mergeParams(region.params, saved as Record<string, unknown>);
    migrateParams(params.value);
  }
  // 读取本机保存的设置（含计算默认值 + 公积金板块）
  let hasLocalDefaults = false;
  try {
    const raw = localStorage.getItem('appSettings');
    if (raw) {
      const saved = JSON.parse(raw) as Partial<AppSettings>;
      if (saved.calculator && saved.housingFund) {
        hasLocalDefaults = true;
        settings.value = {
          calculator: { ...settings.value.calculator, ...saved.calculator },
          housingFund: {
            employee: { ...settings.value.housingFund.employee, ...saved.housingFund.employee },
            flexible: { ...settings.value.housingFund.flexible, ...saved.housingFund.flexible },
          },
        };
      }
    }
  } catch {
    // 读取失败则使用默认值
  }
  // 兼容旧版本：只保存过 housingFundDefaults
  if (!hasLocalDefaults) {
    try {
      const raw = localStorage.getItem('housingFundDefaults');
      if (raw) {
        const old = JSON.parse(raw);
        if (old && old.employee && old.flexible) {
          hasLocalDefaults = true;
          settings.value.housingFund = {
            employee: { ...settings.value.housingFund.employee, ...old.employee },
            flexible: { ...settings.value.housingFund.flexible, ...old.flexible },
          };
        }
      }
    } catch {
      // 忽略旧数据格式问题
    }
  }
  // 没有自定义默认设置时，跟随政策参数里的公积金比例
  if (!hasLocalDefaults) {
    settings.value.housingFund.employee.personalRate = params.value.housingFund.personalRate;
    settings.value.housingFund.employee.companyRate = params.value.housingFund.companyRate;
    // 灵活就业默认比例固定为 12%，不跟随政策参数里的职工比例
    settings.value.housingFund.flexible.rate = 0.12;
  }
  // 读取政策参数远程同步设置
  try {
    const raw = localStorage.getItem('policySyncSettings');
    if (raw) {
      const saved = JSON.parse(raw);
      if (saved && typeof saved.url === 'string' && saved.sections && typeof saved.sections === 'object') {
        policySyncSettings.value = {
          url: saved.url,
          autoSync: saved.autoSync === true,
          platformUrl: typeof saved.platformUrl === 'string' ? saved.platformUrl : '',
          sections: { ...policySyncSettings.value.sections, ...saved.sections },
        };
      }
    }
  } catch {
    // 读取失败则使用默认值
  }
  // 读取赔偿默认设置
  try {
    const raw = localStorage.getItem('severanceSettings');
    if (raw) {
      const saved = JSON.parse(raw);
      if (saved && typeof saved.monthlyWage === 'number' && typeof saved.years === 'number') {
        severanceDefaults.value = {
          monthlyWage: saved.monthlyWage,
          years: saved.years,
          useCap: saved.useCap !== false,
          tipLinks:
            saved.tipLinks && typeof saved.tipLinks === 'object'
              ? {
                  n: saved.tipLinks.n || '',
                  nPlus1: saved.tipLinks.nPlus1 || '',
                  twoN: saved.tipLinks.twoN || '',
                }
              : { n: '', nPlus1: '', twoN: '' },
        };
      }
    }
  } catch {
    // 使用默认值
  }
  // 开启"启动软件自动同步"且已填地址时，静默同步一次
  if (policySyncSettings.value.autoSync && policySyncSettings.value.url.trim()) {
    autoSyncRemote();
  }
  loaded.value = true;
});

async function switchRegion(key: string) {
  if (key === regionKey.value) return;
  regionKey.value = key;
  try {
    localStorage.setItem('regionKey', key);
  } catch {
    // 保存失败不影响切换
  }
  const region = getRegion(key);
  const base = structuredClone(region.params);
  const saved = window.api ? await window.api.loadParams(key) : null;
  params.value =
    saved && typeof saved === 'object'
      ? mergeParams(base, saved as Record<string, unknown>)
      : base;
  migrateParams(params.value);
  applyParamsToMemory(params.value);
  if (policySyncSettings.value.autoSync && policySyncSettings.value.url.trim()) {
    autoSyncRemote();
  }
}

function onRegionChange(event: Event) {
  switchRegion((event.target as HTMLSelectElement).value);
}

function switchCompany(key: string) {
  companyKey.value = key;
  persistJson('companyKey', key);
  companyMenuOpen.value = false;
}

const currentCompanyName = computed(
  () => companies.value.find((c) => c.id === companyKey.value)?.name ?? '未命名公司',
);

function toggleCompanyMenu() {
  companyMenuOpen.value = !companyMenuOpen.value;
}

function onDocumentClick(event: MouseEvent) {
  if (companyWrap.value && !companyWrap.value.contains(event.target as Node)) {
    companyMenuOpen.value = false;
  }
}

onMounted(() => document.addEventListener('click', onDocumentClick));
onBeforeUnmount(() => document.removeEventListener('click', onDocumentClick));

function persistSettings() {
  try {
    localStorage.setItem('appSettings', JSON.stringify(settings.value));
  } catch {
    // 保存失败不影响使用
  }
}

function saveSettings(value: AppSettings) {
  settings.value = value;
  persistSettings();
}

function savePolicySyncSettings(value: PolicySyncSettings) {
  policySyncSettings.value = value;
  try {
    localStorage.setItem('policySyncSettings', JSON.stringify(value));
  } catch {
    // 保存失败不影响使用
  }
}

function saveSeveranceSettings(value: SeveranceDefaults) {
  severanceDefaults.value = value;
  try {
    localStorage.setItem('severanceSettings', JSON.stringify(value));
  } catch {
    // 保存失败不影响使用
  }
}

function applyParamsToMemory(p: InsuranceParams) {
  params.value = p;
  // 政策参数里的公积金比例是权威默认值，同步到 ⚙️ 默认设置，试算页立即生效
  settings.value.housingFund.employee.personalRate = p.housingFund.personalRate;
  settings.value.housingFund.employee.companyRate = p.housingFund.companyRate;
  persistSettings();
}

async function saveParams(p: InsuranceParams) {
  // 把按险种分组的依据同步成平铺列表，供“说明与来源”页展示
  const flat: SourceLink[] = [];
  const seen = new Set<string>();
  for (const list of Object.values(p.sourceBySection)) {
    for (const s of list) {
      if (!seen.has(s.url)) {
        seen.add(s.url);
        flat.push({ name: s.name, url: s.url });
      }
    }
  }
  p.sources = flat;
  applyParamsToMemory(p);
  if (window.api) {
    await window.api.saveParams(regionKey.value, p);
  }
}

function handleRemoteSynced(p: InsuranceParams) {
  applyParamsToMemory(p);
  if (window.api) {
    window.api.saveParams(regionKey.value, p);
  }
  showPolicySync.value = false;
}

async function autoSyncRemote() {
  try {
    const text = await window.api!.fetchRemote(policySyncSettings.value.url.trim());
    const remote = JSON.parse(text);
    const enabled = SYNC_SECTIONS.map((s) => s.key).filter(
      (key) => policySyncSettings.value.sections[key],
    );
    if (enabled.length === 0) return;
    const result = applyRemoteParams(
      JSON.parse(JSON.stringify(params.value)),
      remote,
      enabled,
    );
    if (result.updated.length > 0) {
      applyParamsToMemory(result.params);
      if (window.api) await window.api.saveParams(regionKey.value, result.params);
    }
  } catch {
    // 自动同步失败不打扰用户，可在弹窗里手动同步
  }
}

async function resetParams() {
  params.value = structuredClone(getRegion(regionKey.value).params);
  if (window.api) {
    await window.api.resetParams(regionKey.value);
  }
}

function openLink(url: string) {
  if (window.api) {
    window.api.openExternal(url);
  } else {
    window.open(url, '_blank');
  }
}
</script>

<template>
  <div class="app">
    <header class="topbar">
        <div class="topbar-left">
        <select class="region-select" :value="regionKey" @change="onRegionChange">
          <option v-for="r in REGIONS" :key="r.key" :value="r.key">{{ r.name }}</option>
        </select>
        <div ref="companyWrap" class="company-select-wrap" @click.stop>
          <button type="button" class="company-current" @click="toggleCompanyMenu">
            {{ currentCompanyName }}
          </button>
          <button class="nav-gear-btn" title="公司管理" @click="showCompanySettings = true">
            ⚙️
          </button>
          <div v-if="companyMenuOpen" class="company-menu">
            <button
              v-for="c in companies"
              :key="c.id"
              type="button"
              class="company-menu-item"
              :class="{ selected: c.id === companyKey }"
              @click="switchCompany(c.id)"
            >
              {{ c.name }}
            </button>
          </div>
        </div>
        <span class="app-version">v{{ pkg.version }}</span>
      </div>
      <nav>
        <div class="nav-calc">
          <button
            :class="{ active: tab === 'calc' }"
            class="nav-calc-main"
            @click="onCalcNavClick"
          >
            用工
          </button>
          <button
            class="nav-gear-btn"
            title="设置"
            @click="showDefaults = true"
          >
            ⚙️
          </button>
        </div>
        <div class="nav-calc">
          <button
            :class="{ active: tab === 'params' }"
            class="nav-calc-main"
            @click="tab = 'params'"
          >
            政策参数
          </button>
          <button
            class="nav-gear-btn"
            title="政策参数远程同步"
            @click="showPolicySync = true"
          >
            ⚙️
          </button>
        </div>
        <div class="nav-calc">
          <button
            :class="{ active: tab === 'severance' }"
            class="nav-calc-main"
            @click="onSeveranceNavClick"
          >
            赔偿
          </button>
          <button
            class="nav-gear-btn"
            title="赔偿默认设置"
            @click="showSeveranceSettings = true"
          >
            ⚙️
          </button>
        </div>
        <button :class="{ active: tab === 'about' }" @click="tab = 'about'">说明与来源</button>
        <button :class="{ active: tab === 'ad' }" @click="tab = 'ad'">广告</button>
      </nav>
    </header>

    <main v-if="loaded">
      <template v-if="tab === 'calc'">
        <div v-show="calcSubOpen" class="sub-tabs">
          <button
            v-for="key in ['fulltime', 'contacts', 'parttime', 'dispatch', 'outsource']"
            :key="key"
            :class="{ active: calcSubTab === key }"
            @click="calcSubTab = key"
          >
            {{ calcSubTabNames[key] }}
          </button>
        </div>
        <CalculatorPanel
          v-if="calcSubTab === 'fulltime'"
          :params="params"
          :calculator-defaults="settings.calculator"
          :housing-fund-defaults="settings.housingFund"
        />
        <PartTimePanel
          v-else-if="calcSubTab === 'parttime'"
          :params="params"
        />
        <DispatchPanel
          v-else-if="calcSubTab === 'dispatch'"
        />
        <OutsourcePanel
          v-else-if="calcSubTab === 'outsource'"
        />
        <section v-else class="card">
          <h2>{{ calcSubTabNames[calcSubTab] }}</h2>
          <p class="note">内容待添加，敬请期待。</p>
        </section>
      </template>
      <ParamsPanel
        v-else-if="tab === 'params'"
        :params="params"
        @save="saveParams"
        @reset="resetParams"
      />
      <SeverancePanel
        v-else-if="tab === 'severance'"
        :avg-sources="avgSources"
        :region-name="regionName"
        :defaults="severanceDefaults"
        :contacts="contacts"
        :pending-layoffs="pendingLayoffs"
        :deleted-contacts="deletedContacts"
        :deleted-pending-layoffs="deletedPendingLayoffs"
        :company-id="companyKey"
        :sub-open="severanceSubOpen"
      />
      <section v-else-if="tab === 'about'" class="card">
        <h2>说明</h2>
        <p>
          本工具根据《社保成本.xlsx》中的深圳社保公式制作，目前只包含社保（养老、医保、生育、失业、工伤、公积金），不含税务。
        </p>
        <p class="note">
          计算逻辑全部在 core/ 目录下，是纯 TypeScript 参数驱动模块；手机 App 可以直接复用同一套逻辑。
        </p>
        <h2>官方政策来源</h2>
        <div class="links">
          <a
            v-for="s in params.sources"
            :key="s.url"
            href="#"
            @click.prevent="openLink(s.url)"
          >
            {{ s.name }}
          </a>
        </div>
      </section>
      <section v-else-if="tab === 'ad'" class="card">
        <h2>广告</h2>
        <p class="note">广告位预留，暂无内容。</p>
      </section>
    </main>

    <SettingsModal
      v-if="showDefaults"
      :model-value="settings"
      :params="params"
      @save="saveSettings"
      @close="showDefaults = false"
    />
    <PolicySyncModal
      v-if="showPolicySync"
      :model-value="policySyncSettings"
      :params="params"
      @save="savePolicySyncSettings"
      @synced="handleRemoteSynced"
      @close="showPolicySync = false"
    />
    <SeveranceSettingsModal
      v-if="showSeveranceSettings"
      :model-value="severanceDefaults"
      @save="saveSeveranceSettings"
      @close="showSeveranceSettings = false"
    />
    <CompanySettingsModal
      v-if="showCompanySettings"
      :model-value="companies"
      :company-key="companyKey"
      :contacts="contacts"
      :pending-layoffs="pendingLayoffs"
      @switch="switchCompany"
      @close="showCompanySettings = false"
    />
  </div>
</template>
