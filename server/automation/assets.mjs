function storageConfigured() {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

export async function persistRemoteAsset(url, path) {
  if (!storageConfigured()) return url;
  const source = await fetch(url);
  if (!source.ok) throw Object.assign(new Error(`Could not preserve provider output (${source.status}).`), { code: 'ASSET_FETCH_FAILED', retryable: true });
  const bytes = Buffer.from(await source.arrayBuffer());
  const bucket = process.env.ICON_AUTOMATION_BUCKET || 'icon-automation';
  const endpoint = `${process.env.SUPABASE_URL.replace(/\/$/, '')}/storage/v1/object/${bucket}/${path}`;
  const upload = await fetch(endpoint, {
    method: 'POST',
    headers: {
      apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': source.headers.get('content-type') || 'image/png',
      'x-upsert': 'true',
    },
    body: bytes,
  });
  if (!upload.ok) throw Object.assign(new Error(`Could not store provider output (${upload.status}): ${(await upload.text()).slice(0, 300)}`), { code: 'ASSET_STORE_FAILED', retryable: true });
  return `${process.env.SUPABASE_URL.replace(/\/$/, '')}/storage/v1/object/public/${bucket}/${path}`;
}
