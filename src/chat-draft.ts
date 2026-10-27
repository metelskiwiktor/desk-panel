import type { ContextItem } from './chat-contract';

const DRAFT_KEY = 'desk-panel:chat-draft';

export interface ChatDraft {
  text: string;
  context: ContextItem[];
}

let inMemoryDraft: ChatDraft = {
  text: '',
  context: [],
};

export function getChatDraft(): ChatDraft {
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      const raw = window.localStorage.getItem(DRAFT_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed.text === 'string' && Array.isArray(parsed.context)) {
          return {
            text: parsed.text,
            context: parsed.context,
          };
        }
      }
    } catch {}
    return { text: '', context: [] };
  }
  return inMemoryDraft;
}

export function setChatDraftText(text: string): void {
  inMemoryDraft.text = text;
  persistDraft();
}

export function setChatDraftContext(context: ContextItem[]): void {
  inMemoryDraft.context = context;
  persistDraft();
}

export function clearChatDraft(): void {
  inMemoryDraft = { text: '', context: [] };
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      window.localStorage.removeItem(DRAFT_KEY);
    } catch {}
  }
}

function persistDraft(): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    if (!inMemoryDraft.text && inMemoryDraft.context.length === 0) {
      window.localStorage.removeItem(DRAFT_KEY);
    } else {
      window.localStorage.setItem(DRAFT_KEY, JSON.stringify(inMemoryDraft));
    }
  } catch {}
}
