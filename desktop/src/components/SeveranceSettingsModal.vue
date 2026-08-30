<script setup lang="ts">
import { reactive, toRaw, watch } from 'vue';
import type { SeveranceDefaults } from './SeverancePanel.vue';

const props = defineProps<{ modelValue: SeveranceDefaults }>();
const emit = defineEmits<{
  (e: 'save', value: SeveranceDefaults): void;
  (e: 'close'): void;
}>();

const draft = reactive(structuredClone(toRaw(props.modelValue)));

watch(
  () => props.modelValue,
  (v) => Object.assign(draft, structuredClone(toRaw(v))),
  { deep: true },
);

function save() {
  emit('save', structuredClone(toRaw(draft)));
  emit('close');
}
</script>

<template>
  <div class="modal-mask">
    <div class="modal-card">
      <div class="modal-head">
        <h2>赔偿默认设置</h2>
        <button type="button" class="modal-close" title="关闭" @click="emit('close')">
          ❌
        </button>
      </div>
      <div class="param-grid">
        <label class="field">
          <span>默认月平均工资（元）</span>
          <input v-model.number="draft.monthlyWage" type="number" min="0" step="0.01" />
        </label>
        <label class="field">
          <span>默认工作年限（年）</span>
          <input v-model.number="draft.years" type="number" min="0" step="0.5" />
        </label>
      </div>
      <label class="checkbox" style="margin-top: 10px">
        <input type="checkbox" v-model="draft.useCap" />
        默认启用 3 倍封顶 + 12 年上限
      </label>
      <div class="actions">
        <button class="primary" @click="save">保存</button>
      </div>
    </div>
  </div>
</template>
