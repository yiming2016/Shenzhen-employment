<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import type { Company, Contact, PendingLayoff } from '../../../core/business';
import {
  beginDragLock,
  clampToRect,
  endDragLock,
  moveFakeCursor,
  moveRowToPoint,
} from '../dragLock';

const props = defineProps<{
  modelValue: Company[];
  companyKey: string;
  contacts: Contact[];
  pendingLayoffs: PendingLayoff[];
}>();
const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'switch', id: string): void;
}>();

const newName = ref('');
const searchText = ref('');
const sortMode = ref<'custom' | 'alpha'>(loadSortMode());
const alphaAsc = ref(true);
const contextMenu = ref<{ x: number; y: number; visible: boolean }>({
  x: 0,
  y: 0,
  visible: false,
});
const rowMenu = ref<{ x: number; y: number; visible: boolean; companyId: string | null }>({
  x: 0,
  y: 0,
  visible: false,
  companyId: null,
});
const deleteConfirmId = ref<string | null>(null);
const switchConfirmId = ref<string | null>(null);
const showNameToast = ref(false);
const draggingId = ref<string | null>(null);
const dragOverId = ref<string | null>(null);
const listRef = ref<HTMLElement | null>(null);
const exportMsg = ref('');
let justDragged = false;
let pressTimer: ReturnType<typeof setTimeout> | null = null;
let pressed = false;

function loadSortMode(): 'custom' | 'alpha' {
  try {
    const raw = localStorage.getItem('companySortMode');
    if (raw === 'alpha' || raw === 'custom') return raw;
  } catch {
    // 使用默认
  }
  return 'custom';
}

function persistSortMode() {
  try {
    localStorage.setItem('companySortMode', sortMode.value);
  } catch {
    // 保存失败不影响使用
  }
}

const sortedList = computed(() => {
  let list = [...props.modelValue];
  const q = searchText.value.trim();
  if (q) list = list.filter((c) => c.name.includes(q));
  if (sortMode.value === 'alpha') {
    const dir = alphaAsc.value ? 1 : -1;
    list.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN') * dir);
  }
  return list;
});

function add() {
  const n = newName.value.trim();
  if (!n) {
    showNameToast.value = true;
    setTimeout(() => {
      showNameToast.value = false;
    }, 3000);
    return;
  }
  props.modelValue.push({ id: crypto.randomUUID(), name: n });
  newName.value = '';
}

function askDelete(id: string) {
  deleteConfirmId.value = id;
}

function confirmDelete() {
  const id = deleteConfirmId.value;
  if (!id) return;
  const idx = props.modelValue.findIndex((c) => c.id === id);
  if (idx >= 0) props.modelValue.splice(idx, 1);
  deleteConfirmId.value = null;
}

function askSwitch(id: string) {
  if (justDragged) return;
  if (id === props.companyKey) return;
  switchConfirmId.value = id;
}

function confirmSwitch() {
  const id = switchConfirmId.value;
  if (!id) return;
  emit('switch', id);
  switchConfirmId.value = null;
}

function toggleAlpha() {
  if (sortMode.value !== 'alpha') {
    sortMode.value = 'alpha';
    alphaAsc.value = true;
  } else {
    alphaAsc.value = !alphaAsc.value;
  }
  persistSortMode();
}

function setSort(mode: 'custom' | 'alpha') {
  sortMode.value = mode;
  persistSortMode();
  closeContextMenu();
}

function openContextMenu(event: MouseEvent) {
  const target = event.target as HTMLElement;
  if (
    target.closest('.company-row') ||
    target.closest('input') ||
    target.closest('button')
  ) {
    return;
  }
  contextMenu.value = { x: event.clientX, y: event.clientY, visible: true };
}

function openRowMenu(event: MouseEvent, id: string) {
  contextMenu.value.visible = false;
  rowMenu.value = { x: event.clientX, y: event.clientY, visible: true, companyId: id };
}

function closeMenus() {
  contextMenu.value.visible = false;
  rowMenu.value.visible = false;
}

function companyName(id: string | null): string {
  if (!id) return '';
  return props.modelValue.find((c) => c.id === id)?.name ?? '';
}

// ---- 行拖动排序（长按选中后指针锁死在框内，松开才恢复） ----
function onRowMouseDown(event: MouseEvent, id: string) {
  if (event.button !== 0) return;
  if (sortMode.value !== 'custom') return;
  const target = event.target as HTMLElement;
  if (target.closest('button')) return;
  if (pressTimer) clearTimeout(pressTimer);
  pressed = true;
  pressTimer = setTimeout(() => {
    draggingId.value = id;
    beginDragLock(event.clientX, event.clientY);
  }, 175);
}

function onRowMouseMove(event: MouseEvent) {
  if (!pressed || !draggingId.value) return;
  const box = listRef.value;
  if (!box) return;
  const rect = box.getBoundingClientRect();
  const pt = clampToRect(event.clientX, event.clientY, rect);
  moveFakeCursor(pt.x, pt.y);
  moveRowToPoint(
    props.modelValue,
    draggingId.value,
    box,
    pt.x,
    pt.y,
    '.company-row[data-id]',
  );
}

function onRowMouseUp() {
  if (draggingId.value) {
    justDragged = true;
    setTimeout(() => {
      justDragged = false;
    }, 0);
  }
  pressed = false;
  if (pressTimer) {
    clearTimeout(pressTimer);
    pressTimer = null;
  }
  draggingId.value = null;
  dragOverId.value = null;
  endDragLock();
}

function cancelDrag() {
  pressed = false;
  if (pressTimer) {
    clearTimeout(pressTimer);
    pressTimer = null;
  }
  draggingId.value = null;
  dragOverId.value = null;
  endDragLock();
}

async function exportCompany(id: string | null) {
  const company = props.modelValue.find((c) => c.id === id);
  if (!company) return;
  const data = {
    company,
    contacts: props.contacts.filter((c) => c.companyId === id),
    pendingLayoffs: props.pendingLayoffs.filter((p) => p.companyId === id),
  };
  if (window.api) {
    const ok = await window.api.saveJsonFile(
      JSON.stringify(data, null, 2),
      `${company.name}.json`,
    );
    exportMsg.value = ok ? `已导出：${company.name}` : '已取消导出';
    setTimeout(() => {
      exportMsg.value = '';
    }, 3000);
  }
  closeMenus();
}

onMounted(() => {
  document.addEventListener('click', closeMenus);
  window.addEventListener('blur', cancelDrag);
  document.addEventListener('mousemove', onRowMouseMove);
  document.addEventListener('mouseup', onRowMouseUp);
});
onBeforeUnmount(() => {
  document.removeEventListener('click', closeMenus);
  window.removeEventListener('blur', cancelDrag);
  document.removeEventListener('mousemove', onRowMouseMove);
  document.removeEventListener('mouseup', onRowMouseUp);
});
</script>

<template>
  <div class="modal-mask">
    <div class="modal-card company-modal" @contextmenu.prevent="openContextMenu">
      <div class="modal-head">
        <h2>公司管理</h2>
        <button type="button" class="modal-close" title="关闭" @click="emit('close')">
          ❌
        </button>
      </div>

      <div class="add-row">
        <input v-model="newName" class="company-name-input" type="text" placeholder="公司名称" />
        <button class="primary" @click="add">添加公司</button>
      </div>

      <div class="company-toolbar">
        <button
          type="button"
          class="company-sort-btn"
          title="点击按首字母排序，再次点击切换正序/逆序"
          @click="toggleAlpha"
        >
          公司名称{{ sortMode === 'alpha' ? (alphaAsc ? ' ↑' : ' ↓') : '' }}
        </button>
        <input
          v-model="searchText"
          class="company-search"
          type="text"
          placeholder="搜索公司"
        />
      </div>
      <p v-if="exportMsg" class="note" style="color: var(--green); margin: 4px 0 8px">
        {{ exportMsg }}
      </p>

      <div
        ref="listRef"
        class="company-list"
        :class="{ dragging: !!draggingId }"
        @contextmenu.prevent="openContextMenu"
      >
        <div
          v-for="c in sortedList"
          :key="c.id"
          :data-id="c.id"
          class="company-row"
          :class="{
            selected: c.id === companyKey,
            'drag-over': dragOverId === c.id,
            'is-dragging': draggingId === c.id,
          }"
          @click="askSwitch(c.id)"
          @mousedown="onRowMouseDown($event, c.id)"
          @contextmenu.stop.prevent="openRowMenu($event, c.id)"
        >
          <span
            v-if="sortMode === 'custom'"
            class="company-drag"
            title="拖动排序（自定义排序）"
            @click.stop
          >
            ⠿
          </span>
          <span class="company-row-name">{{ c.name }}</span>
          <button class="danger" @click.stop="askDelete(c.id)">删除</button>
        </div>
        <p v-if="!sortedList.length" class="note" style="padding: 10px">
          没有匹配的公司。
        </p>
      </div>

      <p class="note" style="margin-top: 8px">
        修改即时生效，关闭后自动保存。右键空白处可选择排序方式。
      </p>

      <div
        v-if="contextMenu.visible"
        class="context-menu"
        :style="{ left: contextMenu.x + 'px', top: contextMenu.y + 'px' }"
        @click.stop
      >
        <button
          type="button"
          :class="{ active: sortMode === 'alpha' }"
          @click="setSort('alpha')"
        >
          首字母排序
        </button>
        <button
          type="button"
          :class="{ active: sortMode === 'custom' }"
          @click="setSort('custom')"
        >
          自定义排序
        </button>
      </div>

      <div
        v-if="rowMenu.visible"
        class="context-menu"
        :style="{ left: rowMenu.x + 'px', top: rowMenu.y + 'px' }"
        @click.stop
      >
        <button type="button" @click="exportCompany(rowMenu.companyId)">
          导出公司数据
        </button>
      </div>

      <div v-if="deleteConfirmId" class="confirm-mask">
        <div class="confirm-card">
          <p class="confirm-danger-text">确认删除公司「{{ companyName(deleteConfirmId) }}」？</p>
          <p class="note">删除后该公司的人员与待辞退数据仍会保留在本地。</p>
          <div class="actions">
            <button @click="deleteConfirmId = null">取消</button>
            <button class="danger" @click="confirmDelete">确认</button>
          </div>
        </div>
      </div>

      <div v-if="switchConfirmId" class="confirm-mask">
        <div class="confirm-card">
          <p>切换到公司「{{ companyName(switchConfirmId) }}」？</p>
          <div class="actions">
            <button @click="switchConfirmId = null">取消</button>
            <button class="primary" @click="confirmSwitch">确认切换</button>
          </div>
        </div>
      </div>

      <div v-if="showNameToast" class="center-toast">
        <span class="center-toast-text">请填写公司名称</span>
      </div>
    </div>
  </div>
</template>
