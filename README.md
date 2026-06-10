# CLI Mobile

Mobile remote control for Claude Code CLI.

CLI Mobile runs a local web server on your computer and lets a paired phone browse Claude Code workspaces, inspect sessions, send prompts, stream responses, manage sessions, and upload supported attachments from a mobile browser.

## Features

- Mobile-first React interface for Claude Code sessions
- Local Express and WebSocket server
- One-time pairing code with persistent device tokens
- Workspace and session discovery from `~/.claude`
- Session history, rename, archive, restore, pin, and branch actions
- Attachment upload support for PDF, Word, PowerPoint, images, video, and text files
- LAN access by default, with optional frp or P2P virtual LAN deployment
- Terminal commands for listing devices, revoking devices, and generating new pairing codes

## Requirements

- Node.js 20 or newer
- npm
- Claude Code CLI available on `PATH` as `claude`

## Install

```bash
npm install
```

## Development

Start the backend server:

```bash
npm run dev
```

Start the Vite frontend dev server:

```bash
npm run dev:ui
```

## Production

Build the mobile UI and start the server:

```bash
npm run build
npm start
```

By default the server listens on `0.0.0.0:3009`. Set `PORT` to use a different port:

```bash
PORT=3010 npm start
```

If the app is exposed through a public URL, set `CLI_MOBILE_PUBLIC_URL` so the terminal QR code points at the public address:

```bash
CLI_MOBILE_PUBLIC_URL="https://cli.example.com" npm start
```

## Pair A Phone

When the server starts, the terminal prints a QR code and a 6-character pairing code.

1. Connect the phone to the same network as the computer.
2. Open `http://<computer-lan-ip>:3009` in the phone browser, or scan the QR code.
3. Enter the pairing code if prompted.
4. After pairing, the phone stores a device token locally and can reconnect without a new code.

Pairing codes are short-lived and single-use. Restart the service or run `pair` in the terminal prompt to generate a new one.

## Terminal Commands

While the server is running, the `cli-mobile>` prompt accepts:

```text
devices, ls           List paired devices
revoke <id>, rm <id>  Revoke a paired device
pair, newpair         Generate a new pairing code
help, ?               Show help
exit, quit, q         Stop the server
```

## Remote Access

CLI Mobile can be used over:

- LAN: open `http://<computer-lan-ip>:3009`
- frp: expose the local server through a VPS and HTTPS reverse proxy
- P2P virtual LAN: connect the computer and phone to the same private overlay network

See [config/REMOTE.md](config/REMOTE.md) for deployment examples and security notes.

## Scripts

```bash
npm run dev        # Start the server in development mode
npm run dev:ui     # Start the Vite frontend dev server
npm run build      # Build the mobile UI
npm start          # Start the production server
npm run typecheck  # Run TypeScript checks
```

## Local Data

Runtime data is stored outside the repository under `~/.cli-mobile`, including the cached workspace tree, paired devices, and uploaded attachments.

Claude Code session data is read from `~/.claude`.

## Security Notes

- Do not expose the server publicly without HTTPS and an additional network boundary such as frp/Nginx authentication, firewall rules, or a private tunnel.
- Revoke devices you no longer use with `revoke <id>`.
- Use strong frp tokens and keep example config files free of real secrets.
- Uploaded attachments are stored locally and cleaned up after their retention window.

## License

MIT
