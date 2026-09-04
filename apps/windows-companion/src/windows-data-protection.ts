import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { win32 } from 'node:path';

const MAXIMUM_DPAPI_RESULT_BYTES = 4_096;
const DPAPI_OPERATION_TIMEOUT_MS = 30_000;
const DPAPI_ENTROPY = 'FetanAgent Windows Companion\0KemerBet local identity\0v1';

export interface WindowsCurrentUserDataProtector {
  protect(cleartext: Buffer): Promise<Buffer>;
  unprotect(ciphertext: Buffer): Promise<Buffer>;
}

export class WindowsDataProtectionUnavailableError extends Error {
  constructor() {
    super('Windows current-user data protection is unavailable.');
    this.name = 'WindowsDataProtectionUnavailableError';
  }
}

function unavailable(): never {
  throw new WindowsDataProtectionUnavailableError();
}

function canonicalBase64(value: string): Buffer {
  if (!/^[A-Za-z0-9+/]+={0,2}$/u.test(value) || value.length > 8_192) unavailable();
  const bytes = Buffer.from(value, 'base64');
  if (
    bytes.length < 1 ||
    bytes.length > MAXIMUM_DPAPI_RESULT_BYTES ||
    bytes.toString('base64') !== value
  ) {
    bytes.fill(0);
    unavailable();
  }
  return bytes;
}

function encodedPowerShell(operation: 'Protect' | 'Unprotect'): string {
  const entropyBase64 = Buffer.from(DPAPI_ENTROPY, 'utf8').toString('base64');
  const script = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Security
$encoded = [Console]::In.ReadToEnd().Trim()
if ($encoded -notmatch '^[A-Za-z0-9+/]+={0,2}$' -or $encoded.Length -gt 8192) { exit 2 }
$bytes = [Convert]::FromBase64String($encoded)
$entropy = [Convert]::FromBase64String('${entropyBase64}')
try {
  $result = [Security.Cryptography.ProtectedData]::${operation}(
    $bytes,
    $entropy,
    [Security.Cryptography.DataProtectionScope]::CurrentUser
  )
  [Console]::Out.Write([Convert]::ToBase64String($result))
  [Array]::Clear($result, 0, $result.Length)
} finally {
  [Array]::Clear($bytes, 0, $bytes.Length)
  [Array]::Clear($entropy, 0, $entropy.Length)
}
`;
  return Buffer.from(script, 'utf16le').toString('base64');
}

async function invokeDpapi(
  powershellPath: string,
  operation: 'Protect' | 'Unprotect',
  input: Buffer,
): Promise<Buffer> {
  if (input.length < 1 || input.length > MAXIMUM_DPAPI_RESULT_BYTES) unavailable();
  return await new Promise<Buffer>((resolvePromise, rejectPromise) => {
    let settled = false;
    let outputBytes = 0;
    const output: Buffer[] = [];
    const reject = (): void => {
      if (settled) return;
      settled = true;
      for (const chunk of output) chunk.fill(0);
      output.length = 0;
      rejectPromise(new WindowsDataProtectionUnavailableError());
    };
    const child = spawn(
      powershellPath,
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', encodedPowerShell(operation)],
      { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] },
    );
    const timeout = setTimeout(() => {
      child.kill();
      reject();
    }, DPAPI_OPERATION_TIMEOUT_MS);
    timeout.unref();
    child.once('error', reject);
    child.stdout.on('data', (chunk: Buffer) => {
      if (settled) return;
      outputBytes += chunk.length;
      if (outputBytes > MAXIMUM_DPAPI_RESULT_BYTES * 2) {
        child.kill();
        reject();
        return;
      }
      output.push(Buffer.from(chunk));
    });
    child.once('close', (code) => {
      clearTimeout(timeout);
      if (settled) return;
      if (code !== 0) {
        reject();
        return;
      }
      try {
        const encoded = Buffer.concat(output).toString('ascii').trim();
        const result = canonicalBase64(encoded);
        settled = true;
        resolvePromise(result);
      } catch {
        reject();
      } finally {
        for (const chunk of output) chunk.fill(0);
      }
    });
    child.stdin.once('error', reject);
    child.stdin.end(input.toString('base64'), 'ascii');
  });
}

export function createWindowsCurrentUserDataProtector(
  environment: NodeJS.ProcessEnv = process.env,
): WindowsCurrentUserDataProtector {
  if (process.platform !== 'win32' && environment.NODE_ENV !== 'test') unavailable();
  const windowsRoot = environment.SystemRoot ?? environment.WINDIR;
  if (
    !windowsRoot ||
    !win32.isAbsolute(windowsRoot) ||
    /[\u0000-\u001f\u007f]/u.test(windowsRoot) ||
    windowsRoot.length > 180
  ) {
    unavailable();
  }
  const powershellPath = win32.resolve(
    windowsRoot,
    'System32',
    'WindowsPowerShell',
    'v1.0',
    'powershell.exe',
  );
  if (!existsSync(powershellPath)) unavailable();
  return Object.freeze({
    protect: (cleartext: Buffer) => invokeDpapi(powershellPath, 'Protect', cleartext),
    unprotect: (ciphertext: Buffer) => invokeDpapi(powershellPath, 'Unprotect', ciphertext),
  });
}
