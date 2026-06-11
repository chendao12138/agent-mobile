# CLI Mobile 远程部署指南

三种访问模式可同时启用，互不冲突。

## 前置条件

```bash
cd cli-mobile
npm install
npm run build    # 构建前端
npm start        # 生产模式启动；首次启动会询问是否配置 STCP 远程访问
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

## 模式二：frp STCP 内网穿透

### 架构

```
iOS Burrow/visitor ──STCP──► VPS (frps) ──frp隧道──► Mac (frpc) ──► cli-mobile
```

### 步骤

#### 1. VPS 端部署 frps

```bash
# 在 https://github.com/fatedier/frp/releases 下载适合 VPS 的 linux 包
# 例如 frp_<version>_linux_amd64.tar.gz
tar xzf frp_*.tar.gz
cd frp_*

# 编辑 frps.toml，使用 config/frp/frps.toml.example 作为模板
# 注意修改 auth.token 为你自己的随机字符串

# 启动
./frps -c frps.toml
```

#### 2. Mac 端首次启动向导

```bash
npm start
```

首次启动如果选择启用 STCP，程序会询问：

```
frps 公网 IP 或域名
frps serverPort/bindPort
frps auth token
frpc 程序路径（留空则自动下载安装到 ~/.cli-mobile/bin/frpc）
```

程序会自动生成：

```
~/.cli-mobile/remote/remote.json
~/.cli-mobile/remote/cli-remote-frpc.toml
```

并把两个文件权限设为 `0600`。如果未提供 `frpc` 路径，程序会从 GitHub latest release 下载适合当前平台的 `frpc` 到：

```
~/.cli-mobile/bin/frpc
```

配置完成后终端会展示一次 Burrow/visitor 端需要复制的信息：

```
serverAddr
serverPort
proxyName = cli-mobile-stcp
secretKey
```

#### 3. 重新配置

```
cli-mobile> remote reset
```

`remote reset` 会继续使用当前 cli-mobile 服务端口，并重新生成 frpc 配置和 `secretKey`。

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
