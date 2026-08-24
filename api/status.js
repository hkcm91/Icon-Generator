import { checkToken, resolveToken } from './_replicate.js';

/**
 * Whether a usable key exists, and where it came from. Never the key itself.
 *
 * `acceptsClientToken` tells the UI it may hold a key in the browser and send it
 * per request — the only workable model on stateless serverless, where nothing
 * "saved" server-side survives to the next invocation.
 */
export default async function handler(request, response) {
  const token = resolveToken(request);
  const fromEnv = Boolean(process.env.REPLICATE_API_TOKEN);

  if (!token) {
    return response.json({ connected: false, source: 'none', acceptsClientToken: true });
  }

  try {
    const result = await checkToken(token);
    response.json({
      connected: result.ok,
      source: fromEnv ? 'env' : 'client',
      account: result.account,
      error: result.ok ? undefined : result.error,
      acceptsClientToken: true,
    });
  } catch (error) {
    response.json({
      connected: false,
      source: fromEnv ? 'env' : 'client',
      error: `Could not reach Replicate: ${error.message}`,
      acceptsClientToken: true,
    });
  }
}
