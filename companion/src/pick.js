/**
 * A native folder or file picker from the pipeline's side (#99): the window is a web page
 * on loopback, which cannot learn a real path from `<input type="file">`, so the OS's own
 * dialog is opened by the process that can — PowerShell's on Windows, AppleScript's on
 * macOS, zenity's on Linux when it is there. Resolves to the chosen path, null when the
 * user cancelled, or `{ unsupported: true }` when this machine has no dialog to offer (the
 * window then falls back to its own folder browser over `/api/browse`).
 */
import { spawn } from 'node:child_process';

/** The command for a platform, or null. Exported for the tests. */
export function pickCommand(kind, start, platform = process.platform) {
  const folder = kind === 'folder';
  if (platform === 'win32') {
    const ps = folder
      ? `Add-Type -AssemblyName System.Windows.Forms; $d = New-Object System.Windows.Forms.FolderBrowserDialog; $d.Description = 'Choose a folder'; ${start ? `$d.SelectedPath = '${psq(start)}';` : ''} if ($d.ShowDialog() -eq 'OK') { [Console]::Out.Write($d.SelectedPath) }`
      : `Add-Type -AssemblyName System.Windows.Forms; $d = New-Object System.Windows.Forms.OpenFileDialog; $d.Title = 'Choose a file'; ${start ? `$d.InitialDirectory = '${psq(start)}';` : ''} if ($d.ShowDialog() -eq 'OK') { [Console]::Out.Write($d.FileName) }`;
    return { cmd: 'powershell', args: ['-NoProfile', '-STA', '-Command', ps] };
  }
  if (platform === 'darwin') {
    const what = folder ? 'choose folder' : 'choose file';
    const from = start ? ` default location POSIX file "${start.replace(/"/g, '\\"')}"` : '';
    return { cmd: 'osascript', args: ['-e', `POSIX path of (${what}${from})`] };
  }
  const args = ['--file-selection'];
  if (folder) args.push('--directory');
  if (start) args.push(`--filename=${start.replace(/\/?$/, '/')}`);
  return { cmd: 'zenity', args };
}

function psq(s) {
  return String(s).replace(/'/g, "''");
}

export function pickPath(kind, start = '', { platform = process.platform, run = runCommand } = {}) {
  const c = pickCommand(kind, start, platform);
  return run(c.cmd, c.args).then(
    (out) => {
      const p = out.trim().replace(/\/$/, '');
      return p || null;
    },
    (e) => {
      // No such program (zenity missing), or the dialog could not open: let the page fall back.
      if (e.code === 'ENOENT' || e.unsupported) return { unsupported: true };
      // zenity and osascript exit non-zero on cancel.
      if (e.cancelled) return null;
      throw e;
    }
  );
}

function runCommand(cmd, args) {
  return new Promise((resolve, reject) => {
    let out = '';
    let err = '';
    const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (err += d));
    p.on('error', reject);
    p.on('close', (code) => {
      if (code === 0) return resolve(out);
      // cancel: zenity 1, osascript 1 with "User canceled"
      if (code === 1 || /cancel/i.test(err))
        return reject(Object.assign(new Error('cancelled'), { cancelled: true }));
      reject(
        Object.assign(new Error(`${cmd} failed: ${err.trim() || code}`), { unsupported: true })
      );
    });
  });
}
