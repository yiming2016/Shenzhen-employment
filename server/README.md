# 政策参数远程同步服务

软件"政策参数"按钮右侧的 ⚙️ 可以填写一个后端网址，勾选允许同步的板块（参数版本、最低工资、平均工资、养老、医保、生育、失业、工伤、公积金），点击"同步并应用"后，软件会拉取该网址返回的 JSON，并只更新勾选且类型正确的字段。

## 服务端文件

- `policy-params.example.json`：完整参数模板（由 `npm run gen:params` 从核心参数表自动生成）
- `worker.js`：Cloudflare Worker 示例

## 部署方式（任选一种）

### 1. GitHub（最简单）

1. 把 `policy-params.example.json` 重命名为 `policy-params.json` 并上传到 GitHub 仓库
2. 在软件里填写 raw 链接：
   `https://raw.githubusercontent.com/你的用户名/你的仓库/main/policy-params.json`
3. 也可以使用 GitHub Gist：把 JSON 粘贴到 Gist，复制 "Raw" 链接

### 2. Cloudflare Pages（静态托管）

1. 新建一个文件夹，里面只放 `policy-params.json`
2. 在 Cloudflare Pages 里创建项目，把该文件夹拖入上传
3. 得到类似 `https://你的项目.pages.dev/policy-params.json` 的地址，填入软件

### 3. Cloudflare Worker（可加权限校验）

1. 复制 `worker.js` 到 Cloudflare Workers
2. 把 `POLICY_PARAMS` 替换成 `policy-params.json` 的内容
3. 部署后访问 `https://你的worker域名/policy-params.json`

### 4. 其他任意方式

只要返回 JSON 即可：对象存储（OSS/COS）、NAS、内网服务器、Vercel 静态文件等都可以。注意地址必须能直接返回 JSON 文本（不需要登录跳转）。

## 安全提示

- 公开链接任何人都能拉取参数；如果你不想公开，可以用带密钥的 Worker（例如校验请求头）或放在内网。
- 软件只会更新你勾选且类型正确的字段，不会接受未知字段。

## 更新流程

1. 在电脑版目录执行 `npm run gen:params` 重新生成模板
2. 按需修改费率/基数后上传到你的部署地址
3. 软件里打开"政策参数 ⚙️"→ 勾选板块 → 同步并应用
