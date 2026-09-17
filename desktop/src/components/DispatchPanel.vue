<script setup lang="ts">
import { ref } from 'vue';
import DateSegments from './DateSegments.vue';

const contract = ref({
  dispatchUnit: '',
  hostUnit: '',
  employeeName: '',
  termStart: '',
  termEnd: '',
  wage: '',
  jobContent: '',
});
</script>

<template>
  <section class="card dispatch-card">
    <h2>合同</h2>

    <div class="dispatch-contract-grid">
      <label class="field">
        <span>
          派遣单位
          <span class="tip-wrap">
            <span class="tip">ⓘ</span>
            <span class="tip-tip">
              承担<strong>主责</strong><br />
              <strong>注册资金＞200w</strong><br />
              拥有行政许可、固定经营场所、设施
            </span>
          </span>
        </span>
        <input v-model="contract.dispatchUnit" type="text" placeholder="请输入派遣单位" />
      </label>

      <label class="field">
        <span>
          用工单位
          <span class="tip-wrap">
            <span class="tip">ⓘ</span>
            <span class="tip-tip">
              承担<strong>连带责任</strong><br />
              用工数＜10%<br />
              <strong>临时性岗位</strong>：＜6个月<br />
              <strong>辅助性岗位</strong>：为主营业务提供服务<br />
              <strong>替代性岗位</strong>：原员工因【脱产学习、休假等原因】无法工作，可替代的岗位
            </span>
          </span>
        </span>
        <input v-model="contract.hostUnit" type="text" placeholder="请输入用工单位" />
      </label>

      <label class="field">
        <span>人员姓名</span>
        <input v-model="contract.employeeName" type="text" placeholder="请输入人员姓名" />
      </label>

      <label class="field">
        <span>
          期限
          <span class="tip-wrap">
            <span class="tip">ⓘ</span>
            <span class="tip-tip">
              至少2年以上固定期限合同<br />
              按月支付报酬（没工作按最低工资）
            </span>
          </span>
        </span>
        <div class="dispatch-term-range">
          <DateSegments
            v-model="contract.termStart"
            :min-year="2000"
          />
          <span class="dispatch-term-tilde">~</span>
          <DateSegments
            v-model="contract.termEnd"
            :min-year="2000"
          />
        </div>
      </label>

      <label class="field">
        <span>
          工资
          <span class="tip-wrap">
            <span class="tip">ⓘ</span>
            <span class="tip-tip">同岗同酬</span>
          </span>
        </span>
        <input v-model="contract.wage" type="text" placeholder="请输入工资" />
      </label>

      <label class="field dispatch-job-field">
        <span>工作内容</span>
        <textarea v-model="contract.jobContent" rows="4" placeholder="请输入工作内容"></textarea>
      </label>
    </div>
  </section>
</template>
