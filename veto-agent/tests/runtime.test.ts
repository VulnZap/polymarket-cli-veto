import { describe, expect, it } from 'vitest';
import { PolymarketVetoRuntime } from '../src/runtime.js';
import type { ExecutionResult, ResolvedConfig, RuntimeDecision } from '../src/types.js';

function makeConfig(): ResolvedConfig {
  return {
    path: '/tmp/polymarket-veto.config.yaml',
    baseDir: process.cwd(),
    source: 'defaults',
    config: {
      polymarket: {
        binaryPath: 'polymarket',
      },
      execution: {
        simulationDefault: true,
        allowLiveTrades: false,
        maxCommandTimeoutMs: 10_000,
        maxOutputBytes: 1_048_576,
      },
      mcp: {
        transport: 'stdio',
        host: '127.0.0.1',
        port: 9800,
        path: '/mcp',
      },
      veto: {
        configDir: '../veto',
        policyProfile: 'defaults',
        cloud: {
          apiKeyEnv: 'VETO_API_KEY',
        },
      },
    },
  };
}

function okExecution(argv: string[], parsed: unknown): ExecutionResult {
  return {
    ok: true,
    exitCode: 0,
    stdout: JSON.stringify(parsed),
    stderr: '',
    parsed,
    argv,
    commandPreview: `polymarket -o json ${argv.join(' ')}`,
  };
}

describe('runtime decisions', () => {
  it('maps deny decisions to policy error code', async () => {
    const runtime = await PolymarketVetoRuntime.create(makeConfig(), {
      guard: {
        async guard(): Promise<RuntimeDecision> {
          return { decision: 'deny', reason: 'budget exceeded' };
        },
      },
      execute: async (binary, argv) => okExecution(argv, { ok: true }),
    });

    let error: unknown;
    try {
      await runtime.callTool('order_market', { token: '1', side: 'buy', amount: 10 });
    } catch (err) {
      error = err;
    }

    const mapped = runtime.toRpcError(error);
    expect(mapped.code).toBe(-32001);
    expect(mapped.message).toContain('Denied by policy');
  });

  it('maps approval decisions to approval-required code', async () => {
    const runtime = await PolymarketVetoRuntime.create(makeConfig(), {
      guard: {
        async guard(): Promise<RuntimeDecision> {
          return { decision: 'require_approval', reason: 'high amount' };
        },
      },
      execute: async (binary, argv) => okExecution(argv, { ok: true }),
    });

    let error: unknown;
    try {
      await runtime.callTool('order_market', { token: '1', side: 'buy', amount: 10 });
    } catch (err) {
      error = err;
    }

    const mapped = runtime.toRpcError(error);
    expect(mapped.code).toBe(-32002);
    expect(mapped.message).toContain('Approval required');
  });

  it('simulates mutating commands and computes notional/estimates', async () => {
    const calls: string[][] = [];

    const runtime = await PolymarketVetoRuntime.create(makeConfig(), {
      guard: {
        async guard(): Promise<RuntimeDecision> {
          return { decision: 'allow' };
        },
      },
      execute: async (binary, argv) => {
        calls.push(argv);
        if (argv[0] === 'clob' && argv[1] === 'midpoint') {
          return okExecution(argv, { midpoint: 0.5 });
        }
        return okExecution(argv, { ok: true });
      },
    });

    const result = await runtime.callTool('order_market', {
      token: '1',
      side: 'buy',
      amount: 20,
    });

    const payload = JSON.parse(result.content[0]!.text) as Record<string, unknown>;
    expect(payload.simulation).toBe(true);
    expect(payload.estimatedShares).toBe(40);

    // midpoint lookup should happen, live command should not execute.
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual(['clob', 'midpoint', '1']);
  });
});
