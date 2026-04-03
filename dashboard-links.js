const globalBase =
  typeof window !== 'undefined' && typeof window.SMARTCUT_DASHBOARD_BASE_URL === 'string'
    ? window.SMARTCUT_DASHBOARD_BASE_URL
    : '';

export const DASHBOARD_BASE_URL = (globalBase || 'https://smartcutservices.github.io/dashboard-').replace(/\/+$/, '');
export const DASHBOARD_FUNCTIONS_BASE_URL = 'https://us-central1-smartcutservices-9ce54.cloudfunctions.net';

export function getDashboardUrl(path = 'dashboard.html') {
  const cleanPath = String(path || 'dashboard.html').replace(/^\/+/, '');
  return `${DASHBOARD_BASE_URL}/${cleanPath}`;
}

export const VENDOR_DASHBOARD_URL = getDashboardUrl('DvendorProducts.html');

export async function getVendorDashboardAccessUrl(user) {
  if (!user?.getIdToken) {
    throw new Error('missing-auth-user');
  }

  const idToken = await user.getIdToken();
  const response = await fetch(`${DASHBOARD_FUNCTIONS_BASE_URL}/createVendorDashboardAccess`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`
    },
    body: JSON.stringify({ requestedAt: new Date().toISOString() })
  });

  let payload = {};
  try {
    payload = await response.json();
  } catch (_) {
    payload = {};
  }

  if (!response.ok || !payload?.dashboardUrl) {
    const error = new Error(payload?.message || payload?.error || 'vendor-dashboard-bootstrap-failed');
    error.code = payload?.error || '';
    throw error;
  }

  return payload.dashboardUrl;
}
