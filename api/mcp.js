import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createIconMcpServer } from '../server/automation/mcp.mjs';
import { ownerFromRequest } from '../server/automation/security.mjs';

export default async function handler(request, response) {
  const auth = ownerFromRequest(request);
  if (!auth.ok) return response.status(401).json({ error: 'Invalid MCP bearer token.' });
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST');
    return response.status(405).json({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed.' }, id: null });
  }

  const server = createIconMcpServer(auth.ownerKey);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  try {
    await server.connect(transport);
    await transport.handleRequest(request, response, request.body);
  } catch (error) {
    console.error('MCP request failed', error);
    if (!response.headersSent) response.status(500).json({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal server error.' }, id: null });
  } finally {
    await transport.close().catch(() => {});
    await server.close().catch(() => {});
  }
}
