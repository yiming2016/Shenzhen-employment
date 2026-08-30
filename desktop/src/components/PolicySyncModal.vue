<script setup lang="ts">
import { computed, onMounted, reactive, ref, toRaw, watch } from 'vue';
import { SYNC_SECTIONS, applyRemoteParams } from '../../../core/sync';
import type { InsuranceParams } from '../../../core/types';

export interface PolicySyncSettings {
  url: string;
  /** 启动软件时自动同步 */
  autoSync: boolean;
  /** 平台接口地址（财会公司渠道来源） */
  platformUrl: string;
  sections: Record<string, boolean>;
}

interface ChannelItem {
  id: string;
  name: string;
  logo: string;
  paramsUrl: string;
}

const props = defineProps<{
  modelValue: PolicySyncSettings;
  params: InsuranceParams;
}>();
const emit = defineEmits<{
  (e: 'save', value: PolicySyncSettings): void;
  (e: 'synced', params: InsuranceParams): void;
  (e: 'close'): void;
}>();

const draft = reactive<PolicySyncSettings>({
  url: props.modelValue.url,
  autoSync: props.modelValue.autoSync,
  platformUrl: props.modelValue.platformUrl,
  sections: { ...props.modelValue.sections },
});

const channels = ref<ChannelItem[]>([]);
const provider = ref('');
const busy = ref(false);
const status = ref('');
const statusOk = ref(true);

const providerOptions = computed(() => [
  { key: '', label: '自定义地址' },
  ...channels.value.map((c) => ({ key: 'channel:' + c.id, label: c.name })),
]);

const providerHint = computed(() => {
  if (!provider.value.startsWith('channel:')) return '';
  const ch = channels.value.find((c) => 'channel:' + c.id === provider.value);
  return ch ? `渠道由「${ch.name}」维护，参数地址已自动填入` : '';
});

const providerPlaceholder = computed(() =>
  provider.value.startsWith('channel:') ? '' : 'https://example.com/policy-params.json',
);

const allChecked = computed(() => SYNC_SECTIONS.every((s) => draft.sections[s.key]));

watch(provider, (val) => {
  if (val.startsWith('channel:')) {
    const ch = channels.value.find((c) => 'channel:' + c.id === val);
    if (ch) draft.url = ch.paramsUrl;
  }
});

async function loadChannels() {
  const baseUrl = draft.platformUrl.trim().replace(/\/+$/, '');
  if (!baseUrl) {
    channels.value = [];
    provider.value = '';
    return;
  }
  statusOk.value = true;
  status.value = '正在加载财会公司渠道...';
  try {
    const text = await window.api!.fetchRemote(baseUrl + '/api/public/channels');
    const data = JSON.parse(text);
    channels.value = Array.isArray(data.list) ? data.list : [];
    status.value = channels.value.length
      ? `已加载 ${channels.value.length} 家财会公司`
      : '平台暂无可用渠道';
  } catch (err) {
    channels.value = [];
    statusOk.value = false;
    status.value = `加载渠道失败：${err instanceof Error ? err.message : String(err)}`;
  }
}

function enabledKeys(): string[] {
  return SYNC_SECTIONS.map((s) => s.key).filter((key) => draft.sections[key]);
}

function toggleAll() {
  const next = !allChecked.value;
  for (const s of SYNC_SECTIONS) {
    draft.sections[s.key] = next;
  }
}

function applyRemote(remote: unknown, source: '同步' | '导入') {
  const enabled = enabledKeys();
  const result = applyRemoteParams(toRaw(props.params), remote, enabled);
  if (result.errors.length > 0) {
    statusOk.value = false;
    status.value = `部分板块失败：${result.errors.join('；')}`;
  }
  if (result.updated.length > 0) {
    emit('synced', result.params);
    statusOk.value = true;
    status.value = `${source}成功，已更新：${result.updated.join('、')}`;
  }
  if (result.errors.length === 0 && result.updated.length === 0) {
    statusOk.value = false;
    status.value = '数据里没有可更新的内容';
  }
}

async function sync() {
  const url = draft.url.trim();
  if (!/^https?:\/\//i.test(url)) {
    statusOk.value = false;
    status.value = '请先填写以 http:// 或 https:// 开头的地址';
    return;
  }
  if (enabledKeys().length === 0) {
    statusOk.value = false;
    status.value = '请至少勾选一个允许同步的板块';
    return;
  }

  busy.value = true;
  statusOk.value = true;
  status.value = '正在连接远程地址...';
  emit('save', {
    url,
    autoSync: draft.autoSync,
    platformUrl: draft.platformUrl.trim(),
    sections: { ...draft.sections },
  });
  try {
    const text = await window.api!.fetchRemote(url);
    applyRemote(JSON.parse(text), '同步');
  } catch (err) {
    statusOk.value = false;
    status.value = `连接失败：${err instanceof Error ? err.message : String(err)}`;
  } finally {
    busy.value = false;
  }
}

async function importFile() {
  if (enabledKeys().length === 0) {
    statusOk.value = false;
    status.value = '请至少勾选一个允许导入的板块';
    return;
  }
  if (!window.api) {
    statusOk.value = false;
    status.value = '当前环境不支持选择文件';
    return;
  }
  busy.value = true;
  statusOk.value = true;
  status.value = '正在读取文件...';
  try {
    const text = await window.api.pickJsonFile();
    if (text === null) {
      statusOk.value = true;
      status.value = '已取消选择文件';
      return;
    }
    applyRemote(JSON.parse(text), '导入');
  } catch (err) {
    statusOk.value = false;
    status.value = `导入失败：${err instanceof Error ? err.message : String(err)}`;
  } finally {
    busy.value = false;
  }
}

async function exportConfig() {
  if (!window.api) {
    statusOk.value = false;
    status.value = '当前环境不支持保存文件';
    return;
  }
  const json = JSON.stringify(toRaw(props.params), null, 2);
  const ok = await window.api.saveJsonFile(json, 'policy-params.json');
  statusOk.value = true;
  status.value = ok ? '配置已导出' : '已取消导出';
}

function close() {
  emit('save', {
    url: draft.url.trim(),
    autoSync: draft.autoSync,
    platformUrl: draft.platformUrl.trim(),
    sections: { ...draft.sections },
  });
  emit('close');
}

onMounted(loadChannels);
</script>

<template>
  <div class="modal-mask">
    <div class="modal-card">
      <div class="modal-head">
        <h2>政策参数远程同步</h2>
        <button type="button" class="modal-close" title="关闭" @click="close">
          ❌
        </button>
      </div>
      <p class="note">
        填写平台接口地址后，数据来源会列出已付费开通的财会公司；勾选同步板块后点"立即同步"。
        也可以从本地 JSON 文件导入/导出配置。部署方式见项目 platform/ 目录。
      </p>

      <div class="sync-platform-row">
        <label class="field" style="flex: 1">
          <span>平台接口地址（选填）</span>
          <input
            v-model="draft.platformUrl"
            type="url"
            placeholder="https://api.你的域名.com"
          />
        </label>
        <button type="button" class="sync-refresh" :disabled="busy" @click="loadChannels">
          刷新渠道
        </button>
      </div>

      <div class="sync-url-row">
        <label class="field">
          <span>数据来源</span>
          <select v-model="provider">
            <option v-for="p in providerOptions" :key="p.key" :value="p.key">
              {{ p.label }}
            </option>
          </select>
        </label>
        <input
          v-model="draft.url"
          class="sync-url-input"
          type="url"
          :placeholder="providerPlaceholder"
        />
      </div>
      <p v-if="providerHint" class="note provider-hint">{{ providerHint }}</p>

      <label class="checkbox auto-sync" style="margin-bottom: 12px">
        <input type="checkbox" v-model="draft.autoSync" />
        启动软件自动同步
      </label>

      <div class="sync-head">
        <h3>同步板块</h3>
        <button
          type="button"
          class="sync-toggle-all"
          :class="{ checked: allChecked }"
          :title="allChecked ? '取消全选' : '全选'"
          @click="toggleAll"
        >
          {{ allChecked ? '☑' : '☐' }}
        </button>
      </div>
      <div class="sync-sections">
        <label v-for="s in SYNC_SECTIONS" :key="s.key" class="checkbox">
          <input type="checkbox" v-model="draft.sections[s.key]" />
          {{ s.label }}
        </label>
      </div>

      <p v-if="status" class="note sync-status" :class="{ ok: statusOk, err: !statusOk }">
        {{ status }}
      </p>

      <div class="actions">
        <button :disabled="busy" @click="exportConfig">导出配置</button>
        <button :disabled="busy" @click="importFile">
          {{ busy ? '处理中...' : '导入配置' }}
        </button>
        <button class="primary" :disabled="busy" @click="sync">
          {{ busy ? '处理中...' : '立即同步' }}
        </button>
      </div>
    </div>
  </div>
</template>
