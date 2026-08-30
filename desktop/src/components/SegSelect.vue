<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { activeSegKey, nextSegId } from '../segSelectState';

/**
 * 自定义下拉：选项以多列网格显示。
 * 打开时可定位到指定选项（如年份卡在 2020）。
 */
const props = defineProps<{
  options: string[];
  modelValue: string;
  columns: number;
  scrollTo?: string;
}>();

const emit = defineEmits<{ (e: 'update:modelValue', v: string): void }>();

const id = nextSegId();

const open = ref(false);
const popupRef = ref<HTMLElement | null>(null);

watch(activeSegKey, (k) => {
  if (k !== String(id)) open.value = false;
});

function toggle() {
  if (open.value) {
    open.value = false;
    if (activeSegKey.value === String(id)) activeSegKey.value = null;
    return;
  }
  open.value = true;
  activeSegKey.value = String(id);
  nextTick(() => {
    if (props.scrollTo && popupRef.value) {
      const target = popupRef.value.querySelector<HTMLElement>(
        `[data-v="${props.scrollTo}"]`,
      );
      if (target) {
        popupRef.value.scrollTop =
          target.offsetTop -
          popupRef.value.clientHeight / 2 +
          target.clientHeight / 2;
      }
    }
  });
}

function pick(v: string) {
  emit('update:modelValue', v);
  open.value = false;
}

function onDocClick(event: MouseEvent) {
  const el = event.target as HTMLElement;
  if (!el.closest('.seg-select')) open.value = false;
}

onMounted(() => document.addEventListener('click', onDocClick));
onBeforeUnmount(() => document.removeEventListener('click', onDocClick));
</script>

<template>
  <div class="seg-select">
    <button type="button" class="seg-trigger" @click.stop="toggle">
      {{ modelValue || '—' }}
    </button>
    <div
      v-if="open"
      ref="popupRef"
      class="seg-popup"
      :style="{ gridTemplateColumns: `repeat(${columns}, 1fr)` }"
    >
      <button
        v-for="o in options"
        :key="o"
        type="button"
        class="seg-option"
        :class="{ selected: o === modelValue }"
        :data-v="o"
        @click.stop="pick(o)"
      >
        {{ o }}
      </button>
    </div>
  </div>
</template>
