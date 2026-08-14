<script setup lang="ts">
import { reactive, ref, toRaw, watch } from 'vue';
import type { InsuranceParams } from '../../../core/types';
import RateInput from './RateInput.vue';
import BasisLinks from './BasisLinks.vue';

const props = defineProps<{ params: InsuranceParams }>();
const emit = defineEmits<{
  (e: 'save', params: InsuranceParams): void;
  (e: 'reset'): void;
}>();

// 用 toRaw 取出原始对象再克隆，避免克隆 Vue 响应式代理报错
const draft = reactive(structuredClone(toRaw(props.params)));
const savedTip = ref(false);

// 外部重置后重新同步草稿
watch(
  () => props.params,
  (p) => {
    Object.assign(draft, structuredClone(toRaw(p)));
  },
  { deep: true },
);

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
    <section class="card">
      <h2>参数版本</h2>
      <div class="version">
        <input v-model="draft.version" type="text" />
      </div>
      <BasisLinks :links="draft.sourceBySection.minimumWage" editable />
      <BasisLinks :links="draft.sourceBySection.averageWage" editable />
      <div class="param-grid">
        <label class="field">
          <span>最低工资（元/月）</span>
          <input v-model.number="draft.minimumWage" type="number" min="0" />
        </label>
        <label class="field">
          <span>城镇非私营平均工资（元/年）</span>
          <input v-model.number="draft.averageWage.urbanNonPrivate" type="number" min="0" />
        </label>
        <label class="field">
          <span>城镇非私营（在岗）平均工资（元/年）</span>
          <input v-model.number="draft.averageWage.urbanNonPrivateOnPost" type="number" min="0" />
        </label>
        <label class="field">
          <span>城镇私营平均工资（元/年）</span>
          <input v-model.number="draft.averageWage.urbanPrivate" type="number" min="0" />
        </label>
      </div>
    </section>

    <section class="card">
      <div class="card-head">
        <h2>养老</h2>
        <div class="period-fields">
          <label class="mini">
            企业职工
            <input type="date" v-model="draft.validity.pension.enterpriseWorkersStart" /> ~
            <input type="date" v-model="draft.validity.pension.enterpriseWorkersEnd" />
          </label>
          <label class="mini">
            机关事业单位
            <input type="date" v-model="draft.validity.pension.governmentOrgStart" /> ~
            <input type="date" v-model="draft.validity.pension.governmentOrgEnd" />
          </label>
          <label class="mini">
            发布时间
            <input type="date" v-model="draft.validity.pension.publishDate" />
          </label>
        </div>
      </div>
      <BasisLinks :links="draft.sourceBySection.pension" editable />
      <div class="param-grid">
        <label class="field">
          <span>个人费率（职工）</span>
          <RateInput v-model="draft.pension.personalRate" />
        </label>
        <label class="field">
          <span>公司费率（深户）</span>
          <RateInput v-model="draft.pension.companyRateDeep" />
        </label>
        <label class="field">
          <span>公司费率（非深户）</span>
          <RateInput v-model="draft.pension.companyRateNonDeep" />
        </label>
        <label class="field">
          <span>灵活就业费率（深户）</span>
          <RateInput v-model="draft.pension.flexibleRateDeep" />
        </label>
        <label class="field">
          <span>灵活就业费率（非深户）</span>
          <RateInput v-model="draft.pension.flexibleRateNonDeep" />
        </label>
        <label class="field">
          <span>缴费基数下限（元）</span>
          <input v-model.number="draft.pension.baseMin" type="number" min="0" />
        </label>
        <label class="field">
          <span>缴费基数上限（元）</span>
          <input v-model.number="draft.pension.baseMax" type="number" min="0" />
        </label>
      </div>
    </section>

    <section class="card">
      <div class="card-head">
        <h2>医保</h2>
        <div class="period-fields">
          <label class="mini">
            <span class="period-label">有效期</span>
            <input type="date" v-model="draft.validity.medical.start" /> ~
            <input type="date" v-model="draft.validity.medical.end" />
          </label>
          <label class="mini">
            发布时间
            <input type="date" v-model="draft.validity.medical.publishDate" />
          </label>
        </div>
      </div>
      <BasisLinks :links="draft.sourceBySection.medical" editable />
      <div class="param-grid">
        <label class="field">
          <span>一档个人费率</span>
          <RateInput v-model="draft.medical.tier1PersonalRate" />
        </label>
        <label class="field">
          <span>一档公司费率</span>
          <RateInput v-model="draft.medical.tier1CompanyRate" />
        </label>
        <label class="field">
          <span>二档个人费率</span>
          <RateInput v-model="draft.medical.tier2PersonalRate" />
        </label>
        <label class="field">
          <span>二档公司费率</span>
          <RateInput v-model="draft.medical.tier2CompanyRate" />
        </label>
        <label class="field">
          <span>灵活就业个人费率</span>
          <RateInput v-model="draft.medical.flexibleRate" />
        </label>
        <label class="field">
          <span>缴费基数下限（元）</span>
          <input v-model.number="draft.medical.baseMin" type="number" min="0" />
        </label>
        <label class="field">
          <span>缴费基数上限（元）</span>
          <input v-model.number="draft.medical.baseMax" type="number" min="0" />
        </label>
      </div>
    </section>

    <section class="card">
      <div class="card-head">
        <h2>生育</h2>
        <div class="period-fields">
          <label class="mini">
            <span class="period-label">有效期</span>
            <input type="date" v-model="draft.validity.maternity.start" /> ~
            <input type="date" v-model="draft.validity.maternity.end" />
          </label>
          <label class="mini">
            发布时间
            <input type="date" v-model="draft.validity.maternity.publishDate" />
          </label>
        </div>
      </div>
      <BasisLinks :links="draft.sourceBySection.maternity" editable />
      <div class="param-grid">
        <label class="field">
          <span>公司费率（个人不缴）</span>
          <RateInput v-model="draft.maternity.companyRate" />
        </label>
        <label class="field">
          <span>缴费基数下限（元）</span>
          <input v-model.number="draft.maternity.baseMin" type="number" min="0" />
        </label>
        <label class="field">
          <span>缴费基数上限（元）</span>
          <input v-model.number="draft.maternity.baseMax" type="number" min="0" />
        </label>
      </div>
    </section>

    <section class="card">
      <div class="card-head">
        <h2>失业</h2>
        <div class="period-fields">
          <label class="mini">
            <span class="period-label">有效期</span>
            <input type="date" v-model="draft.validity.unemployment.start" /> ~
            <input type="date" v-model="draft.validity.unemployment.end" />
          </label>
          <label class="mini">
            发布时间
            <input type="date" v-model="draft.validity.unemployment.publishDate" />
          </label>
        </div>
      </div>
      <BasisLinks :links="draft.sourceBySection.unemployment" editable />
      <div class="param-grid">
        <label class="field">
          <span>个人费率（职工）</span>
          <RateInput v-model="draft.unemployment.personalRate" />
        </label>
        <label class="field">
          <span>公司费率（职工）</span>
          <RateInput v-model="draft.unemployment.companyRate" />
        </label>
        <label class="field">
          <span>灵活就业个人费率</span>
          <RateInput v-model="draft.unemployment.flexibleRate" />
        </label>
        <label class="field">
          <span>缴费基数上限（元）</span>
          <input v-model.number="draft.unemployment.baseMax" type="number" min="0" />
        </label>
      </div>
      <p class="note">
        失业缴费基数下限 = 最低工资，修改最低工资后自动同步，无需单独设置。
        Excel 公式：失业上限 = 3 × 城镇非私营平均工资 = 3 × 191367 = 574101（上限可修改）。
      </p>
    </section>

    <section class="card">
      <div class="card-head">
        <h2>工伤（个人不缴）</h2>
        <div class="period-fields">
          <label class="mini">
            <span class="period-label">有效期</span>
            <input type="date" v-model="draft.validity.injury.start" /> ~
            <input type="date" v-model="draft.validity.injury.end" />
          </label>
          <label class="mini">
            发布时间
            <input type="date" v-model="draft.validity.injury.publishDate" />
          </label>
        </div>
      </div>
      <BasisLinks :links="draft.sourceBySection.injury" editable />
      <div class="injury-grid">
        <div v-for="(rate, i) in draft.injury.companyRates" :key="i" class="injury-item">
          <span class="injury-class-label">第{{ i + 1 }}类</span>
          <textarea
            v-model="draft.injury.industryNames[i]"
            class="injury-name-input"
            rows="3"
          ></textarea>
          <RateInput v-model="draft.injury.companyRates[i]" />
        </div>
      </div>
    </section>

    <section class="card">
      <div class="card-head">
        <h2>公积金</h2>
        <div class="period-fields">
          <label class="mini">
            <span class="period-label">有效期</span>
            <input type="date" v-model="draft.validity.housingFund.start" /> ~
            <input type="date" v-model="draft.validity.housingFund.end" />
          </label>
          <label class="mini">
            发布时间
            <input type="date" v-model="draft.validity.housingFund.publishDate" />
          </label>
          <span class="note">{{ draft.validity.housingFund.note }}</span>
        </div>
      </div>
      <BasisLinks
        :links="draft.sourceBySection.housingFund"
        fallback="公积金比例由单位自行确定（默认 5%）"
        editable
      />
      <div class="param-grid">
        <label class="field">
          <span>个人比例（默认 5%）</span>
          <RateInput v-model="draft.housingFund.personalRate" />
        </label>
        <label class="field">
          <span>公司比例（默认 5%）</span>
          <RateInput v-model="draft.housingFund.companyRate" />
        </label>
      </div>
    </section>

    <section class="actions">
      <button class="primary" @click="save">保存参数</button>
      <button @click="reset">恢复默认</button>
      <span v-if="savedTip" class="saved-tip">已保存 ✓</span>
    </section>
  </div>
</template>
