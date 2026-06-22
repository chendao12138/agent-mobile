# CLI Mobile

CLI Mobile 是一个面向手机浏览器的 Claude Code CLI 远程控制面板。它会在电脑上启动一个本地 Web 服务，让已配对的手机查看 Claude Code 工作区、打开会话、发送提示词、接收流式回复、管理会话，并上传支持的附件作为上下文。

这个项目适合在同一局域网内使用；如果要暴露到公网，请先阅读本文的安全说明。

## 功能

- 移动端优先的 React 界面
- 本地 Express API 和 WebSocket 服务
- 一次性配对码和持久设备 token
- 从 `~/.claude` 读取 Claude Code 工作区和会话
- 会话历史查看、重命名、归档、恢复、置顶和分支
- 支持 PDF、Word、PowerPoint、图片、视频和文本附件
- 通过 WebSocket 流式接收 Claude Code 输出
- 服务端终端命令：查看设备、移除设备、生成新配对码、退出服务

## 要求

- Node.js 20 或更新版本
- npm
- 已安装 Claude Code CLI，并且 `claude` 命令在 `PATH` 中可用

## 安装

```bash
npm install
```

## 开发运行

启动后端服务：

```bash
npm run dev
```

另开一个终端启动前端开发服务：

```bash
npm run dev:ui
```

开发模式下，后端默认监听 `0.0.0.0:3009`，前端由 Vite 提供开发服务。

## 生产运行

先构建移动端页面：

```bash
npm run build
```

再启动服务：

```bash
npm start
```

默认端口是 `3009`。可以通过 `PORT` 修改：

```bash
PORT=3010 npm start
```

如果服务通过公网地址访问，可以设置 `CLI_MOBILE_PUBLIC_URL`，这样终端里打印的二维码会使用公网地址：

```bash
CLI_MOBILE_PUBLIC_URL="https://cli.example.com" npm start
```

## 手机配对

服务启动后，终端会打印二维码和 6 位配对码。

1. 让手机和电脑处在同一网络，或通过你配置的安全隧道访问电脑。
2. 在手机浏览器打开终端显示的地址，或扫描二维码。
3. 输入配对码完成绑定。
4. 配对成功后，设备 token 会保存在手机浏览器本地，后续可以直接连接。

配对码默认 30 分钟有效，并且只能使用一次。服务运行时可以在终端输入 `pair` 生成新的配对码。

## 服务端终端命令

服务启动后，终端会出现 `cli-mobile>` 提示符：

```text
devices, ls           列出已配对设备
revoke <id>, rm <id>  移除设备
pair, newpair         生成新的配对码
help, ?               显示帮助
exit, quit, q         停止服务
```

## 脚本

```bash
npm run dev         # 启动开发后端
npm run dev:ui      # 启动 Vite 前端开发服务
npm run build       # 构建移动端页面
npm start           # 启动生产服务
npm run typecheck   # 运行 TypeScript 类型检查
npm test            # 运行全部测试
npm run test:watch  # 监听模式运行测试
```

## 本地数据

CLI Mobile 的运行数据不会写入仓库，默认保存在用户目录：

- `~/.cli-mobile/tree.json`：缓存的工作区和会话树
- `~/.cli-mobile/devices.json`：已配对设备列表和设备 token hash
- `~/.cli-mobile/attachments`：上传的附件文件

Claude Code 的会话数据从 `~/.claude` 读取。

附件默认限制：

- 单个附件最大 20MB
- 单个会话附件总量最大 100MB
- 附件保留 7 天后清理

## 安全说明

- 建议优先在局域网内使用。
- 不要在没有 HTTPS、访问控制、防火墙或私有隧道保护的情况下直接暴露到公网。
- 手机浏览器保存的设备 token 是长期凭据；服务端 `~/.cli-mobile/devices.json` 只保存 token hash。
- 如果手机丢失或不再使用，请在服务端终端执行 `revoke <id>` 移除设备。
- WebSocket 连接会在 URL query 中携带设备 token；公网部署时请避免在反向代理中记录完整 URL。
- 上传附件会以本机文件路径传给 Claude Code，请确认附件内容适合被当前会话读取。

## 当前限制

- 服务启动逻辑会尝试清理占用端口的进程，生产环境使用前建议先确认这一行为符合你的预期。

## 许可证

MIT
