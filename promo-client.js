const FUNCTION_BASE_URL = 'https://us-central1-smartcutservices-9ce54.cloudfunctions.net';

async function requestJson(url, options = {}) {
  console.log('[PROMO_DEBUG][CLIENT] request:start', {
    url,
    method: options?.method || 'GET'
  });
  const response = await fetch(url, options);
  const payload = await response.json().catch(() => ({}));
  console.log('[PROMO_DEBUG][CLIENT] request:response', {
    url,
    ok: response.ok,
    status: response.status,
    payload
  });
  if (!response.ok || payload?.ok === false) {
    throw new Error(payload?.message || payload?.error || `HTTP ${response.status}`);
  }
  return payload;
}

export async function previewPromoCode(payload) {
  return requestJson(`${FUNCTION_BASE_URL}/previewPromoCode`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload || {})
  });
}
