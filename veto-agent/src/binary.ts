import { accessSync, constants } from 'node:fs';
import { delimiter, isAbsolute, join, resolve } from 'node:path';

export type BinarySource = 'env' | 'config' | 'path' | 'workspace-release' | 'workspace-debug' | 'injected';

export interface BinaryResolution {
  requestedPath: string;
  resolvedPath: string | null;
  source: BinarySource | null;
  checkedPaths: string[];
}

interface ResolveBinaryOptions {
  requestedPath: string;
  baseDir: string;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
}

function uniq<T>(items: T[]): T[] {
  return Array.from(new Set(items));
}

function isExecutable(filePath: string): boolean {
  try {
    accessSync(filePath, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function resolveCommandOnPath(command: string, envPath: string | undefined): { resolved: string | null; checked: string[] } {
  const checked: string[] = [];
  if (!envPath) {
    return { resolved: null, checked };
  }

  const suffixes = process.platform === 'win32' ? ['', '.exe', '.cmd', '.bat'] : [''];

  for (const dir of envPath.split(delimiter)) {
    if (!dir) continue;
    for (const suffix of suffixes) {
      const candidate = join(dir, `${command}${suffix}`);
      checked.push(candidate);
      if (isExecutable(candidate)) {
        return { resolved: candidate, checked };
      }
    }
  }

  return { resolved: null, checked };
}

function resolvePathCandidates(candidate: string, baseDir: string, cwd: string): string[] {
  if (isAbsolute(candidate)) {
    return [candidate];
  }
  return uniq([
    resolve(baseDir, candidate),
    resolve(cwd, candidate),
  ]);
}

function hasPathSeparators(value: string): boolean {
  return value.includes('/') || value.includes('\\');
}

export function resolvePolymarketBinary(options: ResolveBinaryOptions): BinaryResolution {
  const env = options.env ?? process.env;
  const cwd = options.cwd ?? process.cwd();
  const requestedPath = options.requestedPath.trim().length > 0 ? options.requestedPath.trim() : 'auto';
  const checkedPaths: string[] = [];

  const roots = uniq([
    options.baseDir,
    cwd,
    resolve(options.baseDir, '..'),
    resolve(cwd, '..'),
    resolve(options.baseDir, '../..'),
    resolve(cwd, '../..'),
  ]);

  const localBuildCandidates = roots.flatMap((root) => ([
    { source: 'workspace-release' as const, candidate: resolve(root, 'target/release/polymarket') },
    { source: 'workspace-debug' as const, candidate: resolve(root, 'target/debug/polymarket') },
  ]));

  const lookupQueue: Array<{ source: BinarySource; candidate: string; type: 'path' | 'command' }> = [];

  const envBinary = env.POLYMARKET_BINARY_PATH?.trim();
  if (envBinary) {
    lookupQueue.push({ source: 'env', candidate: envBinary, type: hasPathSeparators(envBinary) || isAbsolute(envBinary) ? 'path' : 'command' });
  }

  if (requestedPath !== 'auto') {
    lookupQueue.push({
      source: 'config',
      candidate: requestedPath,
      type: hasPathSeparators(requestedPath) || isAbsolute(requestedPath) ? 'path' : 'command',
    });
  }

  lookupQueue.push({ source: 'path', candidate: 'polymarket', type: 'command' });

  for (const local of localBuildCandidates) {
    lookupQueue.push({ source: local.source, candidate: local.candidate, type: 'path' });
  }

  for (const item of lookupQueue) {
    if (item.type === 'command') {
      const resolved = resolveCommandOnPath(item.candidate, env.PATH);
      checkedPaths.push(...resolved.checked);
      if (resolved.resolved) {
        return {
          requestedPath,
          resolvedPath: resolved.resolved,
          source: item.source,
          checkedPaths: uniq(checkedPaths),
        };
      }
      continue;
    }

    const absoluteCandidates = resolvePathCandidates(item.candidate, options.baseDir, cwd);
    for (const candidate of absoluteCandidates) {
      checkedPaths.push(candidate);
      if (isExecutable(candidate)) {
        return {
          requestedPath,
          resolvedPath: candidate,
          source: item.source,
          checkedPaths: uniq(checkedPaths),
        };
      }
    }
  }

  return {
    requestedPath,
    resolvedPath: null,
    source: null,
    checkedPaths: uniq(checkedPaths),
  };
}
