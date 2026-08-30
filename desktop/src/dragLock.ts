/**
 * 拖动排序的"框内锁死"辅助。
 * 长按进入拖动后，把指针位置钳制在列表框内（真实光标隐藏，显示虚拟光标），
 * 指针看起来被锁死在框内，无法移出；松开鼠标后恢复。
 */

let fakeEl: HTMLDivElement | null = null;
let locked = false;

export function beginDragLock(x = 0, y = 0): void {
  if (locked) return;
  locked = true;
  document.body.classList.add('drag-lock');
  fakeEl = document.createElement('div');
  fakeEl.className = 'drag-fake-cursor';
  document.body.appendChild(fakeEl);
  moveFakeCursor(x, y);
}

export function endDragLock(): void {
  locked = false;
  document.body.classList.remove('drag-lock');
  if (fakeEl) {
    fakeEl.remove();
    fakeEl = null;
  }
}

export function moveFakeCursor(x: number, y: number): void {
  if (!fakeEl) return;
  fakeEl.style.transform = `translate(${x}px, ${y}px)`;
}

/** 把坐标钳制在矩形框内（框外坐标压到边界） */
export function clampToRect(
  x: number,
  y: number,
  rect: DOMRect,
): { x: number; y: number } {
  return {
    x: Math.min(Math.max(x, rect.left), rect.right),
    y: Math.min(Math.max(y, rect.top), rect.bottom),
  };
}

/**
 * 把拖动中的行移动到指针所在（或最近）的行位置。
 * 指针在框内时按所在行移动；在边界外时按钳制点找最近的行。
 */
export function moveRowToPoint<T extends { id: string }>(
  arr: T[],
  draggingId: string,
  container: HTMLElement | null,
  x: number,
  y: number,
  rowSelector = 'tr[data-id]',
): void {
  if (!container) return;
  const el = document.elementFromPoint(x, y) as HTMLElement | null;
  const row = el ? (el.closest(rowSelector) as HTMLElement | null) : null;
  let targetId: string | null = null;
  if (row && container.contains(row)) {
    targetId = row.dataset.id ?? null;
  } else {
    const rows = [...container.querySelectorAll<HTMLElement>(rowSelector)];
    if (!rows.length) return;
    let best: HTMLElement = rows[0];
    let bestDist = Infinity;
    for (const r of rows) {
      const rect = r.getBoundingClientRect();
      const center = rect.top + rect.height / 2;
      const d = Math.abs(center - y);
      if (d < bestDist) {
        bestDist = d;
        best = r;
      }
    }
    targetId = best.dataset.id ?? null;
  }
  if (!targetId || targetId === draggingId) return;
  const fromIdx = arr.findIndex((p) => p.id === draggingId);
  const toIdx = arr.findIndex((p) => p.id === targetId);
  if (fromIdx < 0 || toIdx < 0 || fromIdx === toIdx) return;
  const [moved] = arr.splice(fromIdx, 1);
  arr.splice(toIdx, 0, moved);
}
