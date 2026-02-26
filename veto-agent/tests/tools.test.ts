import { describe, expect, it } from 'vitest';
import { getToolSpec, listTools } from '../src/tools.js';

describe('tool builders', () => {
  it('builds limit order command with normalized notional', () => {
    const tool = getToolSpec('order_create_limit');
    expect(tool).toBeDefined();

    const built = tool!.build({
      token: '123',
      side: 'buy',
      price: 0.5,
      size: 10,
    });

    expect(built.argv).toEqual([
      'clob',
      'create-order',
      '--token', '123',
      '--side', 'buy',
      '--price', '0.5',
      '--size', '10',
    ]);

    expect(built.guardArgs.amount_usd).toBe(5);
  });

  it('rejects invalid market side', () => {
    const tool = getToolSpec('order_market');
    expect(tool).toBeDefined();

    expect(() => tool!.build({
      token: '123',
      side: 'hold',
      amount: 20,
    })).toThrow("Invalid 'side'");
  });

  it('rejects unexpected arguments', () => {
    const tool = getToolSpec('markets_get');
    expect(tool).toBeDefined();

    expect(() => tool!.build({
      market: 'abc',
      unexpected: true,
    })).toThrow("Unexpected argument 'unexpected'");
  });

  it('does not expose wallet mutation tools', () => {
    const names = listTools().map((tool) => tool.name);
    expect(names).not.toContain('wallet_import');
    expect(names).not.toContain('wallet_reset');
    expect(names).not.toContain('clob_delete_api_key');
  });
});
