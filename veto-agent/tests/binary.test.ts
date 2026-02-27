import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { resolvePolymarketBinary } from '../src/binary.js';

function createExecutable(filePath: string): void {
  writeFileSync(filePath, '#!/usr/bin/env sh\nexit 0\n', 'utf-8');
  chmodSync(filePath, 0o755);
}

describe('resolvePolymarketBinary', () => {
  it('finds local release binary when configured as auto', () => {
    const root = mkdtempSync(join(tmpdir(), 'veto-polymarket-'));
    try {
      const baseDir = join(root, 'veto-agent');
      const releaseDir = join(root, 'target', 'release');
      mkdirSync(baseDir, { recursive: true });
      mkdirSync(releaseDir, { recursive: true });
      createExecutable(join(releaseDir, 'polymarket'));

      const resolved = resolvePolymarketBinary({
        requestedPath: 'auto',
        baseDir,
        cwd: baseDir,
        env: { PATH: '' },
      });

      expect(resolved.resolvedPath).toBe(join(releaseDir, 'polymarket'));
      expect(resolved.source).toBe('workspace-release');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('uses explicit relative configured binary path', () => {
    const root = mkdtempSync(join(tmpdir(), 'veto-polymarket-'));
    try {
      const baseDir = join(root, 'veto-agent');
      const binDir = join(root, 'bin');
      mkdirSync(baseDir, { recursive: true });
      mkdirSync(binDir, { recursive: true });
      createExecutable(join(binDir, 'pm'));

      const resolved = resolvePolymarketBinary({
        requestedPath: '../bin/pm',
        baseDir,
        cwd: baseDir,
        env: { PATH: '' },
      });

      expect(resolved.resolvedPath).toBe(join(binDir, 'pm'));
      expect(resolved.source).toBe('config');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('reports missing binary with checked paths', () => {
    const root = mkdtempSync(join(tmpdir(), 'veto-polymarket-'));
    try {
      const baseDir = join(root, 'veto-agent');
      mkdirSync(baseDir, { recursive: true });

      const resolved = resolvePolymarketBinary({
        requestedPath: 'auto',
        baseDir,
        cwd: baseDir,
        env: { PATH: '' },
      });

      expect(resolved.resolvedPath).toBeNull();
      expect(resolved.source).toBeNull();
      expect(resolved.checkedPaths.length).toBeGreaterThan(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
