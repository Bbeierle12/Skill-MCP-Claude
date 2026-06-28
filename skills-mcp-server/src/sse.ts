#!/usr/bin/env node
/**
 * Skills MCP Server - SSE Transport
 *
 * MCP server with SSE/Streamable HTTP transport for Claude.ai integration.
 * Provides the same tools as the stdio version but over HTTP.
 *
 * Usage:
 *   node dist/sse.js
 *
 * Environment variables:
 *   SKILLS_DIR - Path to skills directory (default: ../skills)
 *   SSE_PORT - Port to listen on (default: 3001)
 */

import { randomUUID } from 'node:crypto';
import express, { type Request, type Response } from 'express';
import cors from 'cors';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';

import { getSkillsDir, SSE_HOST, SSE_PORT } from './constants.js';
import { SkillIndexer, SearchService, FileWatcher, StatsTracker } from './services/index.js';
import { registerAllTools } from './tools/index.js';
import type { ServiceContext } from './types.js';
import {
  createCorsOptions,
  createOriginGuard,
  defaultAllowedOrigins,
  envFlag,
  requireBearerAuth
} from './utils/security.js';

// Store transports by session ID
const transports: Record<string, SSEServerTransport | StreamableHTTPServerTransport> = {};

// Shared service context
let ctx: ServiceContext;

/**
 * Create a new MCP server instance with all tools registered
 */
function createServer(): McpServer {
  const server = new McpServer({
    name: 'skills-mcp-server',
    version: '1.0.0'
  }, { capabilities: { logging: {} } });

  registerAllTools(server, ctx);
  return server;
}

async function main(): Promise<void> {
  const skillsDir = getSkillsDir();

  console.error('[Skills MCP SSE] Starting...');
  console.error(`[Skills MCP SSE] Skills directory: ${skillsDir}`);

  // Initialize services
  const indexer = new SkillIndexer(skillsDir);
  const search = new SearchService(indexer);
  const stats = new StatsTracker();

  // Pre-load indexes
  const { skillCount, contentFilesIndexed } = await indexer.reload();
  console.error(`[Skills MCP SSE] Indexed ${skillCount} skills, ${contentFilesIndexed} content files`);

  // Create service context
  ctx = {
    indexer,
    search,
    stats,
    skillsDir
  };

  // Start file watcher
  const watcher = new FileWatcher(skillsDir, async () => {
    await indexer.reload();
  });
  watcher.start();

  // Create Express app
  const app = express();
  const allowedOrigins = defaultAllowedOrigins([SSE_PORT]);
  const requireMcpAuth = requireBearerAuth({
    tokenEnv: 'SKILLS_MCP_AUTH_TOKEN',
    requiredEnv: 'SKILLS_MCP_AUTH_REQUIRED',
    realm: 'skills-mcp'
  });
  app.use(createOriginGuard(allowedOrigins));
  app.use(cors(createCorsOptions(allowedOrigins)));
  app.use(express.json({ limit: '1mb' }));

  // Health check endpoint
  app.get('/health', async (_req: Request, res: Response) => {
    const index = await indexer.getSkillIndex();
    res.json({ status: 'ok', skills: index.skills.length });
  });

  //=============================================================================
  // STREAMABLE HTTP TRANSPORT (PROTOCOL VERSION 2025-11-25)
  //=============================================================================
  app.all('/mcp', requireMcpAuth, async (req: Request, res: Response) => {
    console.error(`[Skills MCP SSE] Received ${req.method} request to /mcp`);

    try {
      const sessionId = req.headers['mcp-session-id'] as string | undefined;
      let transport: StreamableHTTPServerTransport;

      if (sessionId && transports[sessionId]) {
        const existingTransport = transports[sessionId];
        if (existingTransport instanceof StreamableHTTPServerTransport) {
          transport = existingTransport;
        } else {
          res.status(400).json({
            jsonrpc: '2.0',
            error: {
              code: -32000,
              message: 'Bad Request: Session exists but uses a different transport protocol'
            },
            id: null
          });
          return;
        }
      } else if (!sessionId && req.method === 'POST' && isInitializeRequest(req.body)) {
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (sid: string) => {
            console.error(`[Skills MCP SSE] StreamableHTTP session initialized: ${sid}`);
            transports[sid] = transport;
          }
        });

        transport.onclose = () => {
          const sid = transport.sessionId;
          if (sid && transports[sid]) {
            console.error(`[Skills MCP SSE] Transport closed for session ${sid}`);
            delete transports[sid];
          }
        };

        const server = createServer();
        await server.connect(transport);
      } else {
        res.status(400).json({
          jsonrpc: '2.0',
          error: {
            code: -32000,
            message: 'Bad Request: No valid session ID provided'
          },
          id: null
        });
        return;
      }

      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      console.error('[Skills MCP SSE] Error handling MCP request:', error);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: '2.0',
          error: {
            code: -32603,
            message: 'Internal server error'
          },
          id: null
        });
      }
    }
  });

  //=============================================================================
  // DEPRECATED HTTP+SSE TRANSPORT (PROTOCOL VERSION 2024-11-05)
  // Kept for backwards compatibility with older clients
  //=============================================================================
  if (envFlag('SKILLS_ENABLE_LEGACY_SSE', false)) {
    app.get('/sse', requireMcpAuth, async (_req: Request, res: Response) => {
      console.error('[Skills MCP SSE] Received GET request to /sse');

      try {
        const transport = new SSEServerTransport('/messages', res);
        transports[transport.sessionId] = transport;

        transport.onclose = () => {
          console.error(`[Skills MCP SSE] SSE transport closed for session ${transport.sessionId}`);
          delete transports[transport.sessionId];
        };

        const server = createServer();
        await server.connect(transport);
        console.error(`[Skills MCP SSE] Established SSE stream with session ID: ${transport.sessionId}`);
      } catch (error) {
        console.error('[Skills MCP SSE] Error establishing SSE stream:', error);
        if (!res.headersSent) {
          res.status(500).send('Error establishing SSE stream');
        }
      }
    });

    app.post('/messages', requireMcpAuth, async (req: Request, res: Response) => {
      console.error('[Skills MCP SSE] Received POST request to /messages');

      const sessionId = req.query.sessionId as string;
      if (!sessionId) {
        res.status(400).send('Missing sessionId parameter');
        return;
      }

      const transport = transports[sessionId];
      if (!transport || !(transport instanceof SSEServerTransport)) {
        res.status(404).send('Session not found');
        return;
      }

      try {
        await transport.handlePostMessage(req, res, req.body);
      } catch (error) {
        console.error('[Skills MCP SSE] Error handling request:', error);
        if (!res.headersSent) {
          res.status(500).send('Error handling request');
        }
      }
    });
  }

  // Start server
  app.listen(SSE_PORT, SSE_HOST, () => {
    console.error(`[Skills MCP SSE] Listening on http://${SSE_HOST}:${SSE_PORT}`);
    console.error(`
==============================================
CLAUDE.AI CONNECTOR SETUP:

1. Set SKILLS_MCP_AUTH_TOKEN to a long random value before using HTTP transport.
2. Keep the default ${SSE_HOST} bind unless you intentionally put this behind
   authenticated TLS reverse proxy.
3. Add new connector with URL: https://your-domain.com/mcp.
   Legacy /sse is disabled unless SKILLS_ENABLE_LEGACY_SSE=true.

LOCAL TESTING:
- Health check: http://localhost:${SSE_PORT}/health
- Streamable HTTP: http://localhost:${SSE_PORT}/mcp
==============================================
`);
  });

  // Graceful shutdown
  const shutdown = async (): Promise<void> => {
    console.error('[Skills MCP SSE] Shutting down...');
    watcher.stop();

    for (const sessionId in transports) {
      try {
        console.error(`[Skills MCP SSE] Closing transport for session ${sessionId}`);
        await transports[sessionId].close();
        delete transports[sessionId];
      } catch (error) {
        console.error(`[Skills MCP SSE] Error closing transport:`, error);
      }
    }

    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((error) => {
  console.error('[Skills MCP SSE] Fatal error:', error);
  process.exit(1);
});
