import { createContext, useContext } from 'react';

interface LayoutSnapshot { work: boolean; visit: boolean; pane: 'chat' | 'cockpit' }
export interface ConversationCache {
  cards: Map<string, unknown>;
  layouts: Map<string, LayoutSnapshot>;
  last: LayoutSnapshot;
}
export const ConversationCacheContext = createContext<ConversationCache | null>(null);
export const useConversationCache = () => useContext(ConversationCacheContext);
