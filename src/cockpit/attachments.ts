import { chatFileTypes, isChatImage, MAX_CHAT_FILES, MAX_CHAT_FILE_BYTES, type ChatFileType, type ChatFileUpload } from '../chat-contract';

/** What the composer holds before sending: the base64 body, its preview (images) and a local key for React and removal. */
export interface DraftFile extends ChatFileUpload { key: string; preview: string }

const BY_EXTENSION: Record<string, ChatFileType> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif',
  pdf: 'application/pdf', txt: 'text/plain', md: 'text/markdown', csv: 'text/csv', json: 'application/json',
};

/** The browser's own type when a whitelist knows it; otherwise the extension (some systems leave `file.type` empty). */
export function mimeOf(file: File): ChatFileType | null {
  if ((chatFileTypes as readonly string[]).includes(file.type)) return file.type as ChatFileType;
  return BY_EXTENSION[file.name.split('.').pop()?.toLowerCase() ?? ''] ?? null;
}

/** Why this file cannot be added, in Polish; null when it can. */
export function attachmentProblem(name: string, size: number, count: number): string | null {
  if (count >= MAX_CHAT_FILES) return `Najwyżej ${MAX_CHAT_FILES} załączniki w jednej wiadomości.`;
  if (size <= 0) return `Załącznik ${name} jest pusty.`;
  if (size > MAX_CHAT_FILE_BYTES) return `Załącznik ${name} jest większy niż 5 MB.`;
  return null;
}

/** A PDF is listed so the browser lets the user pick one; the panel says honestly that it cannot read it yet. */
export const UNSUPPORTED_PDF = 'PDF jeszcze nieobsługiwany.';
export const unsupportedType = (name: string) => `Nieobsługiwany typ pliku: ${name}. Obsługiwane: PNG, JPEG, WebP, GIF, TXT, MD, CSV, JSON.`;

export async function readDraft(file: File, type: ChatFileType): Promise<DraftFile> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error('Nie udało się odczytać pliku.'));
    reader.readAsDataURL(file);
  });
  return {
    key: crypto.randomUUID(), name: file.name || 'załącznik', type, size: file.size,
    data: dataUrl.slice(dataUrl.indexOf(',') + 1), preview: isChatImage(type) ? dataUrl : '',
  };
}

export const fileLabel = (type: string): string => ({
  'image/png': 'PNG', 'image/jpeg': 'JPEG', 'image/webp': 'WebP', 'image/gif': 'GIF', 'application/pdf': 'PDF',
  'text/plain': 'TXT', 'text/markdown': 'MD', 'text/csv': 'CSV', 'application/json': 'JSON',
}[type] ?? 'Plik');
export const fileSize = (bytes: number): string => bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1).replace('.', ',')} MB` : bytes >= 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${bytes} B`;
export const chatFileUrl = (chatId: string, fileId: string): string => `/api/chats/${chatId}/files/${fileId}`;
