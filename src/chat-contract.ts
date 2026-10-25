import { z } from 'zod';

/** What the user pointed at on the dashboard: one row (mail, task, meeting, workout) or a whole tile. */
export const contextKinds = ['mail', 'event', 'task', 'workout', 'tile'] as const;
export type ContextKind = typeof contextKinds[number];
export const contextItemSchema = z.object({
  kind: z.enum(contextKinds),
  id: z.string().min(1).max(200),
  title: z.string().min(1).max(200),
  /** What the user sees (or the row's data), as plain text. Never more than the agent should read at once. */
  text: z.string().max(2000),
}).strict();
export type ContextItem = z.infer<typeof contextItemSchema>;

export const MAX_CONTEXT = 10;
export const MAX_MESSAGE = 8000;
/** A new message, with the dashboard elements it is about. */
export const chatSendSchema = z.object({
  text: z.string().trim().min(1).max(MAX_MESSAGE),
  context: z.array(contextItemSchema).max(MAX_CONTEXT).default([]),
}).strict();
export type ChatSend = z.input<typeof chatSendSchema>;
export const chatRenameSchema = z.object({ title: z.string().trim().min(1).max(120) }).strict();

/** The agent's answer is a sequence of text and tool steps, in the order they happened. */
export type ChatPart =
  | { type: 'text'; text: string }
  | { type: 'tool'; id: string; name: string; input: string; output?: string; state: 'running' | 'done' };

export type MessageStatus = 'streaming' | 'done' | 'error' | 'stopped';
/**
 * What one answer cost, as the agent reports it for the whole turn: `input` is the tokens read fresh (all model calls
 * together), `cached` the tokens read from its prompt cache on top of that, `thinking` is part of `output`.
 * `calls` is how many times the model was called and `tools` how many commands it ran.
 */
export interface ChatUsage { input: number; output: number; thinking: number; cached: number; calls: number; tools: number }
export interface ChatMessage {
  id: string;
  role: 'user' | 'agent';
  at: number;
  /** User messages: what was typed. */
  text?: string;
  context?: ContextItem[];
  /** Agent messages: the steps. */
  parts?: ChatPart[];
  usage?: ChatUsage;
  status?: MessageStatus;
  error?: string;
}

export interface ChatSummary {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: number;
  running: boolean;
}
export interface ChatDetail extends ChatSummary { items: ChatMessage[] }

/** Server-sent events of one open chat: the whole chat once, then each message that changes. */
export type ChatEvent =
  | { type: 'state'; chat: ChatDetail }
  | { type: 'update'; chat: ChatSummary; message: ChatMessage };

/** Never the same text twice for the agent: the dashboard elements go first, the question after. */
export function withContext(text: string, context: ContextItem[]): string {
  if (!context.length) return text;
  const kinds: Record<ContextKind, string> = { mail: 'Mail', event: 'Spotkanie', task: 'Zadanie Cezara', workout: 'Trening', tile: 'Kafelek pulpitu' };
  const blocks = context.map((item, i) => `${i + 1}. ${kinds[item.kind]}: ${item.title}\n${item.text.split('\n').map(line => `   ${line}`).join('\n')}`);
  return `[Kontekst: elementy pulpitu wskazane przez użytkownika]\n${blocks.join('\n')}\n\n[Wiadomość]\n${text}`;
}

/** Short title for a new chat: the first line of the first message. */
export function titleFrom(text: string): string {
  const line = text.trim().split('\n')[0].replace(/\s+/g, ' ');
  return line.length > 60 ? `${line.slice(0, 57)}…` : line || 'Nowy czat';
}
