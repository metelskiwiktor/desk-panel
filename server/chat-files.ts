import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { CHAT_TOTAL_LIMIT_MESSAGE, MAX_CHAT_TOTAL_BYTES, MAX_CHAT_FILE_BYTES, type ChatFileRef, type ChatFileType, type ChatFileUpload } from '../src/chat-contract';
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
  if (uploads.reduce((sum, upload) => sum + Buffer.from(upload.data, 'base64').length, 0) > MAX_CHAT_TOTAL_BYTES)
    throw new ChatError(413, CHAT_TOTAL_LIMIT_MESSAGE);
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
      const signature = bytes.subarray(0, 12);
      const detected = signature.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')) ? 'image/png'
        : signature.subarray(0, 3).equals(Buffer.from('ffd8ff', 'hex')) ? 'image/jpeg'
        : ['GIF87a', 'GIF89a'].includes(signature.subarray(0, 6).toString('latin1')) ? 'image/gif'
        : signature.subarray(0, 4).toString('latin1') === 'RIFF' && signature.subarray(8, 12).toString('latin1') === 'WEBP' ? 'image/webp' : null;
      if (upload.type.startsWith('image/')) {
        if (detected !== upload.type) throw new ChatError(400, `Format obrazu ${upload.name} nie zgadza się z deklarowanym typem.`);
      } else {
        try { new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
        catch { throw new ChatError(400, `Plik ${upload.name} musi być poprawnym UTF-8.`); }
        if (detected || /<(?:[A-Za-z_][\w.-]*:)?svg[\s/>]/i.test(bytes.toString('utf8'))) throw new ChatError(400, `Nieobsługiwany format pliku: ${upload.name}. SVG jest niedozwolony.`);
      }
      const ref: ChatFileRef = { id: randomUUID(), name: upload.name, type: upload.type, size: bytes.length };
      const target = chatFilePath(dir, chatId, ref);
      const temp = `${target}.tmp`;
      written.push(temp, target); // Register before writing: even a partial write must be removed.
      await writeFile(temp, bytes, { flag: 'wx' });
      await rename(temp, target);
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

/** Roll back only this turn; older messages keep their files. Cleanup never hides the reason of the rollback. */
export async function removeTurnFiles(dir: string, chatId: string, files: readonly ChatFileRef[]): Promise<void> {
  await Promise.all(files.map(file => rm(chatFilePath(dir, chatId, file), { force: true }).catch(() => {})));
}
