// WebSocket message protocol between mobile client and server

import type { RunState } from '../core/run-state';

// ── Client → Server ──

export interface ClientPrompt {
  type: 'prompt';
  text: string;
  workspace: string;
  sessionId: string;       // Claude session UUID, or 'new'
  forkFrom?: string;       // sessionId to fork from
  attachmentIds?: string[];
  mode?: string;           // 'bypass' | 'plan' | 'default' | 'acceptEdits'
  model?: string;          // model name to pass to claude --model
}

export interface ClientCommand {
  type: 'command';
  text: string;
  workspace: string;
  sessionId: string;
}

export interface ClientStop {
  type: 'stop';
  workspace: string;
  sessionId: string;
}

export interface ClientPing {
  type: 'ping';
}

export type ClientMessage = ClientPrompt | ClientCommand | ClientStop | ClientPing;

// ── Server → Client ──

export interface ServerStream {
  type: 'stream';
  workspace: string;
  sessionId: string;
  state: RunState;
}

export interface ServerCommandResult {
  type: 'command_result';
  workspace: string;
  command: string;
  result: {
    ok: boolean;
    message: string;
    data?: unknown;
  };
}

export interface ServerError {
  type: 'error';
  workspace: string;
  sessionId: string;
  message: string;
}

export interface ServerAck {
  type: 'ack';
}

export interface ServerPong {
  type: 'pong';
}

export interface ServerTreeUpdated {
  type: 'tree_updated';
  newSessionId?: string;   // set when a 'new' session was created
  workspace: string;
}

export type ServerMessage = ServerStream | ServerCommandResult | ServerError | ServerAck | ServerPong | ServerTreeUpdated;
