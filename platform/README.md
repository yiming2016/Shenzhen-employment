# 财会公司平台（管理后台 + API）

## 目录结构

```
platform/
  server/server.js        后端 API（零依赖，Node 内置模块）
  admin/index.html        管理后台网页（登录后管理渠道/广告/统计）
  README.md               本文档
```

## 本地运行

```bash
cd C:\software\社保计算器\电脑版
npm run platform:start
```

默认地址：

- 管理后台：http://localhost:8080/admin（默认账号 admin / change-me-please，上线前必须改）
- 公开接口：http://localhost:8080/api/public/channels

数据保存在 `platform/server/data/`（db.json、keys.json），首次运行自动生成 Ed25519 签名密钥。

## 阿里云部署步骤

1. **购买轻量服务器**：阿里云轻量应用服务器，2 核 2G 起，系统选 Ubuntu 22.04
2. **域名 + ICP 备案**：备案通过前可用服务器 IP 测试
3. **安装 Node.js 20+**：
   ```bash
   curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
   sudo apt-get install -y nodejs
   ```
4. **上传代码**：把 `platform/server` 和 `platform/admin` 传到服务器，例如 `/opt/shebao-platform`
5. **配置环境变量**（创建 `/etc/shebao-platform.env`）：
   ```bash
   PORT=8080
   ADMIN_USER=你的管理员
   ADMIN_PASS=强密码
   PLATFORM_DATA_DIR=/opt/shebao-platform/data
   ```
6. **用 systemd 托管**（创建 `/etc/systemd/system/shebao-platform.service`）：
   ```ini
   [Unit]
   Description=Shebao Platform
   After=network.target

   [Service]
   EnvironmentFile=/etc/shebao-platform.env
   WorkingDirectory=/opt/shebao-platform/server
   ExecStart=/usr/bin/node server.js
   Restart=always
   User=www-data

   [Install]
   WantedBy=multi-user.target
   ```
   然后：
   ```bash
   sudo systemctl daemon-reload
   sudo systemctl enable --now shebao-platform
   ```
7. **Nginx 反向代理 + HTTPS**（安装 nginx，申请阿里云免费证书或 Let's Encrypt）：
   ```nginx
   server {
     listen 443 ssl;
     server_name admin.你的域名.com;
     ssl_certificate     /path/fullchain.pem;
     ssl_certificate_key /path/privkey.pem;

     location / {
       proxy_pass http://127.0.0.1:8080;
       proxy_set_header Host $host;
       proxy_set_header X-Real-IP $remote_addr;
     }
   }
   ```
   建议管理后台单独子域（如 `admin.你的域名.com`），并通过 nginx 限制来源 IP 或加访问密码。
8. **防火墙**：阿里云安全组只开放 80/443/22
9. **备份**：每天备份 `data/` 目录（可用阿里云 OSS 或定时 rsync）

## 客户端如何接入

用户版软件 → 政策参数 ⚙️ → 填"平台接口地址"（如 `https://api.你的域名.com`）→ 刷新渠道，下拉菜单就会显示已开通的财会公司。

财会公司渠道 = 付费开通：后台新增渠道时填写公司名称、该公司维护的 `policy-params.json` 地址、到期时间。未付费或过期公司不会出现在下拉里。

## 接口签名说明

- 公开接口（渠道/广告）返回数据带 `sig` 字段（Ed25519 签名）
- 公钥可通过 `/api/public/key` 获取，客户端可校验数据未被篡改
- 私钥只保存在服务器 `data/keys.json`，切勿泄露

## 安全提醒

- 上线前必须修改 `ADMIN_PASS`
- 管理后台接口全部需要 Bearer Token（登录后 7 天有效）
- 点击上报已做同设备限频（3 秒），正式运营建议再加 IP 限频和告警
