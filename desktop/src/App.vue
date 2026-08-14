<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { DEFAULT_PARAMS } from '../../core/params';
import type { InsuranceParams, SourceLink } from '../../core/types';
import CalculatorPanel from './components/CalculatorPanel.vue';
import ParamsPanel from './components/ParamsPanel.vue';

const tab = ref<'calc' | 'params' | 'about'>('calc');
const loaded = ref(false);
const params = ref<InsuranceParams>(structuredClone(DEFAULT_PARAMS));

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

onMounted(async () => {
  const saved = window.api ? await window.api.loadParams() : null;
  if (saved && typeof saved === 'object') {
    params.value = mergeParams(DEFAULT_PARAMS, saved as Record<string, unknown>);
  }
  loaded.value = true;
});

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
  if (window.api) {
    await window.api.saveParams(p);
  }
}

async function resetParams() {
  params.value = structuredClone(DEFAULT_PARAMS);
  if (window.api) {
    await window.api.resetParams();
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
      <h1>深圳社保成本计算器</h1>
      <nav>
        <button :class="{ active: tab === 'calc' }" @click="tab = 'calc'">试算</button>
        <button :class="{ active: tab === 'params' }" @click="tab = 'params'">政策参数</button>
        <button :class="{ active: tab === 'about' }" @click="tab = 'about'">说明与来源</button>
      </nav>
    </header>

    <main v-if="loaded">
      <CalculatorPanel v-if="tab === 'calc'" :params="params" />
      <ParamsPanel
        v-else-if="tab === 'params'"
        :params="params"
        @save="saveParams"
        @reset="resetParams"
      />
      <section v-else class="card">
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
    </main>
  </div>
</template>
