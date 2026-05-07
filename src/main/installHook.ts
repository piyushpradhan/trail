import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  existsSync,
  readFileSync,
  writeFileSync,
  appendFileSync,
  mkdirSync,
  copyFileSync,
} from 'node:fs';
import { homedir, platform } from 'node:os';
import { join, dirname } from 'node:path';
import { app } from 'electron';
import { eventsRepo } from './db.js';

const exec = promisify(execFile);

export type InstallShell = 'powershell' | 'bash' | 'zsh';

export interface InstallResult {
  ok: boolean;
  shell: InstallShell;
  profilePath?: string;
  scriptPath?: string;
  alreadyInstalled?: boolean;
  message?: string;
}

export const MARKER_BEGIN = '# >>> trail shell hook >>>';
export const MARKER_END = '# <<< trail shell hook <<<';

function hooksDir(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'hooks')
    : join(app.getAppPath(), 'resources', 'hooks');
}

async function powershellProfilePath(): Promise<string> {
  // Prefer pwsh (PS 7+); fall back to powershell.exe (5.1)
  const candidates = ['pwsh', 'powershell'];
  for (const exe of candidates) {
    try {
      const { stdout } = await exec(exe, ['-NoProfile', '-Command', '$PROFILE'], {
        windowsHide: true,
      });
      const path = stdout.trim().split(/\r?\n/)[0]?.trim();
      if (path) return path;
    } catch {
      // try next
    }
  }
  // Fallback: best-guess Documents location for PS 5.1
  const docs = join(homedir(), 'Documents', 'WindowsPowerShell', 'Microsoft.PowerShell_profile.ps1');
  return docs;
}

function rcFile(shell: 'bash' | 'zsh'): string {
  if (shell === 'zsh') return join(homedir(), '.zshrc');
  // bash: prefer .bashrc on linux, .bash_profile on macOS, but .bashrc works for both
  return join(homedir(), '.bashrc');
}

interface ProfileBlock {
  exists: boolean;
  block: string;
}

export function buildBlock(scriptPath: string, shell: InstallShell): string {
  if (shell === 'powershell') {
    return [MARKER_BEGIN, `. "${scriptPath}"`, MARKER_END, ''].join('\n');
  }
  return [MARKER_BEGIN, `source "${scriptPath}"`, MARKER_END, ''].join('\n');
}

function checkExisting(profilePath: string): ProfileBlock {
  if (!existsSync(profilePath)) return { exists: false, block: '' };
  const text = readFileSync(profilePath, 'utf-8');
  const start = text.indexOf(MARKER_BEGIN);
  const end = text.indexOf(MARKER_END);
  if (start === -1 || end === -1) return { exists: false, block: '' };
  return { exists: true, block: text.slice(start, end + MARKER_END.length) };
}

function backup(profilePath: string): void {
  if (!existsSync(profilePath)) return;
  copyFileSync(profilePath, profilePath + '.trail.bak');
}

function appendBlock(profilePath: string, block: string): void {
  mkdirSync(dirname(profilePath), { recursive: true });
  if (!existsSync(profilePath)) {
    writeFileSync(profilePath, block);
    return;
  }
  // Add a leading newline so we don't glue onto the last line of an existing profile
  const existing = readFileSync(profilePath, 'utf-8');
  const sep = existing.endsWith('\n') ? '' : '\n';
  appendFileSync(profilePath, sep + '\n' + block);
}

function shellScriptName(shell: InstallShell): string {
  return shell === 'powershell' ? 'trail-hook.ps1' : 'trail-hook.sh';
}

/**
 * Pure: append the hook block to a profile file at the given path, idempotently.
 * Exposed for unit testing — production callers should use installShellHook().
 */
export function installToProfile(
  profilePath: string,
  scriptPath: string,
  shell: InstallShell,
): InstallResult {
  const existing = checkExisting(profilePath);
  if (existing.exists) {
    return {
      ok: true,
      shell,
      profilePath,
      scriptPath,
      alreadyInstalled: true,
      message: 'Already installed',
    };
  }
  try {
    backup(profilePath);
    appendBlock(profilePath, buildBlock(scriptPath, shell));
    return {
      ok: true,
      shell,
      profilePath,
      scriptPath,
      alreadyInstalled: false,
      message: 'Installed',
    };
  } catch (err) {
    return {
      ok: false,
      shell,
      profilePath,
      scriptPath,
      message: (err as Error).message,
    };
  }
}

/**
 * Pure: remove the hook block from a profile file at the given path.
 */
export function removeFromProfile(profilePath: string, shell: InstallShell): InstallResult {
  if (!existsSync(profilePath)) {
    return { ok: true, shell, profilePath, message: 'Profile does not exist' };
  }
  const text = readFileSync(profilePath, 'utf-8');
  const start = text.indexOf(MARKER_BEGIN);
  const end = text.indexOf(MARKER_END);
  if (start === -1 || end === -1) {
    return { ok: true, shell, profilePath, alreadyInstalled: false, message: 'Not installed' };
  }
  const after = end + MARKER_END.length;
  const trailingNewline = text[after] === '\n' ? 1 : 0;
  const next = text.slice(0, start).replace(/\n+$/, '\n') + text.slice(after + trailingNewline);
  backup(profilePath);
  writeFileSync(profilePath, next);
  return { ok: true, shell, profilePath, message: 'Removed' };
}

export async function installShellHook(shell: InstallShell): Promise<InstallResult> {
  const scriptPath = join(hooksDir(), shellScriptName(shell));
  if (!existsSync(scriptPath)) {
    return {
      ok: false,
      shell,
      message: `Hook script not found at ${scriptPath}`,
    };
  }

  const profilePath =
    shell === 'powershell' ? await powershellProfilePath() : rcFile(shell);

  const result = installToProfile(profilePath, scriptPath, shell);
  if (result.ok && result.alreadyInstalled) {
    eventsRepo.log('hook.install.noop', { shell, profilePath });
  } else if (result.ok) {
    eventsRepo.log('hook.install.added', { shell, profilePath, scriptPath });
  } else {
    eventsRepo.log('hook.install.error', { shell, profilePath, message: result.message });
  }
  return result;
}

export function uninstallShellHook(shell: InstallShell, profilePath: string): InstallResult {
  const r = removeFromProfile(profilePath, shell);
  if (r.ok && r.message === 'Removed') {
    eventsRepo.log('hook.uninstall', { shell, profilePath });
  }
  return r;
}

export function suggestedShell(): InstallShell {
  if (platform() === 'win32') return 'powershell';
  // Check $SHELL env
  const sh = process.env['SHELL'] ?? '';
  if (sh.endsWith('/zsh')) return 'zsh';
  return 'bash';
}
