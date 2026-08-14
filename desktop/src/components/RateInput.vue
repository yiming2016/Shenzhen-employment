<script setup lang="ts">
/** 百分比输入框：界面显示 8，实际值是 0.08 */
defineProps<{ modelValue: number }>();
const emit = defineEmits<{ (e: 'update:modelValue', value: number): void }>();

function onInput(event: Event) {
  const value = parseFloat((event.target as HTMLInputElement).value);
  emit('update:modelValue', Number.isFinite(value) ? value / 100 : 0);
}
</script>

<template>
  <span class="rate-input">
    <input
      type="number"
      step="0.01"
      min="0"
      :value="Number((modelValue * 100).toFixed(2))"
      @input="onInput"
    />
    <span class="rate-suffix">%</span>
  </span>
</template>
