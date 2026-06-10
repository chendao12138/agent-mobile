# CLI Mobile 远程部署指南

三种访问模式可同时启用，互不冲突。

## 前置条件

```bash
cd cli-mobile
npm install
npm run build    # 构建前端
npm start        # 生产模式启动，监听 0.0.0.0:3009
```

启动后终端会显示 6 位配对码和二维码，首次连接的手机需要输入配对码。

---

## 模式一：局域网 (LAN)

**无需任何额外配置**，开箱即用。

```
手机连接同一 Wi-Fi
→ 浏览器访问 http://<Mac的局域网IP>:3009
→ 输入终端显示的 6 位配对码
→ 配对成功，开始使用
```

---

## 模式二：frp 内网穿透

### 架构

```
手机 ──HTTPS──► VPS (frps + Nginx) ──frp隧道──► Mac (frpc) ──► localhost:3009
```

### 步骤

#### 1. VPS 端部署 frps

```bash
# 下载 frp: https://github.com/fatedier/frp/releases
wget https://github.com/fatedier/frp/releases/download/v0.61.0/frp_0.61.0_linux_amd64.tar.gz
tar xzf frp_*.tar.gz
cd frp_*

# 编辑 frps.toml，使用 config/frp/frps.toml.example 作为模板
# 注意修改 auth.token 为你自己的随机字符串

# 启动
./frps -c frps.toml
```

#### 2. Mac 端部署 frpc

```bash
# 同样下载 frp
# 编辑 frpc.toml，使用 config/frp/frpc.toml.example 作为模板
# 修改 serverAddr 和 auth.token

./frpc -c frpc.toml
```

#### 3. VPS 端配置 Nginx

```bash
# 复制 config/nginx/cli-mobile.conf.example 到
# /etc/nginx/sites-available/cli-mobile
# 修改域名和证书路径

# 获取 Let's Encrypt 证书
certbot certonly --nginx -d claude.your-domain.com

# 启用站点
ln -s /etc/nginx/sites-available/cli-mobile /etc/nginx/sites-enabled/
nginx -t && nginx -s reload
```

#### 4. 设置公网 URL 环境变量

```bash
# 启动 cli-mobile 时设置公网 URL，方便二维码显示
CLI_MOBILE_PUBLIC_URL="https://cli.your-domain.com" npm start
```

#### 5. 手机访问

```
浏览器打开 https://cli.your-domain.com
→ 输入配对码
→ 开始使用
```

---

## 模式三：星空组网（P2P 虚拟局域网）

### 架构

```
Mac 装客户端 ──P2P加密隧道── 手机装客户端
              (虚拟IP互通，无需VPS)
```

### 步骤

1. 在 Mac 和手机上分别安装星空组网客户端
2. 创建同一个网络，获得虚拟 IP（如 `100.64.0.x`）
3. 确保 cli-mobile 监听 `0.0.0.0:3009`（默认行为）

### 手机访问

```
浏览器打开 http://100.64.0.x:3009（替换为 Mac 的虚拟 IP）
→ 输入配对码
→ 开始使用
```

> 星空组网在国内跨运营商打洞成功率高于 ZeroTier/Tailscale，且有国内中转兜底。

---

## 管理已配对设备

```bash
# 查看已配对设备
curl -H "Authorization: Bearer <任意有效device_token>" http://localhost:3009/api/devices

# 撤销某个设备
curl -X DELETE -H "Authorization: Bearer <device_token>" http://localhost:3009/api/devices/<device_id>

# 或者直接编辑文件
cat ~/.cli-mobile/devices.json
```

---

## 安全建议

1. **定期更换配对码**：重启服务即可生成新的 30 分钟配对码
2. **撤销不用的设备**：删除 `~/.cli-mobile/devices.json` 中的条目
3. **frp 使用强 token**：`auth.token` 至少 32 位随机字符串
4. **启用 HTTPS**：frp 模式务必配置 Let's Encrypt 证书
5. **VPS 加固**：禁用 SSH 密码登录，配置 fail2ban
