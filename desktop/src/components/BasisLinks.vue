<script setup lang="ts">
import type { SourceLink } from '../../../core/types';

const props = withDefaults(
  defineProps<{
    links: SourceLink[];
    fallback?: string;
    editable?: boolean;
  }>(),
  {
    fallback: '',
    editable: false,
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
  props.links.push({ name: '新依据', url: 'https://', publishDate: '' });
}

function removeLink(index: number) {
  props.links.splice(index, 1);
}
</script>

<template>
  <div class="basis">
    <template v-if="editable">
      <div v-if="links.length" class="basis-grid">
        <span class="basis-label">依据：</span>
        <span></span>
        <span class="basis-publish-header">发布时间</span>
        <span></span>
        <span></span>
        <template v-for="(s, i) in links" :key="i">
          <input v-model="s.name" class="basis-name-input" type="text" placeholder="依据名称" />
          <input v-model="s.url" class="basis-url-input" type="text" placeholder="https://..." />
          <input v-model="s.publishDate" class="basis-date-input" type="date" />
          <button type="button" class="basis-visit" title="在浏览器中打开该依据" @click="openLink(s.url)">
            访问
          </button>
          <button type="button" class="basis-del" title="删除该依据" @click="removeLink(i)">
            删除
          </button>
        </template>
      </div>
      <button type="button" class="basis-add" @click="addLink">+ 添加依据</button>
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
