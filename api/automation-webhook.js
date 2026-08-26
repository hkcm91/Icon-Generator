import { acceptWebhook } from '../server/automation/service.mjs';
import { publicError } from '../server/automation/recipe.mjs';

export default async function handler(request, response) {
  if (request.method !== 'POST') return response.status(405).json({ error: 'Method not allowed.' });
  try {
    const result = await acceptWebhook({
      jobId: String(request.query?.job ?? ''), itemId: String(request.query?.item ?? ''),
      token: String(request.query?.token ?? ''), prediction: request.body,
    });
    response.json(result);
  } catch (error) {
    const value = publicError(error);
    response.status(value.code === 'INVALID_WEBHOOK' || value.code === 'INVALID_TOKEN' ? 401 : 400).json({ error: value });
  }
}
