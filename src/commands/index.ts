// Slash command handler

import type { AgentAdapter } from '../agent/types';
import type { ActiveRuns } from '../core/active-runs';
import { updateSessionName } from '../core/claude-data';

export interface CommandContext {
  text: string;
  workspace: string;
  sessionId: string;
  activeRuns: ActiveRuns;
  agent: AgentAdapter;
}

interface CommandResult {
  ok: boolean;
  message: string;
  data?: unknown;
}

type Handler = (args: string, ctx: CommandContext) => Promise<CommandResult>;

const handlers: Record<string, Handler> = {
  '/new': handleNew,
  '/reset': handleNew,
  '/resume': handleResume,
  '/rename': handleRename,
  '/stop': handleStop,
  '/status': handleStatus,
  '/mode': handleMode,
  '/help': handleHelp,
  // /cd, /ws commands removed — workspace/session mapping is now
  // driven by ~/.claude/ directory, not CLI commands
};

export async function tryHandleCommand(ctx: CommandContext): Promise<CommandResult | null> {
  const trimmed = ctx.text.trim();
  if (!trimmed.startsWith('/')) return null;
  const parts = trimmed.split(/\s+/);
  const cmd = parts[0] ?? '';
  const args = parts.slice(1).join(' ');
  const h = handlers[cmd];
  if (!h) return null;
  return h(args, ctx);
}

// ── /new, /reset ──

async function handleNew(args: string, ctx: CommandContext): Promise<CommandResult> {
  const name = args.trim();
  const scope = `${ctx.workspace}:${ctx.sessionId}`;
  ctx.activeRuns.interrupt(scope);
  // With the new model, "new session" means not resuming any existing one.
  // The frontend handles sending sessionId='new' for the next prompt.
  return {
    ok: true,
    message: name
      ? `✅ 将创建新会话: ${name}（下次 prompt 生效）`
      : '✅ 将创建新会话（下次 prompt 生效）',
    data: { newSession: true },
  };
}

// ── /resume ──

async function handleResume(_args: string, ctx: CommandContext): Promise<CommandResult> {
  return {
    ok: true,
    message: '📋 会话列表已从 ~/.claude/ 加载，请在左侧面板选择。',
    data: { action: 'show_tree' },
  };
}

// ── /rename ──

async function handleRename(args: string, ctx: CommandContext): Promise<CommandResult> {
  const name = args.trim();
  if (!name) {
    return { ok: false, message: '用法: `/rename <新名称>`' };
  }
  const ok = await updateSessionName(ctx.sessionId, name);
  return { ok, message: ok ? `✅ 已重命名为: ${name}` : '❌ 重命名失败' };
}

// ── /stop ──

async function handleStop(_args: string, ctx: CommandContext): Promise<CommandResult> {
  const scope = `${ctx.workspace}:${ctx.sessionId}`;
  const ok = ctx.activeRuns.interrupt(scope);
  return {
    ok: true,
    message: ok ? '⏹ 已中断当前任务' : '当前没有运行中的任务',
  };
}

// ── /status ──

async function handleStatus(_args: string, ctx: CommandContext): Promise<CommandResult> {
  const lines = [
    `**🆔 Session ID:** \`${ctx.sessionId.slice(0, 12)}…\``,
    `**📁 Workspace:** ${ctx.workspace}`,
    `**🤖 Agent:** ${ctx.agent.displayName}`,
    `**🔓 Permission:** bypassPermissions`,
  ];
  return { ok: true, message: lines.join('\n') };
}

// ── /mode ──

async function handleMode(args: string, _ctx: CommandContext): Promise<CommandResult> {
  const mode = args.trim().toLowerCase();
  if (!mode || !['plan', 'auto', 'bypass'].includes(mode)) {
    return { ok: false, message: '用法: `/mode <plan|auto|bypass>` — plan=只读规划, auto=标准确认, bypass=自动执行' };
  }
  return { ok: true, message: `✅ 权限模式已设为: **${mode}**（下次运行生效）` };
}

// ── /help ──

async function handleHelp(_args: string, _ctx: CommandContext): Promise<CommandResult> {
  return {
    ok: true,
    message: [
      '**📋 可用命令**',
      '',
      '| 命令 | 说明 |',
      '|------|------|',
      '| `/new` | 创建新会话 |',
      '| `/resume` | 查看会话列表 |',
      '| `/rename <name>` | 重命名当前会话 |',
      '| `/stop` | 中断当前任务 |',
      '| `/status` | 显示当前状态 |',
      '| `/mode <plan\|auto\|bypass>` | 切换权限模式 |',
      '| `/help` | 显示此帮助 |',
      '',
      '其他所有内容直接发给 Claude。',
      '会话管理通过左侧工作区树完成（数据来自 ~/.claude/）。',
    ].join('\n'),
  };
}
