import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { POLICY_PROFILES, type McpTransport, type PolicyProfile, type ResolvedConfig, type SidecarConfig } from './types.js';

const DEFAULT_CONFIG_PATHS = [
  'veto-agent/polymarket-veto.config.yaml',
  'polymarket-veto.config.yaml',
];

const DEFAULTS: SidecarConfig = {
  polymarket: {
    binaryPath: 'auto',
  },
  execution: {
    simulationDefault: true,
    allowLiveTrades: false,
    maxCommandTimeoutMs: 15_000,
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
};

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function optionalString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function optionalBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function optionalPositiveInt(value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined;
  const parsed = typeof value === 'number' ? value : Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
  return Math.floor(parsed);
}

function parseTransport(value: unknown, fallback: McpTransport): McpTransport {
  if (value === 'stdio' || value === 'sse') return value;
  return fallback;
}

function parsePolicyProfile(value: unknown, fallback: PolicyProfile): PolicyProfile {
  if (typeof value === 'string' && POLICY_PROFILES.includes(value as PolicyProfile)) {
    return value as PolicyProfile;
  }
  return fallback;
}

function merge(raw: unknown, base: SidecarConfig): SidecarConfig {
  const root = asRecord(raw);

  const polymarket = asRecord(root.polymarket);
  const execution = asRecord(root.execution);
  const mcp = asRecord(root.mcp);
  const veto = asRecord(root.veto);
  const cloud = asRecord(veto.cloud);

  return {
    polymarket: {
      binaryPath: optionalString(polymarket.binaryPath) ?? base.polymarket.binaryPath,
    },
    execution: {
      simulationDefault: optionalBoolean(execution.simulationDefault) ?? base.execution.simulationDefault,
      allowLiveTrades: optionalBoolean(execution.allowLiveTrades) ?? base.execution.allowLiveTrades,
      maxCommandTimeoutMs: optionalPositiveInt(execution.maxCommandTimeoutMs) ?? base.execution.maxCommandTimeoutMs,
      maxOutputBytes: optionalPositiveInt(execution.maxOutputBytes) ?? base.execution.maxOutputBytes,
    },
    mcp: {
      transport: parseTransport(mcp.transport, base.mcp.transport),
      host: optionalString(mcp.host) ?? base.mcp.host,
      port: optionalPositiveInt(mcp.port) ?? base.mcp.port,
      path: optionalString(mcp.path) ?? base.mcp.path,
    },
    veto: {
      configDir: optionalString(veto.configDir) ?? base.veto.configDir,
      policyProfile: parsePolicyProfile(veto.policyProfile, base.veto.policyProfile),
      cloud: {
        apiKeyEnv: optionalString(cloud.apiKeyEnv) ?? base.veto.cloud.apiKeyEnv,
      },
    },
  };
}

function findExistingConfigPath(explicitPath?: string): string | null {
  if (explicitPath) {
    const resolved = resolve(explicitPath);
    return existsSync(resolved) ? resolved : resolved;
  }

  for (const relative of DEFAULT_CONFIG_PATHS) {
    const candidate = resolve(relative);
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

export function loadConfig(explicitPath?: string): ResolvedConfig {
  const resolvedPath = findExistingConfigPath(explicitPath);

  if (resolvedPath && existsSync(resolvedPath)) {
    const content = readFileSync(resolvedPath, 'utf-8');
    const parsed = parseYaml(content) as unknown;
    const config = merge(parsed, DEFAULTS);

    return {
      path: resolvedPath,
      baseDir: dirname(resolvedPath),
      source: 'file',
      config,
    };
  }

  const syntheticPath = resolvedPath ?? resolve(DEFAULT_CONFIG_PATHS[0]);
  return {
    path: syntheticPath,
    baseDir: dirname(syntheticPath),
    source: 'defaults',
    config: DEFAULTS,
  };
}

export function toJsonSafeConfig(config: SidecarConfig): SidecarConfig {
  return {
    ...config,
    polymarket: { ...config.polymarket },
    execution: { ...config.execution },
    mcp: { ...config.mcp },
    veto: {
      ...config.veto,
      cloud: { ...config.veto.cloud },
    },
  };
}
