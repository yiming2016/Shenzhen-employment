<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { calculate } from '../../../core/engine';
import type { CalcInput, InsuranceParams, InjuryClass } from '../../../core/types';
import SelectBox from './SelectBox.vue';

const props = defineProps<{ params: InsuranceParams }>();

const wage = ref(5000);
const participationType = ref<'employee' | 'flexible'>('employee');
const household = ref<'deep' | 'non-deep'>('deep');
const medicalTier = ref<1 | 2>(1);
const injuryClass = ref<InjuryClass>(2);

// 深户默认一档、非深户默认二档（可手动改）
watch(household, (h) => {
  medicalTier.value = h === 'deep' ? 1 : 2;
});

const input = computed<CalcInput>(() => ({
  wage: Number(wage.value) || 0,
  participationType: participationType.value,
  household: household.value,
  medicalTier: medicalTier.value,
  injuryClass: injuryClass.value,
}));

const result = computed(() => calculate(input.value, props.params));

const injuryOptions = computed(() =>
  props.params.injury.industryNames.map((name, i) => ({
    value: i + 1,
    label: `第${i + 1}类：${name}`,
  })),
);

/** 当前区间的具体数值范围，如“4,775 ~ 6,733 元” */
const bandText = computed(() => {
  const r = result.value;
  const from = r.bandFrom.toLocaleString('zh-CN');
  const to = r.bandTo === null ? '无上限' : r.bandTo.toLocaleString('zh-CN');
  return `${from} ~ ${to} 元`;
});

/** 悬浮提示：列出全部 6 个工资区间 */
const allBandsTip = computed(() => {
  const p = props.params;
  const rows = [
    ['最低工资~养老下限', `${p.minimumWage.toLocaleString('zh-CN')} ~ ${p.pension.baseMin.toLocaleString('zh-CN')} 元`],
    ['养老下限~医保下限', `${p.pension.baseMin.toLocaleString('zh-CN')} ~ ${p.medical.baseMin.toLocaleString('zh-CN')} 元`],
    ['医保下限~养老上限', `${p.medical.baseMin.toLocaleString('zh-CN')} ~ ${p.pension.baseMax.toLocaleString('zh-CN')} 元`],
    ['养老上限~医保上限', `${p.pension.baseMax.toLocaleString('zh-CN')} ~ ${p.medical.baseMax.toLocaleString('zh-CN')} 元`],
    ['医保上限~失业上限', `${p.medical.baseMax.toLocaleString('zh-CN')} ~ ${p.unemployment.baseMax.toLocaleString('zh-CN')} 元`],
    ['失业上限~无上限', `≥ ${p.unemployment.baseMax.toLocaleString('zh-CN')} 元`],
  ];
  return rows.map(([name, range]) => `${name}：${range}`).join('\n');
});

function fmt(n: number): string {
  return n.toLocaleString('zh-CN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function fmtRate(n: number): string {
  return `${(n * 100).toFixed(2)}%`;
}
</script>

<template>
  <div>
    <section class="card">
      <h2>输入</h2>
      <div class="grid calc-grid">
        <label class="field">
          <span>月工资（元）</span>
          <input v-model.number="wage" class="wage-input" type="number" min="0" step="100" />
        </label>

        <div class="field">
          <span>参保类型</span>
          <div class="segmented">
            <button
              type="button"
              :class="{ active: participationType === 'employee' }"
              @click="participationType = 'employee'"
            >
              职工
            </button>
            <button
              type="button"
              :class="{ active: participationType === 'flexible' }"
              @click="participationType = 'flexible'"
            >
              灵活就业
            </button>
          </div>
        </div>

        <div class="field">
          <span>户籍</span>
          <div class="segmented">
            <button
              type="button"
              :class="{ active: household === 'deep' }"
              @click="household = 'deep'"
            >
              深户
            </button>
            <button
              type="button"
              :class="{ active: household === 'non-deep' }"
              @click="household = 'non-deep'"
            >
              非深户
            </button>
          </div>
        </div>

        <label v-if="participationType === 'employee'" class="field">
          <span>医保档次{{ household === 'deep' ? '（深户仅一档）' : '' }}</span>
          <select v-model.number="medicalTier" :disabled="household === 'deep'">
            <option :value="1">一档（个人2% / 公司6%）</option>
            <option :value="2" :disabled="household === 'deep'">二档（个人0.5% / 公司1.5%）</option>
          </select>
        </label>

        <label v-else class="field">
          <span>医保档次</span>
          <select disabled>
            <option>灵活就业（个人 8%）</option>
          </select>
        </label>
      </div>

      <div class="injury-row">
        <div v-if="participationType === 'employee'" class="field">
          <span>工伤行业类别</span>
          <SelectBox v-model="injuryClass" :options="injuryOptions" />
        </div>
        <p v-else class="note" style="margin-top: 18px">灵活就业不缴纳工伤保险。</p>
      </div>
      <p class="note" style="margin-top: 12px">
        当前工资区间：
        <span class="band">{{ result.bandName }}</span>
        <span class="band-range">（{{ bandText }}）</span>
        <span class="band-help" tabindex="0" aria-label="查看全部工资区间">
          <span class="band-help-icon">ⓘ</span>
          <span class="band-help-tip">{{ allBandsTip }}</span>
        </span>
      </p>
    </section>

    <section class="summary">
      <div class="card">
        <div class="label">个人社保合计（月）</div>
        <div class="value red">{{ fmt(result.personalTotal) }} 元</div>
      </div>
      <div class="card">
        <div class="label">公司社保合计（月）</div>
        <div class="value red">{{ fmt(result.companyTotal) }} 元</div>
      </div>
      <div class="card">
        <div class="label">到手工资（月）</div>
        <div class="value green">{{ fmt(result.netWage) }} 元</div>
      </div>
      <div class="card">
        <div class="label">用工成本（月）</div>
        <div class="value">{{ fmt(result.employmentCost) }} 元</div>
      </div>
    </section>

    <section class="card">
      <h2>明细</h2>
      <table>
        <thead>
          <tr>
            <th>险种</th>
            <th>缴费基数</th>
            <th>个人费率</th>
            <th>个人金额</th>
            <th>公司费率</th>
            <th>公司金额</th>
            <th>备注</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="it in result.items" :key="it.key">
            <td>{{ it.name }}</td>
            <td>{{ fmt(it.base) }}</td>
            <td>{{ fmtRate(it.personalRate) }}</td>
            <td class="red">{{ fmt(it.personalAmount) }}</td>
            <td>{{ fmtRate(it.companyRate) }}</td>
            <td class="red">{{ fmt(it.companyAmount) }}</td>
            <td class="note">{{ it.note || '' }}</td>
          </tr>
          <tr>
            <td><strong>合计</strong></td>
            <td></td>
            <td></td>
            <td><strong class="red">{{ fmt(result.personalTotal) }}</strong></td>
            <td></td>
            <td><strong class="red">{{ fmt(result.companyTotal) }}</strong></td>
            <td></td>
          </tr>
        </tbody>
      </table>
      <p class="note">
        金额按 Excel 公式全精度计算，界面显示四舍五入到 2 位小数；工资低于养老下限时养老按下限缴费，低于医保下限时医保/生育按下限缴费。
      </p>
    </section>
  </div>
</template>
