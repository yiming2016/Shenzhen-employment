<script setup lang="ts">
import { ref } from 'vue';

const contract = ref({
  outsourceUnit: '',
  hostUnit: '',
});
</script>

<template>
  <section class="card dispatch-card">
    <h2>
      《外包/承揽合同》
      <span class="tip-wrap">
        <span class="tip">ⓘ</span>
        <span class="tip-tip">
          依据《<strong>民法典</strong>》<br />
          外包<strong>单位</strong>与<strong>员工</strong>依据《<strong>劳动</strong>法》签订《<strong>劳动</strong>合同》
        </span>
      </span>
    </h2>

    <div class="dispatch-contract-grid">
      <label class="field">
        <span>
          外包单位
          <span class="tip-wrap">
            <span class="tip">ⓘ</span>
            <span class="tip-tip">
              不需承担【2年固定合同、资质门槛】<br />
              必须承担【管理、责任】
            </span>
          </span>
        </span>
        <input v-model="contract.outsourceUnit" type="text" placeholder="请输入外包单位" />
      </label>

      <label class="field">
        <span>
          用工单位
          <span class="tip-wrap">
            <span class="tip">ⓘ</span>
            <span class="tip-tip">
              不需满足【10%人数、临时性、辅助性、替代性、同工同酬、<strong>连带</strong>赔偿】
            </span>
          </span>
        </span>
        <input v-model="contract.hostUnit" type="text" placeholder="请输入用工单位" />
      </label>
    </div>

    <div class="outsource-fake-warning">
      <div class="outsource-fake-title">假外包真派遣</div>
      <div class="outsource-fake-line"><strong>触发条件：</strong>用人单位管理（考核/薪资等）、人头工时计价</div>
      <div class="outsource-fake-line"><strong>处罚：</strong>每人 5k~1w 罚款，补缴社保、加班费、双倍工资、工伤全额赔偿</div>
    </div>
  </section>
</template>
