import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { Veto } from 'veto-sdk';
import { executePolymarket } from './executor.js';
import { getToolSpec, listTools, profileAgentId, type ToolSpec } from './tools.js';
import type {
  ExecutionResult,
  McpToolResult,
  ResolvedConfig,
  RuntimeDecision,
  RuntimeErrorShape,
} from './types.js';

interface GuardClient {
  guard(toolName: string, args: Record<string, unknown>, context: { sessionId: string; agentId: string }): Promise<RuntimeDecision>;
}

interface RuntimeDependencies {
  execute?: (binaryPath: string, argv: string[], opts: { timeoutMs: number; maxOutputBytes: number }) => Promise<ExecutionResult>;
  guard?: GuardClient;
}

interface LiveState {
  simulation: boolean;
  reason?: string;
}

class RuntimeError extends Error {
  readonly shape: RuntimeErrorShape;

  constructor(shape: RuntimeErrorShape) {
    super(shape.message);
    this.shape = shape;
  }
}

function jsonText(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function asNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function extractMidpoint(value: unknown): number | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  return asNumber(row.midpoint) ?? asNumber(row.mid) ?? asNumber(row.price) ?? null;
}

export class PolymarketVetoRuntime {
  private readonly sessionId: string;
  private readonly agentId: string;
  private readonly execute: NonNullable<RuntimeDependencies['execute']>;
  private readonly guard: GuardClient;

  private constructor(
    private readonly resolved: ResolvedConfig,
    deps: RuntimeDependencies,
  ) {
    this.sessionId = `session-${Date.now().toString(36)}`;
    this.agentId = profileAgentId(this.resolved.config.veto.policyProfile);
    this.execute = deps.execute ?? executePolymarket;
    this.guard = deps.guard as GuardClient;
  }

  static async create(resolved: ResolvedConfig, deps: RuntimeDependencies = {}): Promise<PolymarketVetoRuntime> {
    if (!deps.guard) {
      const vetoConfigDir = resolve(resolved.baseDir, resolved.config.veto.configDir);
      const veto = await Veto.init({
        configDir: vetoConfigDir,
        logLevel: 'silent',
      });

      deps.guard = {
        guard: (toolName, args, context) => veto.guard(toolName, args, context),
      };
    }

    return new PolymarketVetoRuntime(resolved, deps);
  }

  getStartupInfo(): Record<string, unknown> {
    return {
      configPath: this.resolved.path,
      configSource: this.resolved.source,
      profile: this.resolved.config.veto.policyProfile,
      agentId: this.agentId,
      simulationDefault: this.resolved.config.execution.simulationDefault,
      allowLiveTrades: this.resolved.config.execution.allowLiveTrades,
      transport: this.resolved.config.mcp.transport,
      host: this.resolved.config.mcp.host,
      port: this.resolved.config.mcp.port,
      path: this.resolved.config.mcp.path,
      binaryPath: this.resolved.config.polymarket.binaryPath,
    };
  }

  listMcpTools(): Array<{ name: string; description: string; inputSchema: Record<string, unknown> }> {
    return listTools().map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema as unknown as Record<string, unknown>,
    }));
  }

  async doctor(): Promise<Record<string, unknown>> {
    const binaryResult = await this.execute(
      this.resolved.config.polymarket.binaryPath,
      ['--version'],
      {
        timeoutMs: Math.min(this.resolved.config.execution.maxCommandTimeoutMs, 4000),
        maxOutputBytes: this.resolved.config.execution.maxOutputBytes,
      },
    );

    const vetoConfigPath = resolve(this.resolved.baseDir, this.resolved.config.veto.configDir, 'veto.config.yaml');
    const rulesDir = resolve(this.resolved.baseDir, this.resolved.config.veto.configDir, 'rules');

    return {
      ok: binaryResult.ok && existsSync(vetoConfigPath) && existsSync(rulesDir),
      binary: {
        path: this.resolved.config.polymarket.binaryPath,
        ok: binaryResult.ok,
        exitCode: binaryResult.exitCode,
        stdout: binaryResult.stdout.trim(),
        stderr: binaryResult.stderr.trim(),
      },
      veto: {
        configDir: resolve(this.resolved.baseDir, this.resolved.config.veto.configDir),
        configPath: vetoConfigPath,
        configExists: existsSync(vetoConfigPath),
        rulesDir,
        rulesDirExists: existsSync(rulesDir),
        profile: this.resolved.config.veto.policyProfile,
        agentId: this.agentId,
      },
      runtime: this.getStartupInfo(),
    };
  }

  async callTool(toolName: string, args: Record<string, unknown>, simulationOverride?: boolean): Promise<McpToolResult> {
    const spec = getToolSpec(toolName);
    if (!spec) {
      throw new RuntimeError({
        code: -32601,
        message: `Unknown tool '${toolName}'`,
      });
    }

    let built;
    try {
      built = spec.build(args);
    } catch (error) {
      throw new RuntimeError({
        code: -32602,
        message: error instanceof Error ? error.message : 'Invalid tool arguments',
      });
    }

    const guardArgs = {
      ...built.guardArgs,
      timestamp: new Date().toISOString(),
    };

    const decision = await this.guard.guard(toolName, guardArgs, {
      sessionId: this.sessionId,
      agentId: this.agentId,
    });

    if (decision.decision === 'deny') {
      throw new RuntimeError({
        code: -32001,
        message: `Denied by policy: ${decision.reason ?? 'policy violation'}`,
        data: {
          ruleId: decision.ruleId,
        },
      });
    }

    if (decision.decision === 'require_approval') {
      throw new RuntimeError({
        code: -32002,
        message: `Approval required: ${decision.reason ?? 'awaiting approval'}`,
        data: {
          ruleId: decision.ruleId,
          approvalId: decision.approvalId,
        },
      });
    }

    const liveState = this.resolveLiveState(spec, simulationOverride);

    if (spec.mutating && liveState.simulation) {
      const simulation = await this.simulate(spec, built, liveState.reason);
      return {
        content: [{
          type: 'text',
          text: jsonText(simulation),
        }],
      };
    }

    const execution = await this.execute(
      this.resolved.config.polymarket.binaryPath,
      built.argv,
      {
        timeoutMs: this.resolved.config.execution.maxCommandTimeoutMs,
        maxOutputBytes: this.resolved.config.execution.maxOutputBytes,
      },
    );

    if (!execution.ok) {
      throw new RuntimeError({
        code: -32003,
        message: `Command failed: ${execution.stderr || `exit code ${execution.exitCode}`}`,
        data: {
          command: execution.commandPreview,
          exitCode: execution.exitCode,
          stderr: execution.stderr,
        },
      });
    }

    return {
      content: [{
        type: 'text',
        text: jsonText({
          live: spec.mutating,
          tool: spec.name,
          command: execution.commandPreview,
          output: execution.parsed,
        }),
      }],
    };
  }

  private resolveLiveState(spec: ToolSpec, simulationOverride?: boolean): LiveState {
    if (!spec.mutating) {
      return { simulation: false };
    }

    const simulationEnabled = simulationOverride ?? this.resolved.config.execution.simulationDefault;
    if (simulationEnabled) {
      return { simulation: true, reason: 'simulation mode enabled' };
    }

    if (!this.resolved.config.execution.allowLiveTrades) {
      return { simulation: true, reason: 'live trading disabled in config' };
    }

    if ((process.env.ALLOW_LIVE_TRADES ?? '').toLowerCase() !== 'true') {
      return { simulation: true, reason: 'ALLOW_LIVE_TRADES=true not set' };
    }

    return { simulation: false };
  }

  private async simulate(spec: ToolSpec, built: { argv: string[]; guardArgs: Record<string, unknown> }, reason?: string): Promise<Record<string, unknown>> {
    const out: Record<string, unknown> = {
      simulation: true,
      reason,
      tool: spec.name,
      command: `${this.resolved.config.polymarket.binaryPath} -o json ${built.argv.join(' ')}`,
      guardArgs: built.guardArgs,
      liveTrading: false,
    };

    if (spec.name === 'order_market' || spec.name === 'order_create_limit') {
      const token = typeof built.guardArgs.token === 'string' ? built.guardArgs.token : null;
      if (token) {
        const midpointResponse = await this.execute(
          this.resolved.config.polymarket.binaryPath,
          ['clob', 'midpoint', token],
          {
            timeoutMs: Math.min(this.resolved.config.execution.maxCommandTimeoutMs, 5000),
            maxOutputBytes: this.resolved.config.execution.maxOutputBytes,
          },
        );

        if (midpointResponse.ok) {
          const midpoint = extractMidpoint(midpointResponse.parsed);
          out.marketReference = {
            token,
            midpoint,
            raw: midpointResponse.parsed,
          };

          if (spec.name === 'order_market') {
            const amount = asNumber(built.guardArgs.amount);
            if (amount !== null && midpoint !== null && midpoint > 0) {
              out.estimatedShares = Number((amount / midpoint).toFixed(6));
            }
          }

          if (spec.name === 'order_create_limit') {
            const price = asNumber(built.guardArgs.price);
            const size = asNumber(built.guardArgs.size);
            if (price !== null && size !== null) {
              out.estimatedNotionalUsd = Number((price * size).toFixed(6));
            }
            if (price !== null && midpoint !== null) {
              out.priceVsMidpoint = Number((price - midpoint).toFixed(6));
            }
          }
        } else {
          out.marketReference = {
            token,
            warning: midpointResponse.stderr || `midpoint lookup failed with code ${midpointResponse.exitCode}`,
          };
        }
      }
    }

    return out;
  }

  toRpcError(error: unknown): RuntimeErrorShape {
    if (error instanceof RuntimeError) {
      return error.shape;
    }

    if (error instanceof Error) {
      return {
        code: -32603,
        message: error.message,
      };
    }

    return {
      code: -32603,
      message: 'Unknown runtime error',
      data: { error },
    };
  }
}
