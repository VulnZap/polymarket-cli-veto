import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { JsonRpcRequest, JsonRpcResponse, McpToolResult } from './types.js';
import { PolymarketVetoRuntime } from './runtime.js';

export interface ServeOptions {
  simulationOverride?: boolean;
}

function makeResponse(id: JsonRpcRequest['id'], result?: unknown, error?: JsonRpcResponse['error']): JsonRpcResponse {
  return {
    jsonrpc: '2.0',
    id,
    result,
    error,
  };
}

function writeJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(payload).toString(),
  });
  res.end(payload);
}

function asToolCallParams(value: unknown): { name: string; arguments: Record<string, unknown> } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid params payload');
  }

  const row = value as Record<string, unknown>;
  if (typeof row.name !== 'string' || row.name.trim().length === 0) {
    throw new Error('Invalid params.name');
  }

  const args = row.arguments;
  if (args !== undefined && (typeof args !== 'object' || args === null || Array.isArray(args))) {
    throw new Error('Invalid params.arguments');
  }

  return {
    name: row.name.trim(),
    arguments: (args ?? {}) as Record<string, unknown>,
  };
}

function toMcpToolCallResult(payload: McpToolResult): Record<string, unknown> {
  return {
    content: payload.content,
    isError: payload.isError,
  };
}

async function handleRpc(runtime: PolymarketVetoRuntime, req: JsonRpcRequest, options: ServeOptions): Promise<JsonRpcResponse | null> {
  if (req.jsonrpc !== '2.0' || typeof req.method !== 'string') {
    return makeResponse(req.id, undefined, {
      code: -32600,
      message: 'Invalid JSON-RPC request',
    });
  }

  if (req.method === 'tools/list') {
    return makeResponse(req.id, {
      tools: runtime.listMcpTools(),
    });
  }

  if (req.method === 'tools/call') {
    try {
      const params = asToolCallParams(req.params);
      const result = await runtime.callTool(params.name, params.arguments, options.simulationOverride);
      return makeResponse(req.id, toMcpToolCallResult(result));
    } catch (error) {
      const rpcError = runtime.toRpcError(error);
      return makeResponse(req.id, undefined, {
        code: rpcError.code,
        message: rpcError.message,
        data: rpcError.data,
      });
    }
  }

  if (req.method === 'initialize') {
    return makeResponse(req.id, {
      protocolVersion: '2025-03-26',
      serverInfo: {
        name: 'polymarket-veto-mcp',
        version: '0.1.0',
      },
      capabilities: {
        tools: {
          listChanged: false,
        },
      },
    });
  }

  if (req.id === undefined) {
    return null;
  }

  return makeResponse(req.id, undefined, {
    code: -32601,
    message: `Unsupported method '${req.method}'`,
  });
}

export async function serveStdio(runtime: PolymarketVetoRuntime, options: ServeOptions = {}): Promise<void> {
  process.stdin.setEncoding('utf-8');

  let buffer = '';

  process.stdin.on('data', async (chunk: string) => {
    buffer += chunk;
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      let parsed: JsonRpcRequest;
      try {
        parsed = JSON.parse(trimmed) as JsonRpcRequest;
      } catch {
        const response = makeResponse(undefined, undefined, {
          code: -32700,
          message: 'Invalid JSON payload',
        });
        process.stdout.write(`${JSON.stringify(response)}\n`);
        continue;
      }

      const response = await handleRpc(runtime, parsed, options);
      if (response) {
        process.stdout.write(`${JSON.stringify(response)}\n`);
      }
    }
  });

  await new Promise<void>((resolve) => {
    process.stdin.on('end', () => resolve());
    process.stdin.on('close', () => resolve());
  });
}

export async function serveSse(runtime: PolymarketVetoRuntime, options: ServeOptions = {}): Promise<void> {
  const startup = runtime.getStartupInfo();
  const startupRecord = startup as Record<string, unknown>;
  const host = typeof startupRecord.host === 'string' ? startupRecord.host : '127.0.0.1';
  const port = typeof startupRecord.port === 'number' ? startupRecord.port : 9800;
  const path = typeof startupRecord.path === 'string' ? startupRecord.path : '/mcp';

  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    if (req.method === 'GET' && req.url === '/health') {
      writeJson(res, 200, {
        ok: true,
        runtime: startup,
      });
      return;
    }

    if (req.method !== 'POST' || req.url !== path) {
      writeJson(res, 404, {
        error: 'Not found',
      });
      return;
    }

    let raw = '';
    req.on('data', (chunk) => {
      raw += String(chunk);
    });

    req.on('end', async () => {
      let parsed: JsonRpcRequest;
      try {
        parsed = JSON.parse(raw) as JsonRpcRequest;
      } catch {
        writeJson(res, 400, makeResponse(undefined, undefined, {
          code: -32700,
          message: 'Invalid JSON payload',
        }));
        return;
      }

      const response = await handleRpc(runtime, parsed, options);
      writeJson(res, 200, response ?? makeResponse(undefined, { ok: true }));
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => resolve());
  });

  process.stderr.write(`polymarket-veto-mcp listening on http://${host}:${port}${path}\n`);

  await new Promise<void>((resolve) => {
    const stop = () => {
      server.close(() => resolve());
    };
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
  });
}
