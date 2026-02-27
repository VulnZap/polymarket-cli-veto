import { spawn } from 'node:child_process';
import type { ExecutionResult } from './types.js';

interface ExecuteOptions {
  timeoutMs: number;
  maxOutputBytes: number;
}

function maybeJson(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return trimmed;
  }
}

function redact(text: string): string {
  return text.replace(/0x[a-fA-F0-9]{64}/g, '[redacted-private-key]');
}

function ensureJsonMode(argv: string[]): string[] {
  const hasOutputFlag = argv.some((value, index) => (value === '--output' || value === '-o') && index < argv.length - 1);
  if (hasOutputFlag) {
    return [...argv];
  }
  return ['-o', 'json', ...argv];
}

export async function executePolymarket(
  binaryPath: string,
  argv: string[],
  options: ExecuteOptions,
): Promise<ExecutionResult> {
  const normalizedArgv = ensureJsonMode(argv);
  const commandPreview = `${binaryPath} ${normalizedArgv.join(' ')}`;

  return await new Promise<ExecutionResult>((resolve) => {
    const child = spawn(binaryPath, normalizedArgv, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env,
    });

    let stdout = '';
    let stderr = '';
    let outputTooLarge = false;

    const timer = setTimeout(() => {
      child.kill('SIGTERM');
    }, options.timeoutMs);

    child.stdout.on('data', (chunk: Buffer) => {
      if (outputTooLarge) return;
      stdout += chunk.toString('utf-8');
      if (Buffer.byteLength(stdout) > options.maxOutputBytes) {
        outputTooLarge = true;
        child.kill('SIGTERM');
      }
    });

    child.stderr.on('data', (chunk: Buffer) => {
      if (outputTooLarge) return;
      stderr += chunk.toString('utf-8');
      if (Buffer.byteLength(stderr) > options.maxOutputBytes) {
        outputTooLarge = true;
        child.kill('SIGTERM');
      }
    });

    child.on('error', (error) => {
      clearTimeout(timer);
      resolve({
        ok: false,
        exitCode: -1,
        stdout: redact(stdout),
        stderr: redact(`${stderr}\n${error.message}`.trim()),
        parsed: null,
        argv: normalizedArgv,
        commandPreview,
      });
    });

    child.on('close', (code) => {
      clearTimeout(timer);

      if (outputTooLarge) {
        resolve({
          ok: false,
          exitCode: code ?? -1,
          stdout: '',
          stderr: `Command output exceeded ${options.maxOutputBytes} bytes`,
          parsed: null,
          argv: normalizedArgv,
          commandPreview,
        });
        return;
      }

      const safeStdout = redact(stdout);
      const safeStderr = redact(stderr);
      const parsed = maybeJson(safeStdout);
      const ok = (code ?? -1) === 0;

      resolve({
        ok,
        exitCode: code ?? -1,
        stdout: safeStdout,
        stderr: safeStderr,
        parsed,
        argv: normalizedArgv,
        commandPreview,
      });
    });
  });
}
