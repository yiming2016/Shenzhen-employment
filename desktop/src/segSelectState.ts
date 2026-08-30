import { ref } from 'vue';

/** 全局共享：同一时间只允许一个自定义下拉菜单打开 */
export const activeSegKey = ref<string | null>(null);

let nextId = 0;
export function nextSegId(): string {
  nextId += 1;
  return String(nextId);
}
