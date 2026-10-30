import { contextItemSchema, MAX_CONTEXT, type ContextItem } from './chat-contract';

const LEGACY_KEY = 'desk-panel:chat-draft';
const keyOf = (id: string | null) => `desk-panel:chat-draft:${id ?? 'new'}`;
export interface ChatDraft { text: string; context: ContextItem[] }
const empty = (): ChatDraft => ({ text: '', context: [] });
const drafts = new Map<string, ChatDraft>();

/** Every conversation, including the not-yet-sent new chat, owns its text and picked context. */
export function getChatDraft(id: string | null = null): ChatDraft {
  const key = keyOf(id);
  try {
    // Migrate the old global draft to the new-chat composer once.
    if (id === null && !localStorage.getItem(key)) {
      const legacy = localStorage.getItem(LEGACY_KEY);
      if (legacy) { localStorage.setItem(key, legacy); localStorage.removeItem(LEGACY_KEY); }
    }
    const raw = localStorage.getItem(key);
    if (!raw) return empty();
    const value = JSON.parse(raw);
    const context = contextItemSchema.array().max(MAX_CONTEXT).safeParse(value.context);
    return typeof value.text === 'string' && context.success ? { text: value.text, context: context.data } : empty();
  } catch { return drafts.get(key) ?? empty(); }
}

function save(id: string | null, draft: ChatDraft) {
  const key = keyOf(id);
  drafts.set(key, draft);
  try {
    if (draft.text || draft.context.length) localStorage.setItem(key, JSON.stringify(draft));
    else localStorage.removeItem(key);
  } catch { /* The in-memory draft still works when browser storage is unavailable. */ }
}
export function setChatDraftText(text: string, id: string | null = null) { save(id, { ...getChatDraft(id), text }); }
export function setChatDraftContext(context: ContextItem[], id: string | null = null) { save(id, { ...getChatDraft(id), context }); }
export function clearChatDraft(id: string | null = null) { save(id, empty()); }
