const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

// 冒烟测试使用独立的用户数据目录，避免污染真实数据
if (process.env.SMOKE_TEST === '1') {
  app.setPath('userData', path.join(os.tmpdir(), `sz-shebao-smoke-${Date.now()}`));
}

/** 用户修改后的参数保存在系统用户目录，避免污染程序目录 */
function dataFile() {
  return path.join(app.getPath('userData'), 'params.json');
}

function loadParams() {
  try {
    const raw = fs.readFileSync(dataFile(), 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function createWindow() {
  const smokeTest = process.env.SMOKE_TEST === '1';
  const win = new BrowserWindow({
    width: 1200,
    height: 840,
    minWidth: 960,
    minHeight: 640,
    autoHideMenuBar: true,
    show: !smokeTest,
    title: '深圳社保计算器',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
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
          `document.querySelectorAll('nav button')[1].click()`,
        );
        await new Promise((resolve) => setTimeout(resolve, 300));
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
        await new Promise((resolve) => setTimeout(resolve, 800));
        const image = await win.webContents.capturePage();
        fs.writeFileSync(path.join(__dirname, 'smoke.png'), image.toPNG());
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
  }
}

// ---- 参数读写（渲染进程通过 preload 调用） ----
ipcMain.handle('params:load', () => loadParams());

ipcMain.handle('params:save', (_event, params) => {
  if (!params || typeof params !== 'object') return false;
  try {
    fs.writeFileSync(dataFile(), JSON.stringify(params, null, 2), 'utf8');
    return true;
  } catch {
    return false;
  }
});

ipcMain.handle('params:reset', () => {
  try {
    if (fs.existsSync(dataFile())) fs.unlinkSync(dataFile());
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

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
