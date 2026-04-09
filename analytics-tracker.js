const FUNCTION_BASE_URL = 'https://us-central1-smartcutservices-9ce54.cloudfunctions.net';
const TRACK_URL = `${FUNCTION_BASE_URL}/trackWebsiteVisit`;
const VISITOR_KEY = 'smartcut_analytics_visitor_id';
const SESSION_KEY = 'smartcut_analytics_session_id';
const LAST_CART_COUNT_KEY = 'smartcut_analytics_last_cart_count';

function createId(prefix = 'scs') {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
}

function safeStorage(storage, key, fallback = '') {
  try {
    return storage.getItem(key) || fallback;
  } catch (_) {
    return fallback;
  }
}

function setSafeStorage(storage, key, value) {
  try {
    storage.setItem(key, value);
  } catch (_) {
    // ignore storage errors
  }
}

function getVisitorId() {
  let visitorId = safeStorage(localStorage, VISITOR_KEY);
  if (!visitorId) {
    visitorId = createId('visitor');
    setSafeStorage(localStorage, VISITOR_KEY, visitorId);
  }
  return visitorId;
}

function getSessionId() {
  let sessionId = safeStorage(sessionStorage, SESSION_KEY);
  if (!sessionId) {
    sessionId = createId('session');
    setSafeStorage(sessionStorage, SESSION_KEY, sessionId);
  }
  return sessionId;
}

function getRegionHint(language = '') {
  const locale = String(language || '').trim();
  const match = locale.match(/-([A-Za-z]{2})$/);
  return match ? match[1].toUpperCase() : '';
}

function classifySource(referrer = '', url = window.location.href) {
  const current = new URL(url, window.location.origin);
  const utmSource = String(current.searchParams.get('utm_source') || '').trim();
  if (utmSource) return utmSource.toLowerCase();

  const ref = String(referrer || document.referrer || '').trim();
  if (!ref) return 'direct';

  try {
    const host = new URL(ref).hostname.toLowerCase();
    if (host.includes('google')) return 'google';
    if (host.includes('facebook') || host.includes('fb.')) return 'facebook';
    if (host.includes('instagram')) return 'instagram';
    if (host.includes('whatsapp')) return 'whatsapp';
    if (host.includes('tiktok')) return 'tiktok';
    if (host.includes('youtube')) return 'youtube';
    if (host.includes('bing')) return 'bing';
    if (host.includes('mail')) return 'email';
    return host.replace(/^www\./, '');
  } catch (_) {
    return 'referral';
  }
}

function detectDeviceType() {
  const ua = navigator.userAgent || '';
  const width = window.innerWidth || 0;
  if (/iPad|Tablet|PlayBook|Silk/i.test(ua)) return 'tablet';
  if (/Mobi|Android|iPhone|iPod/i.test(ua)) return width >= 768 ? 'tablet' : 'mobile';
  return 'desktop';
}

function detectBrowser() {
  const ua = navigator.userAgent || '';
  if (/Edg\//.test(ua)) return 'Edge';
  if (/OPR\//.test(ua) || /Opera/.test(ua)) return 'Opera';
  if (/Chrome\//.test(ua) && !/Edg\//.test(ua)) return 'Chrome';
  if (/Safari\//.test(ua) && !/Chrome\//.test(ua)) return 'Safari';
  if (/Firefox\//.test(ua)) return 'Firefox';
  if (/MSIE|Trident\//.test(ua)) return 'Internet Explorer';
  return 'Autre';
}

function detectOs() {
  const ua = navigator.userAgent || '';
  if (/Windows/i.test(ua)) return 'Windows';
  if (/Android/i.test(ua)) return 'Android';
  if (/iPhone|iPad|iPod/i.test(ua)) return 'iOS';
  if (/Mac OS X|Macintosh/i.test(ua)) return 'macOS';
  if (/Linux/i.test(ua)) return 'Linux';
  return 'Autre';
}

function buildPayload(eventName = 'page_view', extra = {}) {
  const language = String(navigator.language || '').trim();
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
  return {
    eventName,
    visitorId: getVisitorId(),
    sessionId: getSessionId(),
    pagePath: `${window.location.pathname}${window.location.search}`,
    pageTitle: document.title || '',
    referrer: document.referrer || '',
    source: classifySource(document.referrer || ''),
    deviceType: detectDeviceType(),
    browser: detectBrowser(),
    os: detectOs(),
    language,
    languages: Array.isArray(navigator.languages) ? navigator.languages.slice(0, 5) : [language].filter(Boolean),
    timeZone,
    regionHint: getRegionHint(language),
    viewport: `${window.innerWidth || 0}x${window.innerHeight || 0}`,
    screen: `${window.screen?.width || 0}x${window.screen?.height || 0}`,
    userAgent: navigator.userAgent || '',
    ...extra
  };
}

async function sendAnalytics(payload) {
  try {
    await fetch(TRACK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload),
      keepalive: true,
      mode: 'cors'
    });
  } catch (error) {
    console.warn('Analytics tracking error:', error);
  }
}

class WebsiteAnalyticsTracker {
  constructor() {
    this.booted = false;
    this.lastTrackedPath = '';
    this.lastCartCount = Number(safeStorage(sessionStorage, LAST_CART_COUNT_KEY, '0')) || 0;
  }

  async trackPageView() {
    const pagePath = `${window.location.pathname}${window.location.search}`;
    if (this.lastTrackedPath === pagePath) return;
    this.lastTrackedPath = pagePath;
    await sendAnalytics(buildPayload('page_view'));
  }

  async track(eventName, extra = {}) {
    await sendAnalytics(buildPayload(eventName, extra));
  }

  handleCartUpdated = (event) => {
    const nextCount = Number(event?.detail?.count ?? 0) || 0;
    if (nextCount > this.lastCartCount) {
      this.track('add_to_cart', { cartCount: nextCount });
    }
    this.lastCartCount = nextCount;
    setSafeStorage(sessionStorage, LAST_CART_COUNT_KEY, String(nextCount));
  };

  handleCheckout = (event) => {
    const total = Number(event?.detail?.total ?? 0) || 0;
    this.track('begin_checkout', { checkoutTotal: total });
  };

  handleArticleOpen = (event) => {
    this.track('open_article', { articleId: String(event?.detail?.articleId || '').trim() });
  };

  init() {
    if (this.booted) return;
    this.booted = true;
    this.trackPageView();
    document.addEventListener('cartUpdated', this.handleCartUpdated);
    document.addEventListener('openCheckout', this.handleCheckout);
    document.addEventListener('openArticle', this.handleArticleOpen);
  }
}

let analyticsTrackerInstance = null;

export function getWebsiteAnalyticsTracker() {
  if (!analyticsTrackerInstance) {
    analyticsTrackerInstance = new WebsiteAnalyticsTracker();
  }
  return analyticsTrackerInstance;
}

