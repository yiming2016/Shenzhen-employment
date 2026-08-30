const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFile } = require('child_process');

// 冒烟测试使用独立的用户数据目录，避免污染真实数据
if (process.env.SMOKE_TEST === '1') {
  app.setPath('userData', path.join(os.tmpdir(), `sz-shebao-smoke-${Date.now()}`));
}
// 版本守卫测试：指定独立用户数据目录
if (process.env.SZ_TEST_USERDATA) {
  app.setPath('userData', process.env.SZ_TEST_USERDATA);
}

// 新版本启动时自动关闭旧版本：
// 1) 拿不到单实例锁说明旧版本正在运行 -> 写入退出信号文件
// 2) 旧版本每秒检查该文件，发现后退出并释放锁
// 3) 新版本轮询等待锁释放后继续启动
const quitRequestFile = path.join(app.getPath('userData'), 'quit-request.json');

function watchQuitRequest() {
  try {
    if (fs.existsSync(quitRequestFile)) {
      fs.unlinkSync(quitRequestFile);
      app.quit();
    }
  } catch {
    // 忽略读取失败
  }
}
setInterval(watchQuitRequest, 800);

function startApp() {
  app.whenReady().then(() => {
    createWindow();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });
}

let killedOld = false;
function killOldInstances() {
  if (killedOld) return;
  killedOld = true;
  const ownPid = String(process.pid);
  // 结束其他同名实例（排除自身）
  execFile(
    'tasklist',
    ['/FI', 'IMAGENAME eq 深圳社保计算器.exe', '/FO', 'CSV', '/NH'],
    (_err, stdout) => {
      const lines = stdout.split('\r\n').filter((l) => l.trim());
      for (const line of lines) {
        const parts = line.split('","');
        const pid = parts[1] ? parts[1].replace(/"/g, '') : null;
        if (pid && /^\d+$/.test(pid) && pid !== ownPid) {
          execFile('taskkill', ['/PID', pid, '/F']);
        }
      }
    },
  );
  // 结束旧版便携壳（进程名不同，不会误杀自身）
  execFile('taskkill', ['/IM', 'SZ-Shebao-Calculator-*.exe', '/F']);
}

// ---- 版本守卫：防止旧版本启动并覆盖新版本的数据/界面 ----
const versionMarkerFile = path.join(app.getPath('userData'), 'app-version.json');

function parseVersion(v) {
  return String(v || '')
    .split('.')
    .map((n) => parseInt(n, 10) || 0);
}

function isVersionOlder(a, b) {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) < (pb[i] || 0)) return true;
    if ((pa[i] || 0) > (pb[i] || 0)) return false;
  }
  return false;
}

/**
 * 必须在 killOldInstances 之前执行：
 * 如果本机已使用过更高版本，旧版本立即退出，避免旧版杀掉新版并覆盖数据。
 */
function enforceVersionGuard() {
  if (process.env.SMOKE_TEST === '1') return true;
  try {
    let stored = '';
    if (fs.existsSync(versionMarkerFile)) {
      stored = JSON.parse(fs.readFileSync(versionMarkerFile, 'utf8')).version || '';
    }
    const current = app.getVersion();
    if (stored && isVersionOlder(current, stored)) {
      try {
        fs.writeFileSync(
          path.join(app.getPath('userData'), 'version-blocked.json'),
          JSON.stringify({ blocked: current, newer: stored, at: Date.now() }),
        );
      } catch {
        // 忽略
      }
      if (!process.env.SZ_TEST_USERDATA) {
        try {
          dialog.showMessageBoxSync({
            type: 'warning',
            title: '检测到更新版本',
            message:
              `本机已使用过更新版本 v${stored}，为防止旧版本覆盖你的数据，` +
              `请使用最新版本（当前启动的是旧版本 v${current}）。`,
          });
        } catch {
          // 弹窗失败也直接退出
        }
      }
      app.exit(0);
      return false;
    }
    fs.writeFileSync(
      versionMarkerFile,
      JSON.stringify({ version: current, at: Date.now() }),
    );
  } catch {
    // 标记读写失败不阻断启动
  }
  return true;
}

if (!enforceVersionGuard()) {
  // 旧版本已阻止启动，不再执行后续逻辑
} else if (process.env.SMOKE_TEST !== '1') {
  killOldInstances();
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  // 旧版本正在运行：请求它退出
  try {
    fs.writeFileSync(quitRequestFile, JSON.stringify({ at: Date.now() }));
  } catch {
    // 忽略
  }
  let attempts = 0;
  const retry = setInterval(() => {
    attempts++;
    if (app.requestSingleInstanceLock()) {
      clearInterval(retry);
      startApp();
    } else if (attempts === 12) {
      // 约 2.4 秒后旧版仍不退出，强制结束旧实例
      killOldInstances();
    } else if (attempts > 50) {
      // 等待约 10 秒仍无法获取锁，放弃启动
      clearInterval(retry);
      app.quit();
    }
  }, 200);
} else {
  startApp();
}

/** 用户修改后的参数按地区分别保存在系统用户目录，避免污染程序目录 */
function dataFile(regionKey) {
  const safe = String(regionKey || 'shenzhen').replace(/[^a-zA-Z0-9_-]/g, '');
  return path.join(app.getPath('userData'), `params-${safe}.json`);
}

function loadParams(regionKey) {
  const file = dataFile(regionKey);
  // 兼容旧版本：深圳地区没有新文件时读取旧的 params.json
  if (!fs.existsSync(file) && (regionKey || 'shenzhen') === 'shenzhen') {
    const old = path.join(app.getPath('userData'), 'params.json');
    if (fs.existsSync(old)) {
      try {
        return JSON.parse(fs.readFileSync(old, 'utf8'));
      } catch {
        // 旧文件损坏则继续走默认
      }
    }
  }
  try {
    const raw = fs.readFileSync(file, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function createWindow() {
  const smokeTest = process.env.SMOKE_TEST === '1';
  const win = new BrowserWindow({
    width: 1200,
    height: 920,
    minWidth: 1200,
    minHeight: 640,
    autoHideMenuBar: true,
    show: false,
    title: `社保成本计算器 v${app.getVersion()}`,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // 渲染完成后再显示窗口，避免"打开但空白"
  win.once('ready-to-show', () => {
    if (!smokeTest) win.show();
  });

  // 优先加载已构建的界面；没有构建产物时才走 Vite 开发服务器
  const distIndex = path.join(__dirname, 'dist', 'index.html');
  if (fs.existsSync(distIndex)) {
    win.loadFile(distIndex);
  } else {
    win.loadURL('http://localhost:5173');
  }

  if (smokeTest) {
    win.webContents.on('did-finish-load', async () => {
      // 等 Vue 挂载完成再操作界面
      await new Promise((resolve) => setTimeout(resolve, 1200));
      if (process.env.SMOKE_TAB === 'params') {
        await win.webContents.executeJavaScript(
          `[...document.querySelectorAll('nav button')]
            .find((b) => b.innerText.includes('政策参数'))
            .click()`,
        );
        await new Promise((resolve) => setTimeout(resolve, 300));
        if (process.env.SMOKE_PARAMS_DIAG) {
          const diag = await win.webContents.executeJavaScript(`
            JSON.stringify({
              firstFieldDirection: getComputedStyle(
                document.querySelector('.param-group .field'),
              ).flexDirection,
              firstFieldJustify: getComputedStyle(
                document.querySelector('.param-group .field'),
              ).justifyContent,
              numberWidth: (() => {
                const el = document.querySelector(
                  '.param-group input[type=number]:not(.rate-input input)',
                );
                return el ? el.offsetWidth : 0;
              })(),
              groupCount: document.querySelectorAll('.param-group').length,
              groupBorder: (() => {
                const el = document.querySelector('.param-group');
                return el
                  ? getComputedStyle(el).borderColor +
                    '|' +
                    getComputedStyle(el).borderRadius +
                    '|shadow:' +
                    getComputedStyle(el).boxShadow
                  : null;
              })(),
              groupOverlap: (() => {
                const groups = [...document.querySelectorAll('.param-group')];
                const out = [];
                for (const g of groups) {
                  const fields = [...g.querySelectorAll('.field')];
                  for (const f of fields) {
                    const label = f.querySelector('span:not(.rate-input)');
                    const input = f.querySelector('input');
                    if (!label || !input) continue;
                    const lr = label.getBoundingClientRect();
                    const ir = input.getBoundingClientRect();
                    out.push({
                      label: (label.innerText || '').slice(0, 20),
                      labelW: Math.round(lr.width),
                      fieldW: Math.round(f.getBoundingClientRect().width),
                      ownGap: Math.round(ir.left - lr.right),
                      ownOverlap: ir.left < lr.right,
                    });
                  }
                }
                return out;
              })(),
              rateWidth: (() => {
                const el = document.querySelector('.param-grid .rate-input input');
                return el ? el.offsetWidth : 0;
              })(),
              rateTotalWidth: (() => {
                const el = document.querySelector('.param-grid .rate-input');
                return el ? el.offsetWidth : 0;
              })(),
              rateComputedWidth: (() => {
                const el = document.querySelector('.param-grid .rate-input');
                if (!el) return null;
                const cs = getComputedStyle(el);
                return {
                  width: cs.width,
                  flex: cs.flex,
                  parentClass: el.parentElement ? el.parentElement.className : '',
                };
              })(),
              labelLeft: (() => {
                const field = document.querySelector('.param-group .field');
                if (!field) return null;
                const span = field.querySelector('span:not(.rate-input)');
                const input = field.querySelector('input');
                const sr = span.getBoundingClientRect();
                const ir = input.getBoundingClientRect();
                return {
                  labelLeft: Math.round(sr.left),
                  inputLeft: Math.round(ir.left),
                  gap: Math.round(ir.left - sr.right),
                  sameRow: Math.abs(sr.top - ir.top) < 20,
                };
              })(),
              spinnerAppearance: (() => {
                const el = document.querySelector(
                  '.param-group input[type=number]:not(.rate-input input)',
                );
                return el
                  ? getComputedStyle(el, '::-webkit-inner-spin-button').appearance
                  : null;
              })(),
              basisAddCount: document.querySelectorAll('.basis-add').length,
              versionCardBasisAdd: (() => {
                const card = [...document.querySelectorAll('.card')][0];
                return card ? card.querySelectorAll('.basis-add').length : -1;
              })(),
              firstCardBasisBlocks: (() => {
                const card = [...document.querySelectorAll('.card')][0];
                return card ? card.querySelectorAll('.basis').length : -1;
              })(),
              pensionGroups: (() => {
                const card = [...document.querySelectorAll('.card')].find(
                  (c) => (c.querySelector('h2') || {}).innerText === '养老',
                );
                if (!card) return null;
                const groups = [...card.querySelectorAll('.param-group')];
                const labels = (g) =>
                  g
                    ? [...g.querySelectorAll('span')]
                        .filter((s) => !s.classList.contains('rate-input'))
                        .map((s) => s.innerText)
                    : [];
                return {
                  count: groups.length,
                  first: labels(groups[0]),
                  second: labels(groups[1]),
                  third: labels(groups[2]),
                };
              })(),
              sectionGroups: (() => {
                const secs = ['医保', '生育', '失业', '公积金'];
                const out = {};
                for (const name of secs) {
                  const card = [...document.querySelectorAll('.card')].find(
                    (c) => (c.querySelector('h2') || {}).innerText === name,
                  );
                  if (!card) continue;
                  const groups = [...card.querySelectorAll('.param-group')];
                  out[name] = groups.map((g) =>
                    [...g.querySelectorAll('span')]
                      .filter((s) => !s.classList.contains('rate-input'))
                      .map((s) => s.innerText),
                  );
                }
                return out;
              })(),
              tierRowDiag: (() => {
                const card = [...document.querySelectorAll('.card')].find(
                  (c) => (c.querySelector('h2') || {}).innerText === '医保',
                );
                const row = card ? card.querySelector('.param-group-row') : null;
                if (!row) return null;
                const boxes = [...row.querySelectorAll('.param-group')];
                const rects = boxes.map((b) => b.getBoundingClientRect());
                return {
                  boxCount: boxes.length,
                  sideBySide:
                    rects.length === 2 &&
                    Math.abs(rects[0].top - rects[1].top) < 20 &&
                    rects[1].left > rects[0].left,
                  first: boxes[0] ? boxes[0].innerText.replace(/\s+/g, ' ') : '',
                  second: boxes[1] ? boxes[1].innerText.replace(/\s+/g, ' ') : '',
                };
              })(),
              sectionColors: (() => {
                const cls = [
                  'section-basic',
                  'section-pension',
                  'section-medical',
                  'section-maternity',
                  'section-unemployment',
                  'section-injury',
                  'section-housing',
                ];
                const out = {};
                for (const c of cls) {
                  const el = document.querySelector('.' + c);
                  if (!el) continue;
                  const cs = getComputedStyle(el);
                  const basis = el.querySelector('.basis');
                  out[c] = {
                    border:
                      cs.borderTopWidth +
                      ' ' +
                      cs.borderTopStyle +
                      ' ' +
                      cs.borderTopColor,
                    radius: cs.borderTopLeftRadius,
                    basisBorder: basis
                      ? getComputedStyle(basis).borderTopStyle +
                        ' ' +
                        getComputedStyle(basis).borderTopColor
                      : null,
                  };
                }
                return out;
              })(),
              basisLabelCount: document.querySelectorAll('.basis-label').length,
              basisDiag: (() => {
                const grid = document.querySelector('.basis-grid');
                const add = document.querySelector('.basis-add');
                return {
                  gridCols: grid ? getComputedStyle(grid).gridTemplateColumns : null,
                  validityInputs: document.querySelectorAll('.basis-validity-input').length,
                  validityRanges: document.querySelectorAll('.basis-validity-range').length,
                  addMarginLeft: add ? getComputedStyle(add).marginLeft : null,
                };
              })(),
              tipDiag: (() => {
                const tips = [...document.querySelectorAll('.param-group .tip-tip-short')];
                const tt = tips[0];
                const cs = tt ? getComputedStyle(tt) : null;
                const unempCard = [...document.querySelectorAll('.card')].find(
                  (c) => (c.querySelector('h2') || {}).innerText === '失业',
                );
                const unempLabels = unempCard
                  ? [...unempCard.querySelectorAll('.param-group .field span:not(.rate-input)')].map(
                      (s) => s.innerText,
                    )
                  : [];
                const minInput = unempCard
                  ? unempCard.querySelector('.param-group input[readonly]')
                  : null;
                return {
                  tipCount: tips.length,
                  texts: tips.map((t) => t.innerText),
                  tipStyle: cs
                    ? cs.backgroundColor + '|' + cs.color + '|' + cs.borderRadius
                    : null,
                  unempLabels: unempLabels,
                  unempMinValue: minInput ? minInput.value : null,
                  unempMinReadonly: minInput ? minInput.readOnly : null,
                };
              })(),
              subTitleDiag: (() => {
                const el = document.querySelector('.param-sub-title');
                if (!el) return null;
                const cs = getComputedStyle(el);
                return {
                  text: el.innerText,
                  fontWeight: cs.fontWeight,
                  color: cs.color,
                };
              })(),
              tipLayout: (() => {
                const wrap = document.querySelector('.param-group .tip-wrap');
                if (!wrap) return null;
                const tip = wrap.querySelector('.tip');
                const tipTip = wrap.querySelector('.tip-tip');
                if (!tip || !tipTip) return null;
                // 强制显示提示，测量实际位置
                tipTip.style.display = 'block';
                const tr = tip.getBoundingClientRect();
                const ttr = tipTip.getBoundingClientRect();
                tipTip.style.display = '';
                const cs = getComputedStyle(tipTip);
                return {
                  tipPos: [Math.round(tr.left), Math.round(tr.top)],
                  tipTipPos: [Math.round(ttr.left), Math.round(ttr.top)],
                  tipTipSize: [Math.round(ttr.width), Math.round(ttr.height)],
                  position: cs.position,
                  whiteSpace: cs.whiteSpace,
                  width: cs.width,
                  overlapsLabel:
                    ttr.top > tr.bottom - 20 && ttr.left < tr.right && ttr.right > tr.left,
                };
              })(),
              yijuColonCount: (document.body.innerText.match(/依据：/g) || []).length,
            })
          `);
          console.log('PARAMS_DIAG:', diag);
          const measureLabel = `(() => {
            const card = [...document.querySelectorAll('.card')].find(
              (c) => (c.querySelector('h2') || {}).innerText === '公积金',
            );
            if (!card) return null;
            const label = [...card.querySelectorAll('.param-group .field span')].find((s) =>
              s.innerText.includes('公司比例'),
            );
            if (!label) return null;
            return {
              h: label.offsetHeight,
              w: Math.round(label.getBoundingClientRect().width),
            };
          })()`;
          const labelH0 = await win.webContents.executeJavaScript(measureLabel);
          win.setSize(2000, 920);
          await new Promise((resolve) => setTimeout(resolve, 400));
          const labelH1 = await win.webContents.executeJavaScript(measureLabel);
          win.setSize(1600, 920);
          await new Promise((resolve) => setTimeout(resolve, 300));
          console.log('WRAP_CHECK:', JSON.stringify({ at1600: labelH0, at2000: labelH1 }));
          const avgModalCheck = await win.webContents.executeJavaScript(`
            (async () => {
              const gears = [...document.querySelectorAll('.avg-gear')];
              const selects = [...document.querySelectorAll('.avg-year-select')];
              // 第一个 ⚙️：三项平均工资
              if (gears[0]) gears[0].click();
              await new Promise((r) => setTimeout(r, 120));
              const baseRows = document.querySelectorAll(
                '.avg-year-grid .avg-year-label',
              ).length;
              const baseHeads = document.querySelectorAll('.avg-year-head').length;
              const baseCols = document.querySelector('.avg-year-grid')
                ? document.querySelector('.avg-year-grid').className
                : '';
              // ⚙️ 弹窗内年份单元格：单击打开链接编辑弹窗
              const yearCells = [
                ...document.querySelectorAll('.avg-year-grid .year-link-year'),
              ];
              if (yearCells[4]) yearCells[4].click(); // 2026（2022 起第 5 行）
              await new Promise((r) => setTimeout(r, 400));
              const editorOpen = !!document.querySelector('.link-editor-card');
              const editorTitle = (document.querySelector('.link-editor-card h2') || {}).innerText;
              const urlInput = document.querySelector('.link-editor-card input[type=text]');
              if (urlInput) {
                urlInput.value = 'https://example.com/2026';
                urlInput.dispatchEvent(new Event('input'));
              }
              await new Promise((r) => setTimeout(r, 80));
              const editorOk = [
                ...document.querySelectorAll('.link-editor-card .block-actions button'),
              ].find((b) => b.innerText.includes('确定'));
              if (editorOk) editorOk.click();
              await new Promise((r) => setTimeout(r, 100));
              const year2026HasLink = (() => {
                const cells = [
                  ...document.querySelectorAll('.avg-year-grid .year-link-year'),
                ];
                return !!(cells[4] && cells[4].classList.contains('has-link'));
              })();
              // 双击：先点两下再 dblclick，应取消单击延迟、不弹编辑框
              const cellsNow = [
                ...document.querySelectorAll('.avg-year-grid .year-link-year'),
              ];
              if (cellsNow[5]) {
                // 2027（无链接）——双击不应打开编辑框
                cellsNow[5].dispatchEvent(new MouseEvent('click', { bubbles: true }));
                cellsNow[5].dispatchEvent(new MouseEvent('click', { bubbles: true }));
                cellsNow[5].dispatchEvent(
                  new MouseEvent('dblclick', { bubbles: true }),
                );
              }
              await new Promise((r) => setTimeout(r, 400));
              const editorNotOpenAfterDbl = !document.querySelector('.link-editor-card');
              const closeBtn3 = document.querySelector('.avg-modal .modal-close');
              if (closeBtn3) closeBtn3.click();
              await new Promise((r) => setTimeout(r, 80));
              // 第二个 ⚙️：全口径
              if (gears[1]) gears[1].click();
              await new Promise((r) => setTimeout(r, 120));
              const allRows = document.querySelectorAll(
                '.avg-year-grid .avg-year-label',
              ).length;
              const allHeads = document.querySelectorAll('.avg-year-head').length;
              const allCols = document.querySelector('.avg-year-grid')
                ? document.querySelector('.avg-year-grid').className
                : '';
              const allYearCells = [
                ...document.querySelectorAll('.avg-year-grid .year-link-year'),
              ];
              if (allYearCells[0]) allYearCells[0].click(); // 2018
              await new Promise((r) => setTimeout(r, 400));
              const editorOpenAll = !!document.querySelector('.link-editor-card');
              const closeEditorAll = document.querySelector(
                '.link-editor-card .modal-close',
              );
              if (closeEditorAll) closeEditorAll.click();
              await new Promise((r) => setTimeout(r, 60));
              const closeBtn4 = document.querySelector('.avg-modal .modal-close');
              if (closeBtn4) closeBtn4.click();
              await new Promise((r) => setTimeout(r, 80));
              return JSON.stringify({
                yearSelectCount: selects.length,
                gearCount: gears.length,
                baseRows,
                baseHeads,
                baseCols,
                allRows,
                allHeads,
                allCols,
                editorOpen,
                editorTitle,
                year2026HasLink,
                editorNotOpenAfterDbl,
                editorOpenAll,
                modalClosed:
                  !document.querySelector('.avg-modal') &&
                  !document.querySelector('.link-editor-card'),
              });
            })()
          `);
          console.log('AVG_MODAL_CHECK:', avgModalCheck);
          if (process.env.SMOKE_PARAMS_SAVE) {
            await win.webContents.executeJavaScript(`
              (async () => {
                const label = [
                  ...document.querySelectorAll('.param-group .field span:not(.rate-input)'),
                ].find((s) => s.innerText === '城镇非私营平均工资（元/年）');
                const wageInput = label
                  ? label.closest('.field').querySelector('input')
                  : null;
                if (!wageInput) return 'no-input';
                wageInput.value = '123456';
                wageInput.dispatchEvent(new Event('input'));
                await new Promise((r) => setTimeout(r, 1500));
                return 'saved';
              })()
            `);
            const saved = loadParams('shenzhen');
            const aw = saved && saved.averageWage;
            console.log(
              'PARAMS_SAVE_CHECK:',
              JSON.stringify({
                saved: !!saved,
                year: aw && aw.year,
                yearAllUnit: aw && aw.yearAllUnit,
                nonPrivate:
                  aw && aw.byYear && aw.byYear['2026']
                    ? aw.byYear['2026'].urbanNonPrivate
                    : null,
              }),
            );
          }
        }
      }
      if (process.env.SMOKE_SCROLL) {
        await win.webContents.executeJavaScript(
          `(() => {
            const headings = [...document.querySelectorAll('.card h2')];
            const target =
              headings.find((h) => h.textContent.includes('公积金')) ||
              document.querySelector('.injury-grid');
            target.scrollIntoView({ block: 'start' });
          })()`,
        );
        await new Promise((resolve) => setTimeout(resolve, 300));
      }
      if (process.env.SMOKE_UI_CHECK) {
        // 选非深户后，点击户籍字段空白处不应切回深户
        const check = await win.webContents.executeJavaScript(`
          (async () => {
            const segs = document.querySelectorAll('.segmented');
            const buttons = [...segs[1].querySelectorAll('button')];
            const nonDeep = buttons.find((b) => b.innerText.includes('非深户'));
            nonDeep.click();
            await new Promise((r) => setTimeout(r, 100));
            const afterClick = buttons.find((b) => b.classList.contains('active')).innerText;
            segs[1].parentElement.click();
            await new Promise((r) => setTimeout(r, 100));
            const afterBlank = buttons.find((b) => b.classList.contains('active')).innerText;
            return JSON.stringify({ afterClick, afterBlank });
          })()
        `);
        console.log('UI_CHECK:', check);
        const summary = await win.webContents.executeJavaScript(`
          JSON.stringify(
            [...document.querySelectorAll('.summary .card')].map((card) => {
              const el = card.querySelector('.value, .value-input');
              const style = getComputedStyle(el);
              return {
                label: card.querySelector('.label').innerText,
                color: style.color,
                fontSize: style.fontSize,
                tag: el.tagName,
              };
            }),
          )
        `);
        console.log('SUMMARY_CHECK:', summary);
        const adCheck = await win.webContents.executeJavaScript(`
          (async () => {
            const btn = [...document.querySelectorAll('nav button')].find((b) =>
              b.innerText.includes('广告'),
            );
            const exists = !!btn;
            if (btn) btn.click();
            await new Promise((r) => setTimeout(r, 100));
            const adCard = [...document.querySelectorAll('.card h2')].some(
              (h) => h.innerText === '广告',
            );
            return JSON.stringify({ exists, adCard });
          })()
        `);
        console.log('AD_CHECK:', adCheck);
        const regionCheck = await win.webContents.executeJavaScript(
          `JSON.stringify({
            regionSelect: !!document.querySelector('.region-select'),
            appVersion: (document.querySelector('.app-version') || {}).innerText || '',
            options: [...document.querySelectorAll('.region-select option')].map(
              (o) => o.innerText,
            ),
          })`,
        );
        console.log('REGION_CHECK:', regionCheck);
      }
      if (process.env.SMOKE_REVERSE) {
        // 修改 到手工资/用工成本/月工资 三者之一，另外两项应联动且一致
        const check = await win.webContents.executeJavaScript(`
          (async () => {
            const setInput = (el, val) => {
              el.value = String(val);
              el.dispatchEvent(new Event('input'));
            };
            const wageEl = document.querySelector('input.wage-input');
            const [netEl, costEl] = [...document.querySelectorAll('.value-input')];
            const snap = () => ({
              wage: wageEl.value,
              net: netEl.value,
              cost: costEl.value,
            });
            const initial = snap();
            setInput(netEl, 5000);
            await new Promise((r) => setTimeout(r, 150));
            const afterNet = snap();
            setInput(costEl, 10000);
            await new Promise((r) => setTimeout(r, 150));
            const afterCost = snap();
            setInput(wageEl, 8000);
            await new Promise((r) => setTimeout(r, 150));
            const afterWage = snap();
            return JSON.stringify({ initial, afterNet, afterCost, afterWage });
          })()
        `);
        console.log('REVERSE_CHECK:', check);
      }
      if (process.env.SMOKE_FLEX) {
        // 公积金下拉菜单：公司 0/5~12、个人随公司联动、公司0个人归0；灵活就业 0~24
        const check = await win.webContents.executeJavaScript(`
          (async () => {
            const setSelect = (el, val) => {
              el.value = String(val);
              el.dispatchEvent(new Event('change'));
            };
            const empRates = [...document.querySelectorAll('.housing-settings .rate-input select')];
            const empCompany0 = {
              company: empRates[0].value,
              personal: empRates[1].value,
              personalOptions: empRates[1].options.length,
            };
            // 公司 8% -> 个人自动 8，个人选项为 8~12（5 项）
            setSelect(empRates[0], 8);
            await new Promise((r) => setTimeout(r, 120));
            const empCompany8 = {
              company: empRates[0].value,
              personal: empRates[1].value,
              personalOptions: empRates[1].options.length,
            };
            // 公司 0% -> 个人自动 0，个人选项只剩 0
            setSelect(empRates[0], 0);
            await new Promise((r) => setTimeout(r, 120));
            const empAfter0 = {
              company: empRates[0].value,
              personal: empRates[1].value,
              personalOptions: empRates[1].options.length,
              note: (document.querySelector('.company-zero-note') || {}).innerText || '无提示',
            };
            // 公司恢复 5% -> 个人自动 5，个人选项 5~12（8 项）
            setSelect(empRates[0], 5);
            await new Promise((r) => setTimeout(r, 120));
            const empCompany5 = {
              company: empRates[0].value,
              personal: empRates[1].value,
              personalOptions: empRates[1].options.length,
            };
            // 灵活就业：默认只勾养老+医保；可勾失业、公积金
            const flexBtn = [...document.querySelectorAll('.segmented button')].find((b) =>
              b.innerText.includes('灵活就业'),
            );
            flexBtn.click();
            await new Promise((r) => setTimeout(r, 150));
            const insuranceChecks = [
              ...document.querySelectorAll('.flexible-insurance input[type=checkbox]'),
            ];
            const initialChecks = insuranceChecks.map((c) => c.checked);
            const bandNoteEl = document.querySelector('.band-note-row');
            const bandNoteSameLine =
              !!bandNoteEl && getComputedStyle(bandNoteEl).whiteSpace === 'nowrap';
            const summaryLabels = [...document.querySelectorAll('.summary .card .label')].map(
              (el) => el.innerText,
            );
            const readDetail = () =>
              [...document.querySelectorAll('.card table tbody tr')]
                .map((r) => (r.querySelector('td') || {}).innerText)
                .filter(Boolean);
            const defaultRows = readDetail();
            // 勾选失业
            insuranceChecks[2].click();
            await new Promise((r) => setTimeout(r, 150));
            const rowsWithUnemployment = readDetail();
            // 勾选公积金 -> 显示公积金设置
            insuranceChecks[3].click();
            await new Promise((r) => setTimeout(r, 150));
            const housingVisible = !!document.querySelector('.housing-settings');
            const followCheckbox = document.querySelector('.housing-settings .base-row input[type=checkbox]');
            if (followCheckbox.checked) followCheckbox.click();
            await new Promise((r) => setTimeout(r, 120));
            const baseEl = document.querySelector('.housing-settings .base-row input[type=number]');
            baseEl.value = '3000';
            baseEl.dispatchEvent(new Event('input'));
            const rateEl = document.querySelector('.housing-settings .rate-input select');
            const flexOptionsCount = rateEl.options.length;
            setSelect(rateEl, 20);
            await new Promise((r) => setTimeout(r, 120));
            const flexAfter20 = {
              base: baseEl.value,
              rate: rateEl.value,
              warning: (document.querySelector('.housing-warning') || {}).innerText || '无提醒',
            };
            setSelect(rateEl, 24);
            await new Promise((r) => setTimeout(r, 120));
            const flexAfter24 = {
              rate: rateEl.value,
              warning: (document.querySelector('.housing-warning') || {}).innerText || '无提醒',
            };
            setSelect(rateEl, 10);
            await new Promise((r) => setTimeout(r, 120));
            const flexAfter10 = {
              rate: rateEl.value,
              warning: (document.querySelector('.housing-warning') || {}).innerText || '无提醒',
            };
            const rowsWithHousing = readDetail();
            // 比例改为 0（不缴公积金）后，公积金行也应从明细消失
            setSelect(rateEl, 0);
            await new Promise((r) => setTimeout(r, 120));
            const rowsHousingUnpaid = readDetail();
            const generalNote = (
              document.querySelector('.housing-fund-settings > .note') || {}
            ).innerText;
            return JSON.stringify({
              empCompany0,
              empCompany8,
              empAfter0,
              empCompany5,
              initialChecks,
              bandNoteSameLine,
              summaryLabels,
              defaultRows,
              rowsWithUnemployment,
              housingVisible,
              flexOptionsCount,
              flexAfter20,
              flexAfter24,
              flexAfter10,
              rowsWithHousing,
              rowsHousingUnpaid,
              generalNote,
            });
          })()
        `);
        console.log('FLEX_CHECK:', check);
      }
      if (process.env.SMOKE_GEAR) {
        // ⚙️ 设置弹窗：板块结构、计算默认值、公积金、按钮顺序
        const check = await win.webContents.executeJavaScript(`
          (async () => {
            const divider = getComputedStyle(
              document.querySelector('.nav-gear-btn'),
            ).borderLeftWidth;
            document.querySelector('.nav-gear-btn[title="设置"]').click();
            await new Promise((r) => setTimeout(r, 100));
            const modalVisible = !!document.querySelector('.modal-card');
            // 点击空白处不应关闭弹窗
            document.querySelector('.modal-mask').click();
            await new Promise((r) => setTimeout(r, 80));
            const maskNoClose = !!document.querySelector('.modal-card');
            const modalTitle = (document.querySelector('.modal-card h2') || {}).innerText;
            const sectionTitles = [...document.querySelectorAll('.modal-card h3')].map(
              (h) => h.innerText,
            );
            const actionButtons = [...document.querySelectorAll('.modal-card .actions button')];
            const buttonOrder = actionButtons.map((b) => b.innerText.trim());
            const actionsJustify = getComputedStyle(
              document.querySelector('.modal-card .actions'),
            ).justifyContent;
            const rateSelects = [...document.querySelectorAll('.modal-card .rate-input select')];
            const companyOptionsCount = rateSelects[0].options.length;
            const personalOptionsCount = rateSelects[1].options.length;
            const flexRate = rateSelects[2];
            const flexOptionsCount = flexRate.options.length;
            flexRate.value = '15';
            flexRate.dispatchEvent(new Event('change'));
            // 计算默认值：切到灵活就业
            const segButtons = [...document.querySelectorAll('.modal-card .segmented button')];
            segButtons
              .find((b) => b.innerText.includes('灵活就业'))
              .click();
            document.querySelector('.modal-card .actions .primary').click();
            await new Promise((r) => setTimeout(r, 100));
            const saved = JSON.parse(localStorage.getItem('appSettings') || 'null');
            // 灵活就业下公积金设置默认隐藏，先勾选公积金再读取比例
            const flexChecks = [
              ...document.querySelectorAll('.flexible-insurance input[type=checkbox]'),
            ];
            if (flexChecks[3] && !flexChecks[3].checked) flexChecks[3].click();
            await new Promise((r) => setTimeout(r, 100));
            const calcFlexRate = document.querySelector(
              '.housing-settings .rate-input select',
            ).value;
            const calcDefaultParticipation = document.querySelector(
              '.calc-grid .segmented button.active',
            ).innerText;
            return JSON.stringify({
              modalVisible,
              maskNoClose,
              modalTitle,
              sectionTitles,
              divider,
              buttonOrder,
              actionsJustify,
              companyOptionsCount,
              personalOptionsCount,
              flexOptionsCount,
              savedFlexRate: saved && saved.housingFund && saved.housingFund.flexible.rate,
              calcFlexRate,
              calcDefaultParticipation,
            });
          })()
        `);
        console.log('GEAR_CHECK:', check);
      }
      if (process.env.SMOKE_POLICY) {
        // 政策参数页公积金下拉、保存后试算页立即生效
        const check = await win.webContents.executeJavaScript(`
          (async () => {
            const setSelect = (el, val) => {
              el.value = String(val);
              el.dispatchEvent(new Event('change'));
            };
            const navButtons = [...document.querySelectorAll('nav button')];
            navButtons.find((b) => b.innerText.includes('政策参数')).click();
            await new Promise((r) => setTimeout(r, 150));
            const h2s = [...document.querySelectorAll('.card h2')];
            const gfCard = h2s.find((h) => h.textContent.includes('公积金')).closest('.card');
            const gfSelects = [...gfCard.querySelectorAll('.rate-input select')];
            // 参数页顺序：个人比例在前、公司比例在后
            const personalOptions = gfSelects[0].options.length;
            const companyOptions = gfSelects[1].options.length;
            setSelect(gfSelects[1], 8);
            await new Promise((r) => setTimeout(r, 120));
            document.querySelector('.actions .primary').click();
            await new Promise((r) => setTimeout(r, 150));
            const navButtons2 = [...document.querySelectorAll('nav button')];
            navButtons2.find((b) => b.innerText.includes('社保')).click();
            await new Promise((r) => setTimeout(r, 150));
            const calcHfSelects = [...document.querySelectorAll('.housing-settings .rate-input select')];
            const calcPersonal = calcHfSelects[1].value;
            const calcCompany = calcHfSelects[0].value;
            return JSON.stringify({ companyOptions, personalOptions, calcPersonal, calcCompany });
          })()
        `);
        console.log('POLICY_CHECK:', check);
      }
      if (process.env.SMOKE_SYNC) {
        const platformServerPath = path.join(
          __dirname,
          '..',
          'platform',
          'server',
          'server.js',
        );
        if (!fs.existsSync(platformServerPath)) {
          console.log('SYNC_CHECK: SKIP (packaged)');
        } else {
        // 政策参数远程同步：本地起参数服务 + 平台服务，验证财会公司渠道与同步
        const http = require('http');
        const paramsServer = http.createServer((_req, res) => {
          res.setHeader('content-type', 'application/json');
          res.end(
            JSON.stringify({
              version: 'smoke-remote',
              pension: { baseMin: 5100 },
              medical: { baseMin: 6800 },
            }),
          );
        });
        await new Promise((resolve) => paramsServer.listen(0, '127.0.0.1', resolve));
        const paramsPort = paramsServer.address().port;
        // 平台服务
        process.env.PLATFORM_DATA_DIR = path.join(os.tmpdir(), 'platform-smoke-' + Date.now());
        process.env.ADMIN_USER = 'admin';
        process.env.ADMIN_PASS = 'test123';
        const platform = require(path.join(
          __dirname,
          '..',
          'platform',
          'server',
          'server.js',
        ));
        const platformServer = platform.createServer();
        await new Promise((resolve) => platformServer.listen(0, '127.0.0.1', resolve));
        const platformPort = platformServer.address().port;
        const loginRes = await fetch(`http://127.0.0.1:${platformPort}/api/admin/login`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ username: 'admin', password: 'test123' }),
        });
        const loginData = await loginRes.json();
        const chRes = await fetch(`http://127.0.0.1:${platformPort}/api/admin/channels`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: 'Bearer ' + loginData.token,
          },
          body: JSON.stringify({
            name: '财会测试公司',
            paramsUrl: `http://127.0.0.1:${paramsPort}`,
          }),
        });
        const channel = await chRes.json();
        const check = await win.webContents.executeJavaScript(`
          (async () => {
            document.querySelector('.nav-gear-btn[title="政策参数远程同步"]').click();
            await new Promise((r) => setTimeout(r, 120));
            const modalVisible = !!document.querySelector('.modal-card');
            const headingText = (document.querySelector('.sync-head h3') || {}).innerText;
            const fieldLabels = [...document.querySelectorAll('.modal-card .field span')].map(
              (el) => el.innerText,
            );
            const urlRowFields = document.querySelectorAll('.sync-url-row .field').length;
            const selectEl = document.querySelector('.sync-url-row select');
            const urlEl = document.querySelector('.sync-url-row input[type=url]');
            const heightsEqual = selectEl.offsetHeight === urlEl.offsetHeight;
            const actionButtons = [...document.querySelectorAll('.modal-card .actions button')].map(
              (b) => b.innerText.trim(),
            );
            const toggleBtn = document.querySelector('.sync-toggle-all');
            const checkboxes = [
              ...document.querySelectorAll('.modal-card .sync-sections input[type=checkbox]'),
            ];
            const sectionCount = checkboxes.length;
            // 全选/取消全选
            toggleBtn.click();
            await new Promise((r) => setTimeout(r, 100));
            const allChecked = checkboxes.every((c) => c.checked);
            toggleBtn.click();
            await new Promise((r) => setTimeout(r, 100));
            const allUnchecked = checkboxes.every((c) => !c.checked);
            // 服务商下拉
            const providerSelect = document.querySelector('.modal-card select');
            // 设置平台地址并刷新渠道
            const platformInput = document.querySelector('.sync-platform-row input[type=url]');
            platformInput.value = 'http://127.0.0.1:${platformPort}';
            platformInput.dispatchEvent(new Event('input'));
            document.querySelector('.sync-refresh').click();
            await new Promise((r) => setTimeout(r, 300));
            const providerCount = providerSelect.options.length;
            providerSelect.value = 'channel:${channel.id}';
            providerSelect.dispatchEvent(new Event('change'));
            await new Promise((r) => setTimeout(r, 80));
            const providerHint = (document.querySelector('.provider-hint') || {}).innerText || '';
            const channelAutoUrl = document.querySelector('.sync-url-input').value;
            const autoSyncBox = document.querySelector('.modal-card .auto-sync input');
            if (!autoSyncBox.checked) autoSyncBox.click();
            checkboxes[0].click(); // 参数版本
            checkboxes[3].click(); // 养老
            [...document.querySelectorAll('.modal-card .actions button')]
              .find((b) => b.innerText.includes('立即同步'))
              .click();
            await new Promise((r) => setTimeout(r, 400));
            const modalClosed = !document.querySelector('.modal-card');
            const savedSync = JSON.parse(localStorage.getItem('policySyncSettings') || 'null');
            [...document.querySelectorAll('nav button')]
              .find((b) => b.innerText.includes('政策参数'))
              .click();
            await new Promise((r) => setTimeout(r, 150));
            const h2s = [...document.querySelectorAll('.card h2')];
            const pensionCard = h2s
              .find((h) => h.textContent.includes('养老'))
              .closest('.card');
            const nums = [...pensionCard.querySelectorAll('input[type=number]')];
            return JSON.stringify({
              modalVisible,
              headingText,
              fieldLabels,
              urlRowFields,
              heightsEqual,
              actionButtons,
              sectionCount,
              allChecked,
              allUnchecked,
              providerCount,
              providerHint: providerHint.slice(0, 18),
              channelAutoUrl,
              modalClosed,
              savedAutoSync: savedSync && savedSync.autoSync,
              baseMin: nums[5].value,
            });
          })()
        `);
        console.log('SYNC_CHECK:', check);
        await new Promise((resolve) => paramsServer.close(resolve));
        await new Promise((resolve) => platformServer.close(resolve));
        }
      }
      if (process.env.SMOKE_SEVERANCE) {
        const check = await win.webContents.executeJavaScript(`
          (async () => {
            try {
            const set = (el, v) => {
              el.value = String(v);
              el.dispatchEvent(new Event('input'));
            };
            const setSelect = (el, v) => {
              el.value = String(v);
              el.dispatchEvent(new Event('change'));
            };
            const openSeg = async (seg) => {
              seg.querySelector('.seg-trigger').click();
              await new Promise((r) => setTimeout(r, 80));
            };
            const closeSeg = async (seg) => {
              seg.querySelector('.seg-trigger').click();
              await new Promise((r) => setTimeout(r, 60));
            };
            const setSeg = async (root, idx, val) => {
              const seg = root.querySelectorAll('.date-segments .seg-select')[idx];
              await openSeg(seg);
              const opt = [...seg.querySelectorAll('.seg-option')].find(
                (o) => o.getAttribute('data-v') === val,
              );
              if (opt) opt.click();
              await new Promise((r) => setTimeout(r, 60));
            };
            const setCalcMonths = async (v) => {
              const seg = document.querySelector(
                '.severance-panel .calc-grid .months-select',
              );
              if (!seg) return;
              await openSeg(seg);
              const opt = [...seg.querySelectorAll('.seg-option')].find(
                (o) => o.getAttribute('data-v') === String(v),
              );
              if (opt) opt.click();
              await new Promise((r) => setTimeout(r, 60));
            };
            const btn = [...document.querySelectorAll('nav button')].find((b) =>
              b.innerText.includes('赔偿'),
            );
            btn.click();
            window.__step = 'open';
            await new Promise((r) => setTimeout(r, 150));
            const panel = !!document.querySelector('.severance-panel');
            const subTabs = [...document.querySelectorAll('.sub-tabs button')].map(
              (b) => b.innerText,
            );
            // 计算器：3 年 6 个月 -> N = 4 个月工资
            const inputs = [
              ...document.querySelectorAll('.severance-panel .calc-grid input[type=number]'),
            ];
            const bonusDefaultEmpty = inputs[1].value === '';
            const calcWageLabelWidth = (
              document.querySelector('.severance-panel .calc-grid .field span') || {}
            ).offsetWidth || 0;
            const bonusInputWidth = document.querySelector(
              '.severance-panel .bonus-part-input',
            ).offsetWidth;
            const wageInputWidth = document.querySelector(
              '.severance-panel .wage-part-input',
            ).offsetWidth;
            set(inputs[0], 8000);
            set(inputs[1], 0);
            set(inputs[2], 3);
            await setCalcMonths(6);
            window.__step = 'calc';
            await new Promise((r) => setTimeout(r, 120));
            const calcValues = [...document.querySelectorAll('.severance-panel .preview-card b')].map(
              (el) => el.innerText,
            );
            const tenureMonthsAuto = inputs[3] ? inputs[3].value : '';
            const yearsInputWidth = document.querySelector(
              '.severance-panel .years-input',
            ).offsetWidth;
            const calcDetailGone = ![...document.querySelectorAll('.severance-panel h2')].some(
              (h) => h.innerText.includes('计算明细'),
            );
            // 工作年限最多 2 位数字：整体输入多位数只取前 2 位
            set(inputs[2], 123456);
            await new Promise((r) => setTimeout(r, 80));
            const yearsMax2Digits = inputs[2].value;
            // 键盘输入第 3 位数字被阻止
            set(inputs[2], 12);
            await new Promise((r) => setTimeout(r, 80));
            const yearsEl0 = document.querySelector('.severance-panel .years-input');
            yearsEl0.dispatchEvent(
              new KeyboardEvent('keydown', { key: '3', bubbles: true, cancelable: true }),
            );
            await new Promise((r) => setTimeout(r, 80));
            const yearsThirdBlocked = yearsEl0.value;
            set(inputs[2], 3);
            await new Promise((r) => setTimeout(r, 80));
            // 年为 0 时不显示 0
            set(inputs[2], 0);
            await new Promise((r) => setTimeout(r, 80));
            const yearsZeroEmpty = inputs[2].value === '';
            set(inputs[2], 3);
            await new Promise((r) => setTimeout(r, 80));
            // 键盘 +/- 增减年限
            const yearsEl = document.querySelector('.severance-panel .years-input');
            yearsEl.dispatchEvent(
              new KeyboardEvent('keydown', { key: '+', bubbles: true, cancelable: true }),
            );
            await new Promise((r) => setTimeout(r, 80));
            const yearsKeyPlus = yearsEl.value;
            yearsEl.dispatchEvent(
              new KeyboardEvent('keydown', { key: '-', bubbles: true, cancelable: true }),
            );
            await new Promise((r) => setTimeout(r, 80));
            const yearsKeyMinus = yearsEl.value;
            const tenureInputWidth = document.querySelector(
              '.severance-panel .tenure-input',
            ).offsetWidth;
            // 计入时长最多 6 个字符（如 1000.5）
            set(inputs[3], 1000.55);
            await new Promise((r) => setTimeout(r, 80));
            const tenure6Char = inputs[3].value;
            set(inputs[3], 4);
            await new Promise((r) => setTimeout(r, 80));
            const calcAvgSelector = !!document.querySelector(
              '.severance-panel .calc-head .avg-source-select',
            );
            const calcAvgLabel = (
              document.querySelector('.severance-panel .calc-head .avg-source-row > span') || {}
            ).innerText;
            const calcWageLabel = (
              [...document.querySelectorAll('.severance-panel .calc-grid .field span')].find(
                (s) => s.innerText.includes('月工资'),
              ) || {}
            ).innerText;
            const calcBonusLabel =
              [
                ...document.querySelectorAll('.severance-panel .calc-grid .field span'),
              ].find((s) => s.innerText.includes('奖金'))?.innerText || '';
            const calcYearsLabel =
              [
                ...document.querySelectorAll('.severance-panel .calc-grid .field span'),
              ].find((s) => s.innerText.includes('工作时长'))?.innerText || '';
            const calcWageChain = !!document.querySelector(
              '.severance-panel .calc-grid .wage-bonus-row',
            );
            const calcTenureChain = !!document.querySelector(
              '.severance-panel .calc-grid .tenure-chain-row',
            );
            const calcWageTip = (() => {
              const label = [
                ...document.querySelectorAll(
                  '.severance-panel .calc-grid .wage-bonus-labels span',
                ),
              ].find((s) => s.innerText.includes('月工资'));
              if (!label) return null;
              const tip = label.querySelector('.tip');
              const tipText = label.querySelector('.tip-tip');
              return {
                labelText: label.innerText,
                tip: tip ? tip.innerText : '',
                tipText: tipText ? tipText.innerText : '',
              };
            })();
            const calcPreviewCards = document.querySelectorAll(
              '.severance-panel .preview-card',
            ).length;
            const calcOverlapDiag = (() => {
              const cb = document.querySelector('.severance-panel .calc-grid .checkbox');
              const tenure = document.querySelector(
                '.severance-panel .calc-grid .tenure-input',
              );
              if (!cb || !tenure) return null;
              const cbR = cb.getBoundingClientRect();
              const tR = tenure.getBoundingClientRect();
              const grid = document.querySelector('.severance-panel .calc-grid');
              return {
                cb: [Math.round(cbR.left), Math.round(cbR.top), Math.round(cbR.right), Math.round(cbR.bottom)],
                tenure: [Math.round(tR.left), Math.round(tR.top), Math.round(tR.right), Math.round(tR.bottom)],
                overlap: cbR.left < tR.right && cbR.right > tR.left && cbR.top < tR.bottom && cbR.bottom > tR.top,
                gridCols: grid ? getComputedStyle(grid).gridTemplateColumns : null,
                chainRight: (() => {
                  const chain = document.querySelector(
                    '.severance-panel .calc-grid .tenure-chain-row',
                  );
                  return chain ? Math.round(chain.getBoundingClientRect().right) : null;
                })(),
              };
            })();
            const calcHeadDiag = (() => {
              const head = document.querySelector('.severance-panel .calc-head');
              const h2 = head ? head.querySelector('h2') : null;
              const row = head ? head.querySelector('.avg-source-row') : null;
              if (!head || !h2 || !row) return null;
              const hr = h2.getBoundingClientRect();
              const rr = row.getBoundingClientRect();
              return {
                h2Left: Math.round(hr.left),
                rowLeft: Math.round(rr.left),
                justifyContent: getComputedStyle(head).justifyContent,
                align: getComputedStyle(head).alignItems,
              };
            })();
            const calcDateSegs = [
              ...document.querySelectorAll(
                '.severance-panel .date-segments .seg-select',
              ),
            ];
            const calcEntryDateExists = calcDateSegs.length === 3;
            await openSeg(calcDateSegs[0]);
            const calcYearOpts = [...calcDateSegs[0].querySelectorAll('.seg-option')].map(
              (o) => o.getAttribute('data-v'),
            );
            const calcYearMin = calcYearOpts[0];
            const calcYearMax = calcYearOpts[calcYearOpts.length - 1];
            await closeSeg(calcDateSegs[0]);
            // 同一时间只允许一个下拉菜单打开
            await openSeg(calcDateSegs[0]);
            const popup0open = !!calcDateSegs[0].querySelector('.seg-popup');
            const popupCountAfterYear = document.querySelectorAll('.seg-popup').length;
            await openSeg(calcDateSegs[1]);
            const popup0closed = !calcDateSegs[0].querySelector('.seg-popup');
            const popup1open = !!calcDateSegs[1].querySelector('.seg-popup');
            const popupCountAfterMonth = document.querySelectorAll('.seg-popup').length;
            await closeSeg(calcDateSegs[1]);
            // 日下拉为 3 列
            await openSeg(calcDateSegs[2]);
            const dayPopupCols = (() => {
              const popup = calcDateSegs[2].querySelector('.seg-popup');
              if (!popup) return 0;
              const gtc = getComputedStyle(popup).gridTemplateColumns;
              const rep = /repeat\\((\d+)/.exec(gtc || '');
              if (rep) return Number(rep[1]);
              return gtc.split(/\\s+/).filter((s) => s.endsWith('px')).length;
            })();
            await closeSeg(calcDateSegs[2]);
            // 下拉选择入职时间 -> 自动折算工作年限（2020-01-01 至今约 6 年 8 个月）
            await setSeg(
              document.querySelector('.severance-panel .date-segments'),
              0,
              '2020',
            );
            await setSeg(
              document.querySelector('.severance-panel .date-segments'),
              1,
              '01',
            );
            await setSeg(
              document.querySelector('.severance-panel .date-segments'),
              2,
              '01',
            );
            await new Promise((r) => setTimeout(r, 120));
            const calcYearsAuto = inputs[2].value;
            // 无效组合（1949-09-30，早于 1949-10-01）自动清空并提示，工作年限不变
            await setSeg(
              document.querySelector('.severance-panel .date-segments'),
              0,
              '1949',
            );
            await setSeg(
              document.querySelector('.severance-panel .date-segments'),
              1,
              '09',
            );
            await setSeg(
              document.querySelector('.severance-panel .date-segments'),
              2,
              '30',
            );
            await new Promise((r) => setTimeout(r, 120));
            const calcYearsAfterInvalid = inputs[2].value;
            set(inputs[2], 3);
            await setCalcMonths(6);
            await new Promise((r) => setTimeout(r, 100));
            const calcAvgInput = document.querySelector(
              '.severance-panel .calc-head .avg-input',
            );
            set(calcAvgInput, 200000);
            await new Promise((r) => setTimeout(r, 80));
            const calcAvgManualRed = calcAvgInput.classList.contains('avg-manual');
            // 恢复平均工资来源为城镇非私营（191367），供封顶测试使用
            setSelect(
              document.querySelector('.severance-panel .calc-head .avg-source-select'),
              'nonPrivate',
            );
            await new Promise((r) => setTimeout(r, 80));
            // 触发 3 倍封顶 + 12 年上限 -> 红字提示
            set(inputs[0], 50000);
            set(inputs[2], 15);
            await setCalcMonths(0);
            await new Promise((r) => setTimeout(r, 150));
            const capHintText =
              (document.querySelector('.severance-panel .red-text') || {}).innerText || '';
            const capHintOk = capHintText.includes('锁定年限（N）为12');
            const tenureAfterCap = inputs[3].value;
            const calcValuesAfterCap = [
              ...document.querySelectorAll('.severance-panel .preview-card b'),
            ].map((el) => el.innerText);
            const nPlus1Capped = calcValuesAfterCap[1].includes('621,942.75');
            // 奖金计入计算：月工资 8000 + 奖金 2000 = 10000
            set(inputs[0], 8000);
            set(inputs[1], 2000);
            set(inputs[2], 3);
            await setCalcMonths(6);
            await new Promise((r) => setTimeout(r, 150));
            const calcValuesWithBonus = [
              ...document.querySelectorAll('.severance-panel .preview-card b'),
            ].map((el) => el.innerText);
            // 计入时长手动修改直接参与计算（5.5 个月 -> N = 5.5 x 月工资）
            set(inputs[1], 0);
            set(inputs[3], 5.5);
            await new Promise((r) => setTimeout(r, 150));
            const calcValuesAfterTenureEdit = [
              ...document.querySelectorAll('.severance-panel .preview-card b'),
            ].map((el) => el.innerText);
            const tenureManualRed = inputs[3].classList.contains('tenure-manual');
            // 恢复计算器原值，避免影响后续步骤
            set(inputs[0], 8000);
            set(inputs[1], 0);
            set(inputs[2], 3);
            await setCalcMonths(6);
            await new Promise((r) => setTimeout(r, 100));
            // 通讯录：添加张三
            [...document.querySelectorAll('.sub-tabs button')]
              .find((b) => b.innerText.includes('通讯录'))
              .click();
            await new Promise((r) => setTimeout(r, 120));
            // 未填姓名直接添加 -> 红字提示
            [...document.querySelectorAll('.contacts-panel button')]
              .find((b) => b.innerText.includes('添加人员'))
              .click();
            await new Promise((r) => setTimeout(r, 80));
            const contactNameToast = !!document.querySelector('.center-toast');
            const contactAddWageLabel = (
              [...document.querySelectorAll('.contacts-panel .field span')].find((s) =>
                s.innerText.includes('月工资'),
              ) || {}
            ).innerText;
            const contactAddSegs = [
              ...document.querySelectorAll(
                '.infer-grid .date-segments .seg-select',
              ),
            ];
            await openSeg(contactAddSegs[0]);
            const contactYearOpts = [
              ...contactAddSegs[0].querySelectorAll('.seg-option'),
            ].map((o) => o.getAttribute('data-v'));
            const contactYearMin = contactYearOpts[0];
            const contactYearMax = contactYearOpts[contactYearOpts.length - 1];
            await closeSeg(contactAddSegs[0]);
            // 无效日期（1949 年 + 默认月日，早于 1949-10-01）自动清空并提示
            await setSeg(
              document.querySelector('.infer-grid .date-segments'),
              0,
              '1949',
            );
            await new Promise((r) => setTimeout(r, 120));
            const contactDateInvalidCleared = contactAddSegs.every(
              (s) =>
                s.querySelector('.seg-trigger').innerText.trim() === '—',
            );
            const contactDateInvalidTriggers = contactAddSegs
              .map((s) => s.querySelector('.seg-trigger').innerText.trim())
              .join(',');
            const contactDateToastText =
              [
                ...document.querySelectorAll('.center-toast-text'),
              ]
                .map((t) => t.innerText)
                .join('|');
            const contactDateToastOk = contactDateToastText.includes('入职时间');
            const contactHeaders =
              (document.querySelector('.contacts-panel thead tr') || {}).innerText || '';
            const contactBonusHeader = [
              ...document.querySelectorAll('.contacts-panel thead th'),
            ].some((th) => th.innerText.includes('奖金'));
            const contactName = document.querySelector('.contacts-panel input[type=text]');
            contactName.value = '张三';
            contactName.dispatchEvent(new Event('input'));
            await setSeg(
              document.querySelector('.infer-grid .date-segments'),
              0,
              '2022',
            );
            await setSeg(
              document.querySelector('.infer-grid .date-segments'),
              1,
              '01',
            );
            await setSeg(
              document.querySelector('.infer-grid .date-segments'),
              2,
              '15',
            );
            set(document.querySelector('.contacts-panel .pending-remark-field textarea'), '骨干');
            set(
              document.querySelector('.contacts-panel .infer-grid input[type=number]'),
              8000,
            );
            set(
              [
                ...document.querySelectorAll(
                  '.contacts-panel .infer-grid input[type=number]',
                ),
              ][1],
              1000,
            );
            setSelect(
              document.querySelector('.contacts-panel .pending-rating-select'),
              'good',
            );
            // 张三入职时间改为今天：验证待辞退自动计入时长最低 0.5 个月
            const zhangTodayParts = new Date().toISOString().slice(0, 10).split('-');
            await setSeg(
              document.querySelector('.infer-grid .date-segments'),
              0,
              zhangTodayParts[0],
            );
            await setSeg(
              document.querySelector('.infer-grid .date-segments'),
              1,
              zhangTodayParts[1],
            );
            await setSeg(
              document.querySelector('.infer-grid .date-segments'),
              2,
              zhangTodayParts[2],
            );
            [...document.querySelectorAll('.contacts-panel button')]
              .find((b) => b.innerText.includes('添加人员'))
              .click();
            window.__step = 'contacts-add';
            await new Promise((r) => setTimeout(r, 120));
            const contactRows = [...document.querySelectorAll('.contacts-panel table tbody tr')].map(
              (tr) => tr.innerText,
            );
            const contactTableHeaders = [
              ...document.querySelectorAll('.contacts-panel thead tr:last-child th'),
            ].map((t) => t.innerText);
            const contactHasTenure = contactTableHeaders.some((h) =>
              h.includes('计入时长'),
            );
            const contactHasAvgWage = contactTableHeaders.some((h) =>
              h.includes('平均月工资'),
            );
            const contactHasN = contactTableHeaders.some((h) => h === 'N');
            const contactRowN = (() => {
              const row = [
                ...document.querySelectorAll('.contacts-panel tbody tr[data-id]'),
              ].find(
                (r) =>
                  (r.querySelector('.cell-name') || {}).innerText === '张三',
              );
              if (!row) return '';
              return [...row.children][7] ? [...row.children][7].innerText : '';
            })();
            const contactAvgSelector = !!document.querySelector(
              '.contacts-panel .avg-source-select',
            );
            const contactDragRows = document.querySelectorAll(
              '.contacts-panel tbody tr[data-id]',
            ).length;
            const contactsHandlePad = getComputedStyle(
              document.querySelector('.contacts-panel td:first-child'),
            ).paddingRight;
            // 长按约 350ms 立即变灰代表选中
            const firstContactRow = document.querySelector(
              '.contacts-panel tbody tr[data-id]',
            );
            firstContactRow.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
            await new Promise((r) => setTimeout(r, 500));
            const longPressGray = !!document.querySelector('.contacts-panel tr.is-dragging');
            firstContactRow.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
            // 通讯录列表：板块弹窗编辑（姓名/入职时间/计入时长、月工资/奖金/平均月工资）
            let remarkWidth = 0;
            let ratingWidth = 0;
            const editRow = document.querySelector('.contacts-panel tbody tr[data-id]');
            const cellEditDiag = await (async () => {
              try {
              const out = {};
              const clickCell = async (nth) => {
                editRow.querySelector('td:nth-child(' + nth + ')').click();
                await new Promise((r) => setTimeout(r, 70));
              };
              const clickBtn = async (text) => {
                [...document.querySelectorAll('.block-edit-modal button')]
                  .find((b) => b.innerText.includes(text))
                  .click();
                await new Promise((r) => setTimeout(r, 80));
              };
              const setInput = (sel, v) => {
                const el = document.querySelector(sel);
                el.value = String(v);
                el.dispatchEvent(new Event('input'));
              };
              // 板块一：姓名
              await clickCell(2);
              out.contactDialog = !!document.querySelector('.block-edit-modal');
              out.contactDialogFields = {
                name: !!document.querySelector('.block-edit-modal .block-name-input'),
                dateSegs: document.querySelectorAll(
                  '.block-edit-modal .date-segments .seg-trigger',
                ).length,
                tenure: !!document.querySelector('.block-edit-modal .block-tenure-input'),
                chainArrows:
                  document.querySelectorAll('.block-edit-modal .calc-symbol').length,
              };
              out.actionsLayout = (() => {
                const a = document.querySelector('.block-edit-modal .block-actions');
                return a ? getComputedStyle(a).justifyContent : '';
              })();
              out.actionButtons = [
                ...document.querySelectorAll('.block-edit-modal .block-actions button'),
              ].map((b) => b.innerText);
              setInput('.block-edit-modal .block-name-input', '张三改');
              await clickBtn('确定');
              out.nameAfter = (editRow.querySelector('td:nth-child(2)') || {}).innerText;
              // 取消不保存
              await clickCell(2);
              setInput('.block-edit-modal .block-name-input', '张三X');
              await clickBtn('取消');
              out.nameAfterCancel = (editRow.querySelector('td:nth-child(2)') || {}).innerText;
              await clickCell(2);
              setInput('.block-edit-modal .block-name-input', '张三');
              await clickBtn('确定');
              out.nameRestored = (editRow.querySelector('td:nth-child(2)') || {}).innerText;
              // 板块二：月工资 9000 → 平均月工资联动
              await clickCell(5);
              out.wageDialog = !!document.querySelector('.block-edit-modal');
              out.wageFields = {
                salary: !!document.querySelector('.block-edit-modal .block-wage-input'),
                bonus: !!document.querySelector('.block-edit-modal .block-bonus-input'),
                avg: !!document.querySelector('.block-edit-modal .block-avg-input'),
                symbols:
                  document.querySelectorAll('.block-edit-modal .calc-symbol').length,
              };
              setInput('.block-edit-modal .block-wage-input', 9000);
              await new Promise((r) => setTimeout(r, 80));
              out.avgPreviewInDialog =
                document.querySelector('.block-edit-modal .block-avg-input').value;
              await clickBtn('确定');
              out.salaryAfter = (editRow.querySelector('td:nth-child(5)') || {}).innerText;
              out.avgAfterSalary = (editRow.querySelector('td:nth-child(7)') || {}).innerText;
              out.nAfterSalary = (editRow.querySelector('td:nth-child(8)') || {}).innerText;
              // 平均月工资手动覆盖 → 红字
              await clickCell(5);
              setInput('.block-edit-modal .block-avg-input', 10000);
              await new Promise((r) => setTimeout(r, 80));
              out.avgManualRedInDialog = document
                .querySelector('.block-edit-modal .block-avg-input')
                .classList.contains('avg-manual-red');
              await clickBtn('确定');
              out.avgManualRedRow = editRow
                .querySelector('td:nth-child(7)')
                .classList.contains('avg-manual-red');
              out.nAfterManualAvg = (editRow.querySelector('td:nth-child(8)') || {}).innerText;
              // 改月工资 → 手动平均值清除
              await clickCell(5);
              setInput('.block-edit-modal .block-wage-input', 8001);
              await new Promise((r) => setTimeout(r, 80));
              out.avgAfterWageChangeInDialog =
                document.querySelector('.block-edit-modal .block-avg-input').value;
              await clickBtn('确定');
              out.avgClearedAfterWageEdit = !editRow
                .querySelector('td:nth-child(7)')
                .classList.contains('avg-manual-red');
              await clickCell(5);
              setInput('.block-edit-modal .block-wage-input', 8000);
              await clickBtn('确定');
              // 板块一：计入时长手动 5.5 → 红字
              await clickCell(4);
              setInput('.block-edit-modal .block-tenure-input', 5.5);
              await new Promise((r) => setTimeout(r, 60));
              out.tenureManualRedInDialog = document
                .querySelector('.block-edit-modal .block-tenure-input')
                .classList.contains('tenure-manual');
              await clickBtn('确定');
              out.tenureCell = (editRow.querySelector('td:nth-child(4)') || {}).innerText;
              out.tenureRowRed = !!editRow.querySelector(
                'td:nth-child(4) .red-text',
              );
              // 改入职时间 → 计入时长恢复自动（不再红字）
              await clickCell(3);
              const dateSegs = [
                ...document.querySelectorAll('.block-edit-modal .date-segments .seg-select'),
              ];
              const openSeg = async (seg) => {
                seg.querySelector('.seg-trigger').click();
                await new Promise((r) => setTimeout(r, 60));
              };
              await openSeg(dateSegs[0]);
              [...dateSegs[0].querySelectorAll('.seg-option')]
                .find((o) => o.getAttribute('data-v') === '2022')
                .click();
              await new Promise((r) => setTimeout(r, 60));
              await openSeg(dateSegs[1]);
              [...dateSegs[1].querySelectorAll('.seg-option')]
                .find((o) => o.getAttribute('data-v') === '01')
                .click();
              await new Promise((r) => setTimeout(r, 60));
              await openSeg(dateSegs[2]);
              [...dateSegs[2].querySelectorAll('.seg-option')]
                .find((o) => o.getAttribute('data-v') === '15')
                .click();
              await new Promise((r) => setTimeout(r, 80));
              out.tenureAutoAfterDateChange =
                document.querySelector('.block-edit-modal .block-tenure-input').value;
              out.tenureManualCleared = !document
                .querySelector('.block-edit-modal .block-tenure-input')
                .classList.contains('tenure-manual');
              await clickBtn('确定');
              out.entryDateAfter = (editRow.querySelector('td:nth-child(3)') || {}).innerText;
              out.tenureRowRedAfter = !!editRow.querySelector(
                'td:nth-child(4) .red-text',
              );
              // 评级：常驻下拉菜单直接选择
              const ratingSel = editRow.querySelector(
                'td:nth-child(11) select.rating-cell-select',
              );
              out.ratingPermanent = !!ratingSel;
              ratingWidth = ratingSel ? ratingSel.offsetWidth : 0;
              out.ratingTextAlign = ratingSel
                ? getComputedStyle(ratingSel).textAlign
                : null;
              // 实测“未评级”文字宽度与下拉框可用文字空间（除去内边距与原生箭头）
              out.ratingTextProbe = (() => {
                if (!ratingSel) return null;
                const cs = getComputedStyle(ratingSel);
                const probe = document.createElement('span');
                probe.style.cssText =
                  'font-size:' +
                  cs.fontSize +
                  ';font-family:' +
                  cs.fontFamily +
                  ';font-weight:400;white-space:nowrap;visibility:hidden;position:absolute;';
                probe.textContent = '未评级';
                document.body.appendChild(probe);
                const tw = probe.offsetWidth;
                probe.remove();
                const availNoArrow =
                  ratingSel.clientWidth -
                  parseFloat(cs.paddingLeft) -
                  parseFloat(cs.paddingRight);
                return {
                  textWidth: tw,
                  clientWidth: ratingSel.clientWidth,
                  padL: parseFloat(cs.paddingLeft),
                  padR: parseFloat(cs.paddingRight),
                  availNoArrow: availNoArrow,
                  slackForArrow: availNoArrow - tw,
                };
              })();
              ratingSel.value = 'medium';
              ratingSel.dispatchEvent(new Event('change'));
              await new Promise((r) => setTimeout(r, 60));
              out.ratingValue = editRow.querySelector(
                'td:nth-child(11) select.rating-cell-select',
              ).value;
              out.ratingLabel = editRow.querySelector(
                'td:nth-child(11) select.rating-cell-select',
              ).selectedOptions[0].textContent;
              out.ratingColorClass = editRow.querySelector(
                'td:nth-child(11) select.rating-cell-select',
              ).className;
              const rSelBack = editRow.querySelector(
                'td:nth-child(11) select.rating-cell-select',
              );
              rSelBack.value = 'good';
              rSelBack.dispatchEvent(new Event('change'));
              await new Promise((r) => setTimeout(r, 60));
              // 备注：点击弹窗修改
              await clickCell(12);
              out.remarkDialog =
                !!document.querySelector('.block-edit-modal .remark-modal-textarea');
              remarkWidth = document.querySelector(
                '.block-edit-modal .remark-modal-textarea',
              )
                ? document.querySelector('.block-edit-modal .remark-modal-textarea').offsetWidth
                : 0;
              setInput('.block-edit-modal .remark-modal-textarea', '骨干备注');
              await clickBtn('确定');
              out.remarkAfter = (editRow.querySelector('td:nth-child(12)') || {}).innerText;
              await clickCell(12);
              setInput('.block-edit-modal .remark-modal-textarea', '骨干');
              await clickBtn('确定');
              // N/N+1/2N 只读：点击不弹窗、不出现输入框
              await clickCell(8);
              out.nReadOnly = !document.querySelector('.block-edit-modal') &&
                !editRow.querySelector('td:nth-child(8) input, td:nth-child(8) select');
              // 蓝色分隔线：3px 蓝、整列贯通（断口处检查伪元素宽度）
              out.separators = [4, 8, 11, 12].map((nth) => {
                const td = editRow.querySelector('td:nth-child(' + nth + ')');
                const before = getComputedStyle(td, '::before');
                const th = document.querySelector(
                  '.contacts-panel thead tr:last-child th:nth-child(' + nth + ')',
                );
                const thBefore = getComputedStyle(th, '::before');
                return {
                  tdWidth: before.width,
                  tdBg: before.backgroundColor,
                  thWidth: thBefore.width,
                  thBg: thBefore.backgroundColor,
                };
              });
              // 评级下拉框与右侧分隔线之间应留出间隙（不被竖线侵占）
              out.ratingSelectGap = (() => {
                const sel = editRow.querySelector(
                  'td:nth-child(11) select.rating-cell-select',
                );
                const td12 = editRow.querySelector('td:nth-child(12)');
                if (!sel || !td12) return null;
                const sr = sel.getBoundingClientRect();
                const t12 = td12.getBoundingClientRect();
                return Math.round(t12.left - sr.right);
              })();
              return out;
              } catch (err) {
                return { error: String(err) };
              }
            })();
            const thAlign = getComputedStyle(
              document.querySelector('.contacts-panel thead th'),
            ).textAlign;
            const sortableCount = document.querySelectorAll(
              '.contacts-panel thead th.sortable',
            ).length;
            let addNameWidth = 0;
            let addRemarkWidth = 0;
            let addRatingColor = '';
            let emptyOptionColor = '';
            let uiDiag = 'ok';
            try {
              addNameWidth = document.querySelector(
                '.contacts-panel .add-name-input',
              ).offsetWidth;
              addRemarkWidth = document.querySelector(
                '.contacts-panel .pending-remark-field textarea',
              ).offsetWidth;
              addRatingColor = getComputedStyle(
                document.querySelector('.contacts-panel .pending-rating-select'),
              ).color;
              emptyOptionColor = (() => {
                const opt = document.querySelector(
                  '.contacts-panel select option[value=""]',
                );
                return opt ? getComputedStyle(opt).color : '';
              })();
            } catch (e2) {
              uiDiag = String(e2);
            }
            [...document.querySelectorAll('.contacts-panel thead th')]
              .find((th) => th.innerText.includes('月工资'))
              .click();
            await new Promise((r) => setTimeout(r, 80));
            const salaryHeaderText = [...document.querySelectorAll('.contacts-panel thead th')]
              .find((th) => th.innerText.includes('月工资'))
              .innerText;
            // 右键空白处 -> 排序菜单（含自定义排序）
            document.querySelector('.contacts-list-card').dispatchEvent(
              new MouseEvent('contextmenu', {
                bubbles: true,
                cancelable: true,
                clientX: 130,
                clientY: 200,
              }),
            );
            await new Promise((r) => setTimeout(r, 80));
            const contactsMenuItems = [
              ...document.querySelectorAll('.contacts-panel .context-menu button'),
            ].map((b) => b.innerText);
            [...document.querySelectorAll('.contacts-panel .context-menu button')]
              .find((b) => b.innerText.includes('自定义'))
              .click();
            await new Promise((r) => setTimeout(r, 80));
            // 人员列表行内（空白处）右键也应弹出菜单
            document.querySelector('.contacts-panel tbody tr[data-id]').dispatchEvent(
              new MouseEvent('contextmenu', {
                bubbles: true,
                cancelable: true,
                clientX: 160,
                clientY: 230,
              }),
            );
            await new Promise((r) => setTimeout(r, 80));
            const contactsRowMenu = !!document.querySelector(
              '.contacts-panel .context-menu',
            );
            [...document.querySelectorAll('.contacts-panel .context-menu button')]
              .find((b) => b.innerText.includes('自定义'))
              .click();
            await new Promise((r) => setTimeout(r, 60));
            // 人员列表长按拖动锁定测试：长按进入拖动后指针锁死在框内
            const contactsDragRow = document.querySelector(
              '.contacts-panel tbody tr[data-id]',
            );
            const contactsCardRect = document
              .querySelector('.contacts-list-card')
              .getBoundingClientRect();
            contactsDragRow.dispatchEvent(
              new MouseEvent('mousedown', { button: 0, bubbles: true }),
            );
            await new Promise((r) => setTimeout(r, 260));
            const contactsDragLockActive =
              document.body.classList.contains('drag-lock') &&
              !!document.querySelector('.drag-fake-cursor') &&
              contactsDragRow.classList.contains('is-dragging');
            document.dispatchEvent(
              new MouseEvent('mousemove', {
                bubbles: true,
                clientX: contactsCardRect.left - 200,
                clientY: contactsCardRect.top - 200,
              }),
            );
            await new Promise((r) => setTimeout(r, 100));
            const contactsDragLockOutsideKept =
              contactsDragRow.classList.contains('is-dragging') &&
              document.body.classList.contains('drag-lock');
            document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
            await new Promise((r) => setTimeout(r, 80));
            const contactsDragLockReleased = !document.body.classList.contains(
              'drag-lock',
            );
            const salaryHeaderAfter = [...document.querySelectorAll('.contacts-panel thead th')]
              .find((th) => th.innerText.includes('月工资'))
              .innerText;
            const nameInputWidth = document.querySelector(
              '.contacts-panel .add-name-input',
            ).offsetWidth;
            // 通讯录删除需确认（先取消，保留人员）
            [...document.querySelectorAll('.contacts-panel button')]
              .find((b) => b.innerText.includes('删除'))
              .click();
            await new Promise((r) => setTimeout(r, 100));
            const contactDeleteConfirm = !!document.querySelector('.confirm-mask');
            const confirmRight = getComputedStyle(
              document.querySelector('.confirm-card .actions'),
            ).justifyContent;
            const confirmButtons = [
              ...document.querySelectorAll('.confirm-card .actions button'),
            ].map((b) => b.innerText);
            [...document.querySelectorAll('.confirm-card .actions button')]
              .find((b) => b.innerText.includes('取消'))
              .click();
            await new Promise((r) => setTimeout(r, 80));
            // 添加李四（评级中等）、王五（未评级），用于下拉过滤与月工资联动测试
            const addContactQuick = (nm, sal, rating) => {
              const nInput = document.querySelector('.contacts-panel input[type=text]');
              nInput.value = nm;
              nInput.dispatchEvent(new Event('input'));
              set(
                document.querySelector(
                  '.contacts-panel .infer-grid input[type=number]',
                ),
                sal,
              );
              setSelect(
                document.querySelector('.contacts-panel .pending-rating-select'),
                rating,
              );
              [...document.querySelectorAll('.contacts-panel button')]
                .find((b) => b.innerText.includes('添加人员'))
                .click();
            };
            addContactQuick('李四', 9000, 'medium');
            await new Promise((r) => setTimeout(r, 100));
            addContactQuick('王五', 10000, '');
            await new Promise((r) => setTimeout(r, 100));
            // 待辞退：从通讯录添加
            [...document.querySelectorAll('.sub-tabs button')]
              .find((b) => b.innerText.includes('待辞退'))
              .click();
            await new Promise((r) => setTimeout(r, 120));
            const pendSelects = [...document.querySelectorAll('.infer-grid select')];
            const contactOpt = pendSelects[0].options[1];
            const contactId = contactOpt ? contactOpt.value : '';
            setSelect(pendSelects[0], contactId);
            await new Promise((r) => setTimeout(r, 120));
            const pendingMonthsAuto = (() => {
              const inputs = document.querySelectorAll(
                '.infer-grid input[type=number]',
              );
              return inputs[3] ? inputs[3].value : '';
            })();
            const tenureChain = !!document.querySelector(
              '.infer-grid .tenure-chain-row',
            );
            const pendingEntryYear = (
              document.querySelector(
                '.infer-grid .tenure-chain .date-segments .seg-trigger',
              ) || {}
            ).innerText;
            const workMonthSeg = !!document.querySelector(
              '.infer-grid .tenure-chain .months-select .seg-trigger',
            );
            const pendingYearsZeroShown = (() => {
              const el = document.querySelector(
                '.infer-grid .tenure-chain .years-input',
              );
              return el ? el.value === '0' : false;
            })();
            const workMonthWidth = (() => {
              const el = document.querySelector(
                '.infer-grid .tenure-chain .months-select',
              );
              return el ? el.offsetWidth : 0;
            })();
            const pendingRatingField = !!document.querySelector(
              '.infer-grid .pending-rating-field',
            );
            const ratingSameRow = (() => {
              const person = document.querySelector(
                '.infer-grid .field:nth-child(1)',
              );
              const rating = document.querySelector(
                '.infer-grid .pending-rating-field',
              );
              if (!person || !rating) return false;
              return (
                Math.abs(
                  person.getBoundingClientRect().top -
                    rating.getBoundingClientRect().top,
                ) < 24
              );
            })();
            const addAfterRating = (() => {
              const addBtn = document.querySelector(
                '.infer-grid .add-btn-right button',
              );
              const rating = document.querySelector(
                '.infer-grid .pending-rating-select',
              );
              if (!addBtn || !rating) return false;
              return (
                addBtn.getBoundingClientRect().left >
                rating.getBoundingClientRect().left
              );
            })();
            const pendingRemarkField = !!document.querySelector(
              '.infer-grid .pending-remark-field',
            );
            const previewCards = document.querySelectorAll(
              '.pending-panel .preview-card',
            ).length;
            const previewN = (
              document.querySelector('.pending-panel .preview-card b') || {}
            ).innerText;
            const previewCardWidth = (() => {
              const el = document.querySelector('.pending-panel .preview-card');
              return el ? el.offsetWidth : 0;
            })();
            const pendingSegYearWidth = (() => {
              const el = document.querySelector(
                '.infer-grid .tenure-chain .date-segments .seg-year',
              );
              return el ? el.offsetWidth : 0;
            })();
            const chainSegsWidth = (() => {
              const el = document.querySelector(
                '.infer-grid .tenure-chain .date-segments',
              );
              return el ? el.offsetWidth : 0;
            })();
            const chainYearsRowWidth = (() => {
              const el = document.querySelector(
                '.infer-grid .tenure-chain .years-row',
              );
              return el ? el.offsetWidth : 0;
            })();
            const chainTenureInputWidth = (() => {
              const el = document.querySelector(
                '.infer-grid .tenure-input',
              );
              return el ? el.offsetWidth : 0;
            })();
            const chainWageInputs = [
              ...document.querySelectorAll(
                '.infer-grid .wage-bonus-row input',
              ),
            ].map((i) => i.offsetWidth);
            const chainTenureWidthAfter = (
              document.querySelector('.infer-grid .tenure-input') || {}
            ).offsetWidth;
            const alignDiag = (() => {
              const wl = [
                ...document.querySelectorAll(
                  '.infer-grid .wage-bonus-labels span',
                ),
              ];
              const wi = [
                ...document.querySelectorAll(
                  '.infer-grid .wage-bonus-row input',
                ),
              ];
              const cl = [
                ...document.querySelectorAll(
                  '.infer-grid .tenure-chain-labels span',
                ),
              ];
              const ci = [
                document.querySelector(
                  '.infer-grid .tenure-chain .date-segments',
                ),
                document.querySelector(
                  '.infer-grid .tenure-chain .years-row',
                ),
                document.querySelector('.infer-grid .tenure-input'),
              ];
              const gap = (a, b) =>
                Math.round(
                  b.getBoundingClientRect().left +
                    b.getBoundingClientRect().width / 2 -
                    (a.getBoundingClientRect().left +
                      a.getBoundingClientRect().width / 2),
                );
              return JSON.stringify({
                wage: [0, 2, 4].map((i) => gap(wl[i], wi[i / 2])),
                chain: [0, 2, 4].map((i) => gap(cl[i], ci[i / 2])),
              });
            })();
            const contactSegYearWidth = (() => {
              const el = document.querySelector(
                '.infer-grid .date-segments .seg-year',
              );
              return el ? el.offsetWidth : 0;
            })();
            const pendingWageAuto = (() => {
              const inputs = document.querySelectorAll(
                '.infer-grid input[type=number]',
              );
              return inputs[0] ? inputs[0].value : '';
            })();
            const pendingBonusAuto = (() => {
              const inputs = document.querySelectorAll(
                '.infer-grid input[type=number]',
              );
              return inputs[1] ? inputs[1].value : '';
            })();
            const pendingWageLabel = (
              document.querySelector('.infer-grid .field:nth-child(2) > span') || {}
            ).innerText;
            const pendingOptionRatingClass = (() => {
              const opt = [
                ...document.querySelectorAll('.infer-grid select option'),
              ].find((o) => o.innerText.includes('张三'));
              return opt ? opt.className : '';
            })();
            // 计入时长最多 6 个字符（手动输入同样限制）
            const pendMonthsInput0 = document.querySelectorAll(
              '.infer-grid input[type=number]',
            )[3];
            set(pendMonthsInput0, 1000.55);
            await new Promise((r) => setTimeout(r, 80));
            const pendingMonths6 = pendMonthsInput0.value;
            // 平均工资来源选择器
            const avgSourceRow = !!document.querySelector('.avg-source-row');
            const avgLabelText = (
              document.querySelector('.avg-source-row > span') || {}
            ).innerText;
            const headH2 = document.querySelector('.pending-head h2');
            const avgLabel = document.querySelector('.avg-source-row > span');
            const pendingHeadInline =
              !!headH2 &&
              !!avgLabel &&
              Math.abs(
                headH2.getBoundingClientRect().top +
                  headH2.getBoundingClientRect().height / 2 -
                  (avgLabel.getBoundingClientRect().top +
                    avgLabel.getBoundingClientRect().height / 2),
              ) < 6;
            const pendingHeadGap = Math.round(
              avgLabel.getBoundingClientRect().left -
                headH2.getBoundingClientRect().right,
            );
            const headAlignDiag = (() => {
              const h2r = headH2.getBoundingClientRect();
              const h2c = h2r.top + h2r.height / 2;
              const avgRow = document.querySelector(
                '.pending-head .avg-source-row',
              );
              const arr = avgRow.getBoundingClientRect();
              const avc = arr.top + arr.height / 2;
              const labelC =
                avgLabel.getBoundingClientRect().top +
                avgLabel.getBoundingClientRect().height / 2;
              return JSON.stringify({
                h2c: Math.round(h2c),
                rowC: Math.round(avc),
                labelC: Math.round(labelC),
                h2h: Math.round(h2r.height),
                rowH: Math.round(arr.height),
                align: getComputedStyle(
                  document.querySelector('.pending-head'),
                ).alignItems,
              });
            })();
            const labelNoWrap =
              avgLabel.scrollWidth <= avgLabel.clientWidth + 1;
            const avgOptions = [...document.querySelectorAll('.avg-source-select option')].map(
              (o) => o.innerText,
            );
            const avgSelect = document.querySelector('.avg-source-select');
            setSelect(avgSelect, 'onPost');
            await new Promise((r) => setTimeout(r, 80));
            const avgUrbanRed = avgSelect.classList.contains('urban-red');
            const avgAllUnitOptionColor = (() => {
              const opt = [...document.querySelectorAll('.avg-source-select option')].find(
                (o) => o.value === 'allUnit',
              );
              return opt ? getComputedStyle(opt).color : '';
            })();
            const avgInput = document.querySelector('.avg-input');
            const avgOnPostValue = avgInput.value;
            setSelect(avgSelect, 'nonPrivate');
            await new Promise((r) => setTimeout(r, 80));
            const avgNonPrivateValue = avgInput.value;
            setSelect(avgSelect, 'onPost');
            await new Promise((r) => setTimeout(r, 80));
            set(avgInput, 20000);
            await new Promise((r) => setTimeout(r, 80));
            const avgManualRed = avgInput.classList.contains('avg-manual');
            const pendInputs = [
              ...document.querySelectorAll('.infer-grid input[type=number]'),
            ];
            set(pendInputs[0], 8000);
            set(pendInputs[1], 0);
            await new Promise((r) => setTimeout(r, 100));
            const wageBonusGroup = !!document.querySelector(
              '.infer-grid .wage-bonus-row',
            );
            const avgPartValue = (
              document.querySelector('.infer-grid .avg-part-input') || {}
            ).value;
            const pendingAvgManualRed = ((
              document.querySelector('.infer-grid .avg-part-input') || {}
            ).classList || {}).contains('avg-manual-red');
            // 手动修改计入时长：5.5 个月，红字
            set(pendInputs[3], 5.5);
            await new Promise((r) => setTimeout(r, 120));
            [...document.querySelectorAll('.pending-panel button')]
              .find((b) => b.innerText.includes('添加'))
              .click();
            window.__step = 'pending-add';
            await new Promise((r) => setTimeout(r, 120));
            const pendRows = [...document.querySelectorAll('.pending-panel table tbody tr')].map(
              (tr) => tr.innerText,
            );
            const pendingMonthsText =
              (document.querySelector('.pending-panel tbody tr[data-id] td:nth-child(4)') || {})
                .innerText || '';
            const manualRedCount = document.querySelectorAll('.pending-panel .red-text').length;
            const pendingHeaders =
              (document.querySelector('.pending-panel thead tr') || {}).innerText || '';
            const pendingThAlign = (() => {
              const ths = [
                ...document.querySelectorAll('.pending-panel thead tr:last-child th'),
              ];
              if (!ths.length) return '';
              return [
                getComputedStyle(ths[2]).textAlign,
                getComputedStyle(ths[12]).textAlign,
              ].join(',');
            })();
            const pendingRemarkHeader = pendingHeaders.includes('备注');
            const pendingBonusHeader = pendingHeaders.includes('奖金');
            const pendingTotalHeader = pendingHeaders.includes('平均月工资');
            const tipCount = document.querySelectorAll('.pending-panel .tip').length;
            const tipTextsCount = document.querySelectorAll('.pending-panel .tip-tip').length;
            const pendingTipTitles = document.querySelectorAll(
              '.pending-panel .tip[title]',
            ).length;
            const tipNNewline = (
              (document.querySelector('.pending-panel .tip-tip') || {}).innerText || ''
            ).includes('\\n');
            // 已添加人员不再显示在下拉菜单
            const pendingOptionsAfterAdd = [
              ...document.querySelectorAll('.infer-grid select option'),
            ].map((o) => o.innerText);
            const addedContactHidden = !pendingOptionsAfterAdd.some((t) =>
              t.includes('张三'),
            );
            // 选择李四（未手动改工资）-> 添加为联动行
            setSelect(
              document.querySelector('.infer-grid select'),
              document.querySelector('.infer-grid select').options[1].value,
            );
            await new Promise((r) => setTimeout(r, 120));
            const linkedWageAuto = (() => {
              const inputs = document.querySelectorAll('.infer-grid input[type=number]');
              return inputs[0].value;
            })();
            const linkedWageInputRed = document
              .querySelector('.infer-grid input[type=number]')
              .classList.contains('wage-manual');
            [...document.querySelectorAll('.pending-panel button')]
              .find((b) => b.innerText.includes('添加'))
              .click();
            await new Promise((r) => setTimeout(r, 120));
            const linkedRowNoRed = ![...document.querySelectorAll('.pending-panel tbody tr[data-id]')]
              .pop().querySelector('.red-text');
            const pendingRowsAfterAdds = document.querySelectorAll(
              '.pending-panel table tbody tr',
            ).length;
            // 长按拖动锁定测试：长按进入拖动后，指针移出框外不取消；松开后恢复
            const pendingDragRow = document.querySelector(
              '.pending-panel tbody tr[data-id]',
            );
            const pendingCardRect = document
              .querySelector('.pending-list-card')
              .getBoundingClientRect();
            pendingDragRow.dispatchEvent(
              new MouseEvent('mousedown', {
                button: 0,
                bubbles: true,
                clientX: 300,
                clientY: 300,
              }),
            );
            await new Promise((r) => setTimeout(r, 260));
            const fakeCursorPosAtSelect = (() => {
              const el = document.querySelector('.drag-fake-cursor');
              return el ? el.style.transform : '';
            })();
            const pendingDragLockActive =
              document.body.classList.contains('drag-lock') &&
              !!document.querySelector('.drag-fake-cursor') &&
              pendingDragRow.classList.contains('is-dragging');
            document.dispatchEvent(
              new MouseEvent('mousemove', {
                bubbles: true,
                clientX: pendingCardRect.left - 200,
                clientY: pendingCardRect.top - 200,
              }),
            );
            await new Promise((r) => setTimeout(r, 100));
            const pendingDragLockOutsideKept =
              pendingDragRow.classList.contains('is-dragging') &&
              !!document.querySelector('.drag-fake-cursor') &&
              document.body.classList.contains('drag-lock');
            document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
            await new Promise((r) => setTimeout(r, 80));
            const pendingDragLockReleased =
              !document.body.classList.contains('drag-lock') &&
              !document.querySelector('.drag-fake-cursor') &&
              !pendingDragRow.classList.contains('is-dragging');
            // 待辞退列表框内重排：长按第一行移动到第二行，顺序应变化
            const pendingRowsNow = () => [
              ...document.querySelectorAll('.pending-panel tbody tr[data-id]'),
            ];
            const pendingOrderBefore = pendingRowsNow().map((r) => r.dataset.id);
            const pendingRow0 = pendingRowsNow()[0];
            const pendingRow1 = pendingRowsNow()[1];
            const pendingRow1Rect = pendingRow1.getBoundingClientRect();
            pendingRow0.dispatchEvent(
              new MouseEvent('mousedown', { button: 0, bubbles: true }),
            );
            await new Promise((r) => setTimeout(r, 260));
            document.dispatchEvent(
              new MouseEvent('mousemove', {
                bubbles: true,
                clientX: pendingRow1Rect.left + 20,
                clientY: pendingRow1Rect.top + pendingRow1Rect.height / 2,
              }),
            );
            await new Promise((r) => setTimeout(r, 120));
            const pendingOrderAfter = pendingRowsNow().map((r) => r.dataset.id);
            const pendingDragReorder =
              JSON.stringify(pendingOrderBefore) !==
              JSON.stringify(pendingOrderAfter);
            document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
            await new Promise((r) => setTimeout(r, 80));
            const pendingSortable = document.querySelectorAll(
              '.pending-panel thead th.sortable',
            ).length;
            // 待辞退列表：分区内右键弹出排序菜单（含自定义排序）
            document
              .querySelector('.pending-list-card')
              .dispatchEvent(
                new MouseEvent('contextmenu', {
                  bubbles: true,
                  cancelable: true,
                  clientX: 220,
                  clientY: 220,
                }),
              );
            await new Promise((r) => setTimeout(r, 80));
            const pendingMenuItems = [
              ...document.querySelectorAll('.pending-panel .context-menu button'),
            ].map((b) => b.innerText);
            [...document.querySelectorAll('.pending-panel .context-menu button')]
              .find((b) => b.innerText.includes('自定义'))
              .click();
            await new Promise((r) => setTimeout(r, 80));
            const pendingMenuClosed = !document.querySelector(
              '.pending-panel .context-menu',
            );
            // 右键弹出菜单后，点击非菜单区域应关闭菜单
            document
              .querySelector('.pending-list-card')
              .dispatchEvent(
                new MouseEvent('contextmenu', {
                  bubbles: true,
                  cancelable: true,
                  clientX: 220,
                  clientY: 220,
                }),
              );
            await new Promise((r) => setTimeout(r, 80));
            document.dispatchEvent(new MouseEvent('click', { bubbles: true }));
            await new Promise((r) => setTimeout(r, 60));
            const pendingMenuOutsideClosed = !document.querySelector(
              '.pending-panel .context-menu',
            );
            const pendingDragRows = document.querySelectorAll(
              '.pending-panel tbody tr[data-id]',
            ).length;
            const pendingAddGrid = !!document.querySelector('.infer-grid');
            const monthsInputCount = document.querySelectorAll(
              '.infer-grid .field input',
            ).length;
            const pendingNameAlign = getComputedStyle(
              document.querySelector('.pending-panel td:nth-child(2)'),
            ).textAlign;
            const pendingDataAlignLeft =
              getComputedStyle(
                document.querySelector('.pending-panel td:nth-child(3)'),
              ).textAlign === 'left';
            const pendingNameCellWidth = document.querySelector(
              '.pending-panel td:nth-child(2)',
            ).offsetWidth;
            const pendingNameWrap =
              getComputedStyle(
                document.querySelector('.pending-panel td:nth-child(2)'),
              ).whiteSpace === 'normal';
            const pendingRemarkWrap =
              getComputedStyle(
                document.querySelector('.pending-panel td:nth-child(10)'),
              ).whiteSpace === 'normal';
            const pendingHandlePad = getComputedStyle(
              document.querySelector('.pending-panel td:first-child'),
            ).paddingRight;
            // 待辞退删除需确认
            [...document.querySelectorAll('.pending-panel button')]
              .find((b) => b.innerText.includes('删除'))
              .click();
            await new Promise((r) => setTimeout(r, 100));
            const pendingDeleteConfirm = !!document.querySelector('.confirm-mask');
            const pendingDeleteText =
              (document.querySelector('.confirm-card .confirm-danger-text') || {}).innerText || '';
            const pendingDeleteNameOk = pendingDeleteText.includes('张三');
            const pendingDeleteNewText = pendingDeleteText.includes(
              '是否在待辞退列表中移除员工',
            );
            [...document.querySelectorAll('.confirm-card .actions button')]
              .find((b) => b.innerText.includes('取消'))
              .click();
            // 通讯录删除员工 -> 待辞退记录同步移除 + 提示文字
            [...document.querySelectorAll('.sub-tabs button')]
              .find((b) => b.innerText.includes('通讯录'))
              .click();
            await new Promise((r) => setTimeout(r, 120));
            [...document.querySelectorAll('.contacts-panel button')]
              .find((b) => b.innerText.includes('删除'))
              .click();
            await new Promise((r) => setTimeout(r, 100));
            const contactDeleteText =
              (document.querySelector('.confirm-card .confirm-danger-text') || {}).innerText || '';
            const contactDeleteNewText = contactDeleteText.includes('是否移除员工');
            [...document.querySelectorAll('.confirm-card .actions button')]
              .find((b) => b.innerText.includes('确认'))
              .click();
            await new Promise((r) => setTimeout(r, 120));
            [...document.querySelectorAll('.sub-tabs button')]
              .find((b) => b.innerText.includes('待辞退'))
              .click();
            await new Promise((r) => setTimeout(r, 120));
            const pendingRowsAfterContactDelete = document.querySelectorAll(
              '.pending-panel table tbody tr[data-id]',
            ).length;
            // 回收站：可恢复被删除员工（含待辞退记录）
            [...document.querySelectorAll('.sub-tabs button')]
              .find((b) => b.innerText.includes('通讯录'))
              .click();
            await new Promise((r) => setTimeout(r, 120));
            const recycleBtnExists = !!document.querySelector('.recycle-btn');
            document.querySelector('.recycle-btn').click();
            await new Promise((r) => setTimeout(r, 100));
            const recycleHeaders =
              (document.querySelector('.recycle-table thead tr') || {}).innerText || '';
            const recycleRows = [...document.querySelectorAll('.recycle-table tbody tr')].map(
              (r) => r.innerText,
            );
            const recycleNameFound = recycleRows.some((t) => t.includes('张三'));
            const recycleOpButtons = document.querySelectorAll(
              '.recycle-table tbody tr[data-id] td:last-child button',
            ).length;
            [...document.querySelectorAll('.recycle-table tbody button')]
              .find((b) => b.innerText.includes('恢复'))
              .click();
            await new Promise((r) => setTimeout(r, 120));
            document.querySelector('.recycle-modal .modal-close').click();
            await new Promise((r) => setTimeout(r, 80));
            const contactRowsAfterRestore = document.querySelectorAll(
              '.contacts-panel tbody tr[data-id]',
            ).length;
            [...document.querySelectorAll('.sub-tabs button')]
              .find((b) => b.innerText.includes('待辞退'))
              .click();
            await new Promise((r) => setTimeout(r, 120));
            const pendingRowsAfterRestore = document.querySelectorAll(
              '.pending-panel tbody tr[data-id]',
            ).length;
            // 月工资联动测试：通讯录改月工资 -> 待辞退跟随；手动输入则红字固定
            [...document.querySelectorAll('.sub-tabs button')]
              .find((b) => b.innerText.includes('通讯录'))
              .click();
            await new Promise((r) => setTimeout(r, 120));
            // 改李四月工资为 9500 -> 待辞退联动行跟随
            const liRowEl = [
              ...document.querySelectorAll('.contacts-panel tbody tr[data-id]'),
            ].find(
              (r) => (r.querySelector('.cell-name') || {}).innerText === '李四',
            );
            if (!liRowEl) {
              throw new Error('NO_LISI');
            }
            [...document.querySelectorAll('.sub-tabs button')]
              .find((b) => b.innerText.includes('待辞退'))
              .click();
            await new Promise((r) => setTimeout(r, 120));
            const linkedRowWageAfter = (() => {
              const rows = [...document.querySelectorAll('.pending-panel tbody tr[data-id]')];
              const liRow = rows.find((r) => r.innerText.includes('李四'));
              return liRow ? liRow.innerText : 'NO_ROW';
            })();
            // 手动输入月平均工资（选择王五）-> 输入框与列表红字
            const pendSelect3 = document.querySelector('.infer-grid select');
            const wangWuOpt = [...pendSelect3.options].find((o) =>
              o.innerText.includes('王五'),
            );
            setSelect(pendSelect3, wangWuOpt.value);
            await new Promise((r) => setTimeout(r, 120));
            const wageInputs = document.querySelectorAll('.infer-grid input[type=number]');
            set(wageInputs[0], 7000);
            set(wageInputs[1], 1000);
            await new Promise((r) => setTimeout(r, 80));
            const manualWageInputRed = wageInputs[0].classList.contains('wage-manual');
            [...document.querySelectorAll('.pending-panel button')]
              .find((b) => b.innerText.includes('添加'))
              .click();
            await new Promise((r) => setTimeout(r, 100));
            const manualRowWageRed = (() => {
              const rows = [...document.querySelectorAll('.pending-panel tbody tr[data-id]')];
              const wangRow = rows.find((r) => r.innerText.includes('王五'));
              return wangRow
                ? wangRow.innerText.includes('7,000.00') &&
                    !!wangRow.querySelector('.red-text')
                : false;
            })();
            const manualRowBonusTotal = (() => {
              const rows = [...document.querySelectorAll('.pending-panel tbody tr[data-id]')];
              const wangRow = rows.find((r) => r.innerText.includes('王五'));
              window.__wangRow = wangRow ? wangRow.innerText : 'NO_ROW';
              return wangRow
                ? wangRow.innerText.includes('7,083.33') &&
                    wangRow.innerText.includes('3,541.67')
                : false;
            })();
            // 公司切换与公司管理
            const companySelect = !!document.querySelector('.company-current');
            document.querySelector('.company-current').click();
            await new Promise((r) => setTimeout(r, 100));
            const companyMenuItems = [...document.querySelectorAll('.company-menu-item')].map(
              (b) => b.innerText,
            );
            document.querySelector('.nav-gear-btn[title="公司管理"]').click();
            window.__step = 'company-open';
            await new Promise((r) => setTimeout(r, 120));
            const companyModal = !!document.querySelector('.modal-card');
            const companyTitle = (document.querySelector('.modal-card h2') || {}).innerText;
            const companySearch = !!document.querySelector('.company-search');
            const companySortBtn = (document.querySelector('.company-sort-btn') || {}).innerText;
            const dragHandles = document.querySelectorAll('.company-drag').length;
            const dragRows = document.querySelectorAll('.company-row[data-id]').length;
            const selectedRow = !!document.querySelector('.company-row.selected');
            // 行右键 -> 行菜单（含导出）
            document.querySelector('.company-row').dispatchEvent(
              new MouseEvent('contextmenu', {
                bubbles: true,
                cancelable: true,
                clientX: 110,
                clientY: 130,
              }),
            );
            await new Promise((r) => setTimeout(r, 80));
            const rowMenuItems = [...document.querySelectorAll('.context-menu button')].map(
              (b) => b.innerText,
            );
            document.dispatchEvent(new MouseEvent('click'));
            await new Promise((r) => setTimeout(r, 60));
            // 空白处右键 -> 排序菜单
            document.querySelector('.company-modal').dispatchEvent(
              new MouseEvent('contextmenu', {
                bubbles: true,
                cancelable: true,
                clientX: 120,
                clientY: 150,
              }),
            );
            await new Promise((r) => setTimeout(r, 80));
            const ctxMenuItems = [...document.querySelectorAll('.context-menu button')].map(
              (b) => b.innerText,
            );
            // 切到首字母排序 -> 拖动图标隐藏
            [...document.querySelectorAll('.context-menu button')]
              .find((b) => b.innerText.includes('首字母'))
              .click();
            await new Promise((r) => setTimeout(r, 80));
            const dragHandlesAlpha = document.querySelectorAll('.company-drag').length;
            // 切回自定义排序
            document.querySelector('.company-modal').dispatchEvent(
              new MouseEvent('contextmenu', {
                bubbles: true,
                cancelable: true,
                clientX: 120,
                clientY: 150,
              }),
            );
            await new Promise((r) => setTimeout(r, 80));
            [...document.querySelectorAll('.context-menu button')]
              .find((b) => b.innerText.includes('自定义'))
              .click();
            await new Promise((r) => setTimeout(r, 80));
            // 公司列表长按拖动锁定测试：长按进入拖动后指针锁死在列表框内
            const companyDragRow = document.querySelector('.company-row[data-id]');
            const companyListRect = document
              .querySelector('.company-list')
              .getBoundingClientRect();
            companyDragRow.dispatchEvent(
              new MouseEvent('mousedown', { button: 0, bubbles: true }),
            );
            await new Promise((r) => setTimeout(r, 260));
            const companyDragLockActive =
              document.body.classList.contains('drag-lock') &&
              !!document.querySelector('.drag-fake-cursor') &&
              companyDragRow.classList.contains('is-dragging');
            document.dispatchEvent(
              new MouseEvent('mousemove', {
                bubbles: true,
                clientX: companyListRect.left - 200,
                clientY: companyListRect.top - 200,
              }),
            );
            await new Promise((r) => setTimeout(r, 100));
            const companyDragLockOutsideKept =
              companyDragRow.classList.contains('is-dragging') &&
              document.body.classList.contains('drag-lock');
            document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
            await new Promise((r) => setTimeout(r, 80));
            const companyDragLockReleased = !document.body.classList.contains(
              'drag-lock',
            );
            // 未输入名称点"添加公司"：红色居中提示，3 秒后消失
            const companyNameInput = document.querySelector(
              '.modal-card .company-name-input',
            );
            companyNameInput.value = '';
            companyNameInput.dispatchEvent(new Event('input'));
            [...document.querySelectorAll('.modal-card button')]
              .find((b) => b.innerText.includes('添加公司'))
              .click();
            await new Promise((r) => setTimeout(r, 120));
            const companyNameToast = (
              (document.querySelector('.center-toast-text') || {}).innerText || ''
            ).includes('请填写公司名称');
            const newCompany = document.querySelector('.modal-card input[type=text]');
            newCompany.value = 'xx制造有限责任公司';
            newCompany.dispatchEvent(new Event('input'));
            [...document.querySelectorAll('.modal-card button')]
              .find((b) => b.innerText.includes('添加公司'))
              .click();
            window.__step = 'company-add';
            await new Promise((r) => setTimeout(r, 120));
            // 框内拖动重排：长按第一行移动到第二行，顺序应变化
            const companyRowsNow = () => [
              ...document.querySelectorAll('.company-row[data-id]'),
            ];
            const companyOrderBefore = companyRowsNow().map((r) =>
              r.querySelector('.company-row-name').innerText,
            );
            const companyRow0 = companyRowsNow()[0];
            const companyRow1 = companyRowsNow()[1];
            const companyRow1Rect = companyRow1.getBoundingClientRect();
            companyRow0.dispatchEvent(
              new MouseEvent('mousedown', { button: 0, bubbles: true }),
            );
            await new Promise((r) => setTimeout(r, 260));
            const companyDragProbe = (() => {
              const el = document.elementFromPoint(
                companyRow1Rect.left + 20,
                companyRow1Rect.top + companyRow1Rect.height / 2,
              );
              return el ? (el.className || el.tagName) : 'NULL';
            })();
            const row0DraggingAtMove = companyRow0.classList.contains('is-dragging');
            document.dispatchEvent(
              new MouseEvent('mousemove', {
                bubbles: true,
                clientX: companyRow1Rect.left + 20,
                clientY: companyRow1Rect.top + companyRow1Rect.height / 2,
              }),
            );
            await new Promise((r) => setTimeout(r, 120));
            const fakeCursorTransform = (() => {
              const el = document.querySelector('.drag-fake-cursor');
              return el ? el.style.transform : 'NO_EL';
            })();
            const companyOrderAfter = companyRowsNow().map((r) =>
              r.querySelector('.company-row-name').innerText,
            );
            const companyDragReorder =
              JSON.stringify(companyOrderBefore) !==
              JSON.stringify(companyOrderAfter);
            document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
            await new Promise((r) => setTimeout(r, 80));
            // 点击新公司行 -> 询问是否切换
            [...document.querySelectorAll('.company-row')]
              .find((r) => r.innerText.includes('xx制造'))
              .click();
            await new Promise((r) => setTimeout(r, 100));
            const switchConfirm = !!document.querySelector('.confirm-mask');
            [...document.querySelectorAll('.confirm-card .actions button')]
              .find((b) => b.innerText.includes('确认切换'))
              .click();
            await new Promise((r) => setTimeout(r, 120));
            document.querySelector('.modal-close').click();
            window.__step = 'company-close';
            await new Promise((r) => setTimeout(r, 150));
            document.querySelector('.company-current').click();
            await new Promise((r) => setTimeout(r, 100));
            const companyOptions = [...document.querySelectorAll('.company-menu-item')].map(
              (b) => b.innerText,
            );
            [...document.querySelectorAll('.company-menu-item')]
              .find((b) => b.innerText.includes('xx制造'))
              .click();
            await new Promise((r) => setTimeout(r, 100));
            const currentCompany = document.querySelector('.company-current').innerText;
            // 赔偿设置
            document.querySelector('.nav-gear-btn[title="赔偿默认设置"]').click();
            window.__step = 'severance-settings';
            await new Promise((r) => setTimeout(r, 120));
            const settingsModal = !!document.querySelector('.modal-card');
            document.querySelector('.modal-card .modal-close').click();
            return JSON.stringify({
              panel,
              subTabs,
              calcValues,
              tenureMonthsAuto,
              yearsInputWidth,
              bonusDefaultEmpty,
              calcWageLabelWidth,
              bonusInputWidth,
              wageInputWidth,
              yearsZeroEmpty,
              yearsKeyPlus,
              yearsKeyMinus,
              tenureInputWidth,
              tenure6Char,
              calcDetailGone,
              yearsMax2Digits,
              yearsThirdBlocked,
              calcValuesAfterTenureEdit,
              tenureManualRed,
              calcAvgSelector,
              calcAvgLabel,
              calcAvgManualRed,
              calcWageLabel,
              calcBonusLabel,
              calcYearsLabel,
              calcWageChain,
              calcTenureChain,
              calcWageTip,
              calcPreviewCards,
              calcOverlapDiag,
              calcHeadDiag,
              calcEntryDateExists,
              calcYearsAuto,
              calcYearsAfterInvalid,
              calcYearMin,
              calcYearMax,
              popup0open,
              popup0closed,
              popup1open,
              popupCountAfterYear,
              popupCountAfterMonth,
              dayPopupCols,
              capHintText,
              capHintOk,
              tenureAfterCap,
              calcValuesAfterCap,
              nPlus1Capped,
              calcValuesWithBonus,
              contactRows,
              contactDragRows,
              longPressGray,
              contactHeaders,
              contactNameToast,
              cellEditDiag,
              ratingWidth,
              thAlign,
              sortableCount,
              addNameWidth,
              remarkWidth,
              addRemarkWidth,
              addRatingColor,
              emptyOptionColor,
              uiDiag,
              salaryHeaderText,
              contactsMenuItems,
              contactAddWageLabel,
              contactYearMin,
              contactYearMax,
              contactDateInvalidCleared,
              contactDateInvalidTriggers,
              contactDateToastText,
              contactDateToastOk,
              contactBonusHeader,
              contactHasTenure,
              contactHasAvgWage,
              contactHasN,
              contactRowN,
              contactAvgSelector,
              contactsRowMenu,
              contactsDragLockActive,
              contactsDragLockOutsideKept,
              contactsDragLockReleased,
              salaryHeaderAfter,
              nameInputWidth,
              contactDeleteConfirm,
              confirmRight,
              confirmButtons,
              pendRows,
              pendingHeaders,
              pendingThAlign,
              pendingRemarkHeader,
              pendingBonusHeader,
              pendingTotalHeader,
              pendingMonthsText,
              tipCount,
              tipTextsCount,
              pendingTipTitles,
              tipNNewline,
              pendingOptionRatingClass,
              addedContactHidden,
              linkedWageAuto,
              linkedWageInputRed,
              linkedRowNoRed,
              pendingRowsAfterAdds,
              pendingSortable,
              pendingMenuItems,
              pendingMenuClosed,
              pendingMenuOutsideClosed,
              pendingDragLockActive,
              fakeCursorPosAtSelect,
              pendingDragLockOutsideKept,
              pendingDragLockReleased,
              pendingDragReorder,
              pendingDragRows,
              pendingAddGrid,
              monthsInputCount,
              pendingMonthsAuto,
              tenureChain,
              pendingEntryYear,
              workMonthSeg,
              pendingYearsZeroShown,
              workMonthWidth,
              pendingRatingField,
              ratingSameRow,
              addAfterRating,
              pendingRemarkField,
              previewCards,
              previewN,
              previewCardWidth,
              pendingSegYearWidth,
              contactSegYearWidth,
              chainSegsWidth,
              chainYearsRowWidth,
              chainTenureInputWidth,
              chainWageInputs,
              chainTenureWidthAfter,
              alignDiag,
              pendingWageAuto,
              pendingBonusAuto,
              pendingMonths6,
              pendingWageLabel,
              wageBonusGroup,
              avgPartValue,
              pendingAvgManualRed,
              avgSourceRow,
              avgLabelText,
              pendingHeadInline,
              pendingHeadGap,
              headAlignDiag,
              labelNoWrap,
              avgOptions,
              avgUrbanRed,
              avgAllUnitOptionColor,
              avgOnPostValue,
              avgNonPrivateValue,
              avgManualRed,
              pendingNameAlign,
              pendingDataAlignLeft,
              pendingNameCellWidth,
              pendingNameWrap,
              pendingRemarkWrap,
              pendingHandlePad,
              contactsHandlePad,
              manualRedCount,
              pendingDeleteConfirm,
              pendingDeleteText,
              pendingDeleteNameOk,
              pendingDeleteNewText,
              contactDeleteText,
              contactDeleteNewText,
              pendingRowsAfterContactDelete,
              recycleBtnExists,
              recycleNameFound,
              recycleHeaders,
              recycleOpButtons,
              contactRowsAfterRestore,
              pendingRowsAfterRestore,
              linkedWageAuto,
              linkedWageInputRed,
              linkedRowNoRed,
              linkedRowWageAfter,
              manualWageInputRed,
              manualRowWageRed,
              manualRowBonusTotal,
              wangRowText: window.__wangRow || '',
              companySelect,
              companyMenuItems,
              companyModal,
              companyTitle,
              companySearch,
              companySortBtn,
              dragHandles,
              dragRows,
              companyDragLockActive,
              companyDragLockOutsideKept,
              companyDragLockReleased,
              companyNameToast,
              companyDragReorder,
              companyDragProbe,
              row0DraggingAtMove,
              fakeCursorTransform,
              companyOrderBefore,
              companyOrderAfter,
              selectedRow,
              rowMenuItems,
              ctxMenuItems,
              dragHandlesAlpha,
              switchConfirm,
              companyOptions,
              currentCompany,
              settingsModal,
            });
            } catch (e) {
              return JSON.stringify({
                error: String((e && e.stack) || e),
                step: window.__step,
              });
            }
          })()
        `);
        console.log('SEVERANCE_CHECK:', check);
      }
      if (process.env.SMOKE_OPEN) {
        await win.webContents.executeJavaScript(
          `document.querySelector('.select-box-display').click()`,
        );
        await new Promise((resolve) => setTimeout(resolve, 300));
      }
      if (process.env.SMOKE_SAVE) {
        // 修改最低工资为 2600，修改第一条依据名称/链接，然后点击保存
        await win.webContents.executeJavaScript(`
          const wageInput = document.querySelector('input[type=number]');
          wageInput.value = '2600';
          wageInput.dispatchEvent(new Event('input'));
          const nameInput = document.querySelector('.basis-name-input');
          nameInput.value = '测试依据';
          nameInput.dispatchEvent(new Event('input'));
          const urlInput = document.querySelector('.basis-url-input');
          urlInput.value = 'https://example.com';
          urlInput.dispatchEvent(new Event('input'));
          document.querySelector('.actions .primary').click();
        `);
        await new Promise((resolve) => setTimeout(resolve, 500));
        const saved = loadParams();
        console.log(
          'SAVED_PARAMS:',
          JSON.stringify({
            minimumWage: saved && saved.minimumWage,
            averageWage: saved && saved.averageWage,
            firstBasis: saved && saved.sourceBySection && saved.sourceBySection.minimumWage[0],
            sourcesCount: saved && saved.sources && saved.sources.length,
          }),
        );
      }
      if (process.env.SMOKE_DUMP) {
        const info = await win.webContents.executeJavaScript(
          `JSON.stringify({
            api: typeof window.api,
            loaded: document.querySelector('main') !== null,
            buttons: document.querySelectorAll('nav button').length,
            activeTab: (document.querySelector('nav button.active') || {}).innerText || ''
          })`,
        );
        console.log('---INFO---');
        console.log(info);
        const text = await win.webContents.executeJavaScript('document.body.innerText');
        console.log('---DOM---');
        console.log(text);
        const tip = await win.webContents.executeJavaScript(
          `(document.querySelector('.band-help-tip') || {}).textContent || ''`,
        );
        console.log('---TIP---');
        console.log(tip);
        const dates = await win.webContents.executeJavaScript(
          `JSON.stringify([...document.querySelectorAll('input[type=date]')].slice(0, 16).map((el) => el.value))`,
        );
        console.log('---DATES---');
        console.log(dates);
        console.log('---END---');
      }
      if (process.env.SMOKE_SHOT) {
        if (process.env.SMOKE_SHOT_TAB) {
          await win.webContents.executeJavaScript(`
            (async () => {
              const tab = ${JSON.stringify(process.env.SMOKE_SHOT_TAB)};
              const mainTab = [...document.querySelectorAll('nav button')].find((b) =>
                b.innerText.includes('赔偿'),
              );
              if (mainTab) mainTab.click();
              await new Promise((r) => setTimeout(r, 150));
              const sub = [...document.querySelectorAll('.sub-tabs button')].find((b) =>
                b.innerText.includes(tab),
              );
              if (sub) sub.click();
              await new Promise((r) => setTimeout(r, 300));
            })()
          `);
        }
        await new Promise((resolve) => setTimeout(resolve, 800));
        const image = await win.webContents.capturePage();
        fs.writeFileSync(path.join(__dirname, 'smoke.png'), image.toPNG());
      }
      if (process.env.SMOKE_ALIGN) {
        const align = await win.webContents.executeJavaScript(`
          (async () => {
            // 冒烟流程末尾切换到了新公司（空数据），先切回默认公司
            const companyBtn = document.querySelector('.company-current');
            if (companyBtn) {
              companyBtn.click();
              await new Promise((r) => setTimeout(r, 100));
              const defaultItem = [...document.querySelectorAll('.company-menu-item')].find(
                (b) => b.innerText.includes('默认公司'),
              );
              if (defaultItem) defaultItem.click();
              await new Promise((r) => setTimeout(r, 250));
            }
            const tabTo = async (label) => {
              const mainTab = [...document.querySelectorAll('nav button')].find((b) =>
                b.innerText.includes('赔偿'),
              );
              if (mainTab) mainTab.click();
              await new Promise((r) => setTimeout(r, 120));
              const sub = [...document.querySelectorAll('.sub-tabs button')].find((b) =>
                b.innerText.includes(label),
              );
              if (sub) sub.click();
              await new Promise((r) => setTimeout(r, 250));
            };
            const measure = (panelSel) => {
              const table = document.querySelector(panelSel + ' table');
              if (!table) return null;
              const headers = [...table.querySelectorAll('thead tr:last-child th')];
              const row = [...table.querySelectorAll('tbody tr[data-id]')][0];
              if (!row) return { headers: headers.map((h) => h.innerText.trim()) };
              const cells = [...row.querySelectorAll('td')];
              const cols = [];
              for (let i = 0; i < headers.length; i++) {
                const th = headers[i].getBoundingClientRect();
                const td = cells[i] ? cells[i].getBoundingClientRect() : null;
                cols.push({
                  i: i + 1,
                  header: headers[i].innerText.replace(/\\s+/g, ' ').trim(),
                  thAlign: getComputedStyle(headers[i]).textAlign,
                  tdAlign: cells[i] ? getComputedStyle(cells[i]).textAlign : null,
                  tdCursor: cells[i] ? getComputedStyle(cells[i]).cursor : null,
                  thW: Math.round(th.width),
                  tdW: td ? Math.round(td.width) : null,
                  dLeft: td ? Math.round(th.left - td.left) : null,
                  dRight: td ? Math.round(th.right - td.right) : null,
                  thH: Math.round(th.height),
                  tdH: td ? Math.round(td.height) : null,
                });
              }
              return {
                tableLayout: getComputedStyle(table).tableLayout,
                cols,
              };
            };
            await tabTo('通讯录');
            const contacts = measure('.contacts-panel');
            const headAlign = (() => {
              const head = document.querySelector('.contacts-list-head');
              const h2 = head ? head.querySelector('h2') : null;
              const btn = head ? head.querySelector('.recycle-btn') : null;
              if (!head || !h2 || !btn) return null;
              const h2r = h2.getBoundingClientRect();
              const br = btn.getBoundingClientRect();
              return {
                sameRow:
                  Math.abs(h2r.top + h2r.height / 2 - (br.top + br.height / 2)) < 8,
                h2Top: Math.round(h2r.top),
                btnTop: Math.round(br.top),
                h2Left: Math.round(h2r.left),
                btnLeft: Math.round(br.left),
              };
            })();
            await tabTo('待辞退');
            const pending = measure('.pending-panel');
            const pendingWageTip = document.querySelectorAll(
              '.pending-panel .wage-bonus-labels .tip',
            ).length;
            const pendingWageTipText = (() => {
              const t = document.querySelector('.pending-panel .wage-bonus-labels .tip-tip');
              return t ? t.innerText : '';
            })();
            await tabTo('通讯录');
            const contactsWageTip = document.querySelectorAll(
              '.contacts-panel .wage-bonus-labels .tip',
            ).length;
            const contactsWageTipText = (() => {
              const t = document.querySelector('.contacts-panel .wage-bonus-labels .tip-tip');
              return t ? t.innerText : '';
            })();
            return JSON.stringify({
              contacts,
              pending,
              headAlign,
              pendingWageTip,
              pendingWageTipText,
              contactsWageTip,
              contactsWageTipText,
            });
          })()
        `);
        console.log('ALIGN_CHECK:', align);
      }
      if (process.env.SMOKE_NARROW) {
        win.setSize(1200, 900);
        await new Promise((resolve) => setTimeout(resolve, 500));
        const narrow = await win.webContents.executeJavaScript(`
          (async () => {
            const tabTo = async (label) => {
              const mainTab = [...document.querySelectorAll('nav button')].find((b) =>
                b.innerText.includes('赔偿'),
              );
              if (mainTab) mainTab.click();
              await new Promise((r) => setTimeout(r, 120));
              const sub = [...document.querySelectorAll('.sub-tabs button')].find((b) =>
                b.innerText.includes(label),
              );
              if (sub) sub.click();
              await new Promise((r) => setTimeout(r, 250));
            };
            const measure = (panelSel) => {
              const table = document.querySelector(panelSel + ' table');
              if (!table) return null;
              const card = table.closest('.card');
              const headers = [...table.querySelectorAll('thead tr:last-child th')];
              const wrapped = headers
                .map((h) => ({ i: h.cellIndex + 1, h: h.offsetHeight }))
                .filter((x) => x.h > 40);
              const remarkTh = table.querySelector('thead tr:last-child th:nth-child(12)');
              const remarkW = remarkTh ? Math.round(remarkTh.getBoundingClientRect().width) : 0;
              return {
                headers: headers.map((h) => ({
                  i: h.cellIndex + 1,
                  h: h.offsetHeight,
                  t: h.innerText.replace(/\\s+/g, ' ').trim(),
                })),
                wrappedCount: wrapped.length,
                remarkWidth: remarkW,
                tableScrollW: table.scrollWidth,
                cardClientW: card ? Math.round(card.clientWidth) : 0,
                overflow: card ? table.scrollWidth > card.clientWidth : null,
              };
            };
            await tabTo('通讯录');
            const contacts = measure('.contacts-panel');
            await tabTo('待辞退');
            const pending = measure('.pending-panel');
            return JSON.stringify({ contacts, pending });
          })()
        `);
        console.log('NARROW_CHECK:', narrow);
        win.setSize(1600, 920);
        await new Promise((resolve) => setTimeout(resolve, 300));
      }
      console.log('SMOKE_OK');
      app.quit();
    });
    win.webContents.on('did-fail-load', (_event, code, desc) => {
      console.error('SMOKE_FAIL', code, desc);
      app.exit(1);
    });
    if (process.env.SMOKE_DEBUG) {
      win.webContents.on('console-message', (event) => {
        console.log('RENDERER:', event.level, event.message, 'line:', event.lineNumber);
      });
    }
  } else {
    // 渲染成功后写入标记，供外部确认内容已加载
    win.webContents.on('did-finish-load', () => {
      setTimeout(() => {
        try {
          fs.writeFileSync(
            path.join(app.getPath('userData'), 'render-ok.json'),
            JSON.stringify({ at: Date.now(), version: app.getVersion() }),
          );
        } catch {
          // 忽略
        }
      }, 2000);
    });
  }
}

// ---- 参数读写（渲染进程通过 preload 调用） ----
ipcMain.handle('params:load', (_event, regionKey) => loadParams(regionKey));

ipcMain.handle('params:save', (_event, regionKey, params) => {
  if (!params || typeof params !== 'object') return false;
  try {
    fs.writeFileSync(dataFile(regionKey), JSON.stringify(params, null, 2), 'utf8');
    return true;
  } catch {
    return false;
  }
});

ipcMain.handle('params:reset', (_event, regionKey) => {
  try {
    if (fs.existsSync(dataFile(regionKey))) fs.unlinkSync(dataFile(regionKey));
  } catch {
    // 忽略删除失败，无参数文件时走默认参数
  }
  return null;
});

// ---- 打开外部政策链接（用系统默认浏览器） ----
ipcMain.handle('open:external', (_event, url) => {
  if (typeof url === 'string' && /^https?:\/\//i.test(url)) {
    shell.openExternal(url);
  }
});

// 远程拉取政策参数 JSON（在主进程请求，避免浏览器跨域限制）
ipcMain.handle('params:fetch-remote', async (_event, url) => {
  if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) {
    throw new Error('网址必须以 http:// 或 https:// 开头');
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
});

// 选择本地 JSON 参数文件导入
ipcMain.handle('file:pick-json', async () => {
  const res = await dialog.showOpenDialog({
    title: '选择政策参数 JSON 文件',
    filters: [{ name: 'JSON', extensions: ['json'] }],
    properties: ['openFile'],
  });
  if (res.canceled || res.filePaths.length === 0) return null;
  return fs.readFileSync(res.filePaths[0], 'utf8');
});

// 导出配置：保存 JSON 到用户选择的路径
ipcMain.handle('file:save-json', async (_event, content, defaultName) => {
  if (typeof content !== 'string' || typeof defaultName !== 'string') return false;
  const res = await dialog.showSaveDialog({
    title: '导出配置',
    defaultPath: defaultName,
    filters: [{ name: 'JSON', extensions: ['json'] }],
  });
  if (res.canceled || !res.filePath) return false;
  fs.writeFileSync(res.filePath, content, 'utf8');
  return true;
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
