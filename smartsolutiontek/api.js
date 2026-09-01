// Shared fetch helper for the SmartSolutionTek Cloud Functions (sst-prefixed).
// Same base-URL convention already used elsewhere in this project (see
// DvendorProducts.html VENDOR_*_FUNCTION_URL constants).

const FUNCTIONS_BASE = 'https://us-central1-smartcutservices-9ce54.cloudfunctions.net';

/**
 * Calls a SmartSolutionTek Cloud Function.
 * @param {string} name - function name without the "sst" prefix, e.g. "CreateOrganization".
 * @param {{ method?: string, body?: object, query?: object, auth?: import('firebase/auth').User|null }} options
 */
export async function callSst(name, { method = 'GET', body, query, auth } = {}) {
  const url = new URL(`${FUNCTIONS_BASE}/sst${name}`);
  if (query) {
    Object.entries(query).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, value);
    });
  }

  // Keep public GET calls as simple CORS requests. JSON is needed only for
  // mutating calls; adding it to GET causes an unnecessary OPTIONS preflight.
  const headers = method === 'GET' ? {} : { 'Content-Type': 'application/json' };
  if (auth) {
    try {
      const token = await auth.getIdToken();
      headers.Authorization = `Bearer ${token}`;
    } catch (_) { /* not signed in — request proceeds unauthenticated for public endpoints */ }
  }

  let response;
  try {
    response = await fetch(url.toString(), {
      method,
      headers,
      body: method === 'GET' ? undefined : JSON.stringify(body || {})
    });
  } catch (networkError) {
    throw new SstApiError('network-error', 'Impossible de contacter le serveur. Verifiez votre connexion.');
  }

  let payload = null;
  try {
    payload = await response.json();
  } catch (_) {
    // Non-JSON response (should not happen for sst* functions, which always return JSON).
  }

  if (!response.ok || !payload?.ok) {
    throw new SstApiError(
      payload?.error || `http-${response.status}`,
      payload?.message || "Une erreur est survenue. Reessayez dans un instant."
    );
  }

  return payload;
}

export class SstApiError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

export function showToast(message, type = 'success') {
  document.querySelectorAll('.sst-toast').forEach((el) => el.remove());
  const toast = document.createElement('div');
  toast.className = `sst-toast ${type}`;
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 4000);
}

export function formatCurrency(amount) {
  const value = Number(amount) || 0;
  return `${value.toLocaleString('fr-FR', { maximumFractionDigits: 2 })} HTG`;
}

export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
