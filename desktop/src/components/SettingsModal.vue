<script setup lang="ts">
import { computed, reactive, toRaw, watch } from 'vue';
import type {
  AppSettings,
  InjuryClass,
  InsuranceParams,
} from '../../../core/types';
import RateInput from './RateInput.vue';
import SelectBox from './SelectBox.vue';

const props = defineProps<{
  modelValue: AppSettings;
  params: InsuranceParams;
}>();
const emit = defineEmits<{
  (e: 'save', value: AppSettings): void;
  (e: 'close'): void;
}>();

const draft = reactive(structuredClone(toRaw(props.modelValue)));

const injuryOptions = computed(() =>
  props.params.injury.industryNames.map((name, i) => ({
    value: i + 1,
    label: `第${i + 1}类：${name}`,
  })),
);

// 公积金比例下拉选项
const housingCompanyOptions = [0, 5, 6, 7, 8, 9, 10, 11, 12];
const housingPersonalOptions = computed(() => {
  const c = Math.round(draft.housingFund.employee.companyRate * 100);
  if (c <= 0) return [0];
  const opts: number[] = [];
  for (let v = c; v <= 12; v++) opts.push(v);
  return opts;
});
const housingFlexibleOptions = Array.from({ length: 25 }, (_, i) => i);

// 职工：个人比例 ≥ 公司比例，且最低 5%；只有公司比例为 0 时个人比例才可为 0
function employeePersonalMin(company: number): number {
  return company <= 0 ? 0 : Math.max(0.05, company);
}
watch(
  () => draft.housingFund.employee.companyRate,
  (c) => {
    if (c <= 0) {
      draft.housingFund.employee.personalRate = 0;
    } else {
      const min = employeePersonalMin(c);
      if (draft.housingFund.employee.personalRate < min) {
        draft.housingFund.employee.personalRate = min;
      }
    }
  },
  { immediate: true },
);
watch(
  () => draft.housingFund.employee.personalRate,
  (p) => {
    const min = employeePersonalMin(draft.housingFund.employee.companyRate);
    if (p < min) {
      draft.housingFund.employee.personalRate = min;
    }
  },
);

watch(
  () => props.modelValue,
  (v) => {
    Object.assign(draft, structuredClone(toRaw(v)));
  },
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
        <h2>设置</h2>
        <button type="button" class="modal-close" title="关闭" @click="emit('close')">
          ❌
        </button>
      </div>

      <h3>计算默认值</h3>
      <div class="param-grid">
        <label class="field">
          <span>默认参保类型</span>
          <div class="segmented">
            <button
              type="button"
              :class="{ active: draft.calculator.participationType === 'employee' }"
              @click="draft.calculator.participationType = 'employee'"
            >
              职工
            </button>
            <button
              type="button"
              :class="{ active: draft.calculator.participationType === 'flexible' }"
              @click="draft.calculator.participationType = 'flexible'"
            >
              灵活就业
            </button>
          </div>
        </label>
        <label class="field">
          <span>默认户籍</span>
          <div class="segmented">
            <button
              type="button"
              :class="{ active: draft.calculator.household === 'deep' }"
              @click="draft.calculator.household = 'deep'"
            >
              深户
            </button>
            <button
              type="button"
              :class="{ active: draft.calculator.household === 'non-deep' }"
              @click="draft.calculator.household = 'non-deep'"
            >
              非深户
            </button>
          </div>
        </label>
        <label class="field">
          <span>默认医保档次</span>
          <select
            v-model.number="draft.calculator.medicalTier"
            :disabled="draft.calculator.household === 'deep'"
          >
            <option :value="1">一档（个人2% / 公司6%）</option>
            <option :value="2" :disabled="draft.calculator.household === 'deep'">
              二档（个人0.5% / 公司1.5%）
            </option>
          </select>
        </label>
        <label class="field">
          <span>默认工伤行业类别</span>
          <SelectBox
            v-model="draft.calculator.injuryClass"
            :options="injuryOptions"
          />
        </label>
      </div>

      <h3>公积金</h3>
      <div class="param-grid">
        <label class="field">
          <span>职工：默认缴费基数</span>
          <div class="base-row">
            <label class="checkbox">
              <input type="checkbox" v-model="draft.housingFund.employee.followWage" />
              跟随工资
            </label>
            <input
              v-model.number="draft.housingFund.employee.fixedBase"
              type="number"
              min="0"
              step="0.01"
              :disabled="draft.housingFund.employee.followWage"
            />
          </div>
        </label>
        <label class="field">
          <span>职工：公司比例（默认）</span>
          <RateInput
            v-model="draft.housingFund.employee.companyRate"
            :options="housingCompanyOptions"
          />
        </label>
        <label class="field">
          <span>职工：个人比例（默认）</span>
          <RateInput
            v-model="draft.housingFund.employee.personalRate"
            :options="housingPersonalOptions"
          />
        </label>
        <label class="field">
          <span>灵活就业：默认缴费基数</span>
          <div class="base-row">
            <label class="checkbox">
              <input type="checkbox" v-model="draft.housingFund.flexible.followWage" />
              跟随工资
            </label>
            <input
              v-model.number="draft.housingFund.flexible.fixedBase"
              type="number"
              min="0"
              step="0.01"
              :disabled="draft.housingFund.flexible.followWage"
            />
          </div>
        </label>
        <label class="field">
          <span>灵活就业：比例（默认，最高 24%）</span>
          <RateInput v-model="draft.housingFund.flexible.rate" :options="housingFlexibleOptions" />
        </label>
      </div>
      <p v-if="draft.housingFund.employee.personalRate * 100 > 12" class="note housing-warning">
        注意：职工个人比例超过 12% 的部分不能抵扣个人所得税。
      </p>
      <p v-if="draft.housingFund.flexible.rate * 100 > 12" class="note housing-warning">
        注意：灵活就业比例超过 12% 的部分不能抵扣个人所得税。
      </p>
      <p class="note">
        公司比例可为 0 或 5%~12%；个人比例可为 0 或 5%~12%，且不能低于公司比例；
        公司为 0 时个人自动为 0。
      </p>

      <div class="actions">
        <button class="primary" @click="save">保存</button>
      </div>
    </div>
  </div>
</template>
