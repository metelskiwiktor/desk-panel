import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { MAX_CHAT_FILE_BYTES, type ChatFileRef, type ChatFileType, type ChatFileUpload } from '../src/chat-contract';
import { ChatError } from './agent-chat';

/** One directory per conversation, under `~/.desk-panel/chat-files` (outside Git); the message keeps only a reference. */
const EXTENSIONS: Record<ChatFileType, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'application/pdf': 'pdf',
  'text/plain': 'txt',
  'text/markdown': 'md',
  'text/csv': 'csv',
  'application/json': 'json',
};
const FILE_ID = /^[0-9a-f-]{36}$/;

export const chatFilesDir = (dir: string, chatId: string) => path.join(dir, 'chat-files', chatId);
export const chatFilePath = (dir: string, chatId: string, file: ChatFileRef) => path.join(chatFilesDir(dir, chatId), `${file.id}.${EXTENSIONS[file.type]}`);

/** Writes what came with a message and returns the references the conversation keeps. Only bytes named by a whitelist type. */
export async function saveChatFiles(dir: string, chatId: string, uploads: readonly ChatFileUpload[]): Promise<ChatFileRef[]> {
  if (!uploads.length) return [];
  const filesDir = chatFilesDir(dir, chatId);
  await mkdir(filesDir, { recursive: true });
  const written: string[] = [];
  const refs: ChatFileRef[] = [];
  try {
    for (const upload of uploads) {
      // Hermes rejects file parts and the panel has no PDF reader; the browser says the same before sending.
      if (upload.type === 'application/pdf') throw new ChatError(400, 'PDF jeszcze nieobsługiwany.');
      if (!(upload.type in EXTENSIONS)) throw new ChatError(400, `Nieobsługiwany typ pliku: ${upload.name}.`);
      const bytes = Buffer.from(upload.data, 'base64');
      if (!bytes.length) throw new ChatError(400, `Załącznik ${upload.name} jest pusty.`);
      if (bytes.length > MAX_CHAT_FILE_BYTES) throw new ChatError(400, `Załącznik ${upload.name} jest większy niż 5 MB.`);
      const ref: ChatFileRef = { id: randomUUID(), name: upload.name, type: upload.type, size: bytes.length };
      const target = chatFilePath(dir, chatId, ref);
      await writeFile(target, bytes);
      written.push(target);
      refs.push(ref);
    }
    return refs;
  } catch (error) {
    // Never leave half of a rejected message behind, and never touch files of earlier messages.
    await Promise.all(written.map(file => rm(file, { force: true }).catch(() => {})));
    throw error;
  }
}

export async function readChatFile(dir: string, chatId: string, file: ChatFileRef): Promise<Buffer | undefined> {
  if (!FILE_ID.test(file.id)) return undefined;
  try { return await readFile(chatFilePath(dir, chatId, file)); } catch { return undefined; }
}

export async function removeChatFiles(dir: string, chatId: string): Promise<void> {
  await rm(chatFilesDir(dir, chatId), { recursive: true, force: true }).catch(() => {});
}
