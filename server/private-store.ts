import { spawn } from 'node:child_process';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

/** DPAPI binds saved refresh credentials to the current Windows user. No secret in argv. */
async function crypt(value: string, decrypt: boolean): Promise<string> {
  if (process.platform !== 'win32') throw new Error('Private token persistence requires Windows');
  const action = decrypt ? 'Unprotect' : 'Protect';
  const command = `$ErrorActionPreference='Stop'; Add-Type -AssemblyName System.Security; $b=[Convert]::FromBase64String([Console]::In.ReadToEnd()); $r=[Security.Cryptography.ProtectedData]::${action}($b,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser); [Console]::Out.Write([Convert]::ToBase64String($r))`;
  return new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let output = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error('Private store timeout')); }, 8000);
    child.stdout.on('data', chunk => { output += chunk; });
    child.stderr.resume(); // Never surface payloads or raw encryption errors.
    child.on('error', () => { clearTimeout(timer); reject(new Error('Private store unavailable')); });
    child.on('close', code => { clearTimeout(timer); code === 0 ? resolve(output.trim()) : reject(new Error('Private store unavailable')); });
    child.stdin.end(value);
  });
}
export async function readPrivate(path: string): Promise<unknown> {
  const encrypted = await readFile(path, 'utf8');
  return JSON.parse(Buffer.from(await crypt(encrypted, true), 'base64').toString('utf8'));
}
export async function writePrivate(path: string, value: unknown): Promise<void> {
  const encrypted = await crypt(Buffer.from(JSON.stringify(value)).toString('base64'), false);
  await mkdir(dirname(path), { recursive: true });
  const temp = path + '.tmp';
  await writeFile(temp, encrypted, { mode: 0o600 });
  await rename(temp, path);
}
