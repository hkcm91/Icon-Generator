/**
 * Re-serve a generated image from our own origin.
 *
 * Replicate's delivery CDN sends no permissive CORS header, so drawing those
 * URLs straight into a canvas taints it and every later getImageData() throws —
 * which would take out compositing, background keying and the determinism hash
 * at once.
 */
export default async function handler(request, response) {
  const url = String(request.query?.url ?? '');
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return response.status(400).json({ error: 'Invalid image URL.' });
  }

  // Allowlist: this must not become a general-purpose fetcher.
  const allowed = ['replicate.delivery', 'replicate.com'];
  const permitted =
    parsed.protocol === 'https:' &&
    allowed.some((host) => parsed.hostname === host || parsed.hostname.endsWith(`.${host}`));
  if (!permitted) {
    return response.status(403).json({ error: 'Only Replicate-hosted images may be proxied.' });
  }

  try {
    const upstream = await fetch(parsed.toString());
    if (!upstream.ok) return response.status(upstream.status).end();
    response.setHeader('Content-Type', upstream.headers.get('content-type') || 'image/png');
    response.setHeader('Cache-Control', 'public, max-age=86400');
    response.send(Buffer.from(await upstream.arrayBuffer()));
  } catch (error) {
    response.status(502).json({ error: `Could not fetch the image: ${error.message}` });
  }
}
