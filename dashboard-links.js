const globalBase =
  typeof window !== 'undefined' && typeof window.SMARTCUT_DASHBOARD_BASE_URL === 'string'
    ? window.SMARTCUT_DASHBOARD_BASE_URL
    : '';

export const DASHBOARD_BASE_URL = (globalBase || 'https://smartcutservices.github.io/dashboard-').replace(/\/+$/, '');

export function getDashboardUrl(path = 'dashboard.html') {
  const cleanPath = String(path || 'dashboard.html').replace(/^\/+/, '');
  return `${DASHBOARD_BASE_URL}/${cleanPath}`;
}

export const VENDOR_DASHBOARD_URL = getDashboardUrl('DvendorProducts.html');
