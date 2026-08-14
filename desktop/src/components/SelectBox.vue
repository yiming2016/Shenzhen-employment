<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';

interface SelectOption {
  value: number;
  label: string;
}

const props = withDefaults(
  defineProps<{
    modelValue: number;
    options: SelectOption[];
    placeholder?: string;
  }>(),
  {
    placeholder: '请选择',
  },
);

const emit = defineEmits<{ (e: 'update:modelValue', value: number): void }>();

const open = ref(false);
const root = ref<HTMLElement | null>(null);

const selected = computed(() =>
  props.options.find((o) => o.value === props.modelValue),
);

function toggle() {
  open.value = !open.value;
}

function choose(option: SelectOption) {
  emit('update:modelValue', option.value);
  open.value = false;
}

function onDocumentClick(event: MouseEvent) {
  if (root.value && !root.value.contains(event.target as Node)) {
    open.value = false;
  }
}

onMounted(() => document.addEventListener('click', onDocumentClick));
onBeforeUnmount(() => document.removeEventListener('click', onDocumentClick));
</script>

<template>
  <div ref="root" class="select-box">
    <button type="button" class="select-box-display" @click.stop="toggle">
      <span class="select-box-text">{{ selected ? selected.label : placeholder }}</span>
      <span class="select-box-arrow">▼</span>
    </button>
    <div v-if="open" class="select-box-panel">
      <button
        v-for="opt in options"
        :key="opt.value"
        type="button"
        class="select-box-option"
        :class="{ selected: opt.value === modelValue }"
        @click="choose(opt)"
      >
        {{ opt.label }}
      </button>
    </div>
  </div>
</template>
