import { db } from './firebase-init.js';
import { doc, getDoc } from 'https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore.js';

const DEFAULT_SETTINGS = {
  htgPerUsd: 132,
  defaultDisplayCurrency: 'HTG'
};

let cachedSettings = { ...DEFAULT_SETTINGS };
let settingsPromise = null;
const USER_CURRENCY_KEY = 'smartcut_display_currency';

function toNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

export async function loadCurrencySettings({ force = false } = {}) {
  if (settingsPromise && !force) return settingsPromise;

  settingsPromise = (async () => {
    try {
      const snapshot = await getDoc(doc(db, 'settings', 'currency'));
      if (snapshot.exists()) {
        const data = snapshot.data() || {};
        cachedSettings = {
          htgPerUsd: Math.max(1, toNumber(data.htgPerUsd, DEFAULT_SETTINGS.htgPerUsd)),
          defaultDisplayCurrency: normalizeCurrency(data.defaultDisplayCurrency || DEFAULT_SETTINGS.defaultDisplayCurrency)
        };
      }
    } catch (error) {
      console.warn('Parametres devise indisponibles, fallback local utilise:', error);
      cachedSettings = { ...DEFAULT_SETTINGS };
    }
    return cachedSettings;
  })();

  return settingsPromise;
}

export function getCurrencySettings() {
  return cachedSettings;
}

export function normalizeCurrency(value) {
  const currency = String(value || '').trim().toUpperCase();
  return currency === 'USD' ? 'USD' : 'HTG';
}

export function getUserDisplayCurrency() {
  try {
    const stored = localStorage.getItem(USER_CURRENCY_KEY);
    if (stored) return normalizeCurrency(stored);
  } catch (_) {
    // Local storage can be unavailable in private/strict contexts.
  }
  return normalizeCurrency(cachedSettings.defaultDisplayCurrency);
}

export function setUserDisplayCurrency(value) {
  const currency = normalizeCurrency(value);
  try {
    localStorage.setItem(USER_CURRENCY_KEY, currency);
  } catch (_) {
    // Ignore storage errors; current page can still use the selected value after reload.
  }
  window.dispatchEvent(new CustomEvent('smartcut:currency-changed', {
    detail: { currency }
  }));
  return currency;
}

export function formatPriceHTG(value, options = {}) {
  return new Intl.NumberFormat('fr-HT', {
    style: 'currency',
    currency: 'HTG',
    minimumFractionDigits: options.minimumFractionDigits ?? 0,
    maximumFractionDigits: options.maximumFractionDigits ?? 0
  }).format(toNumber(value, 0));
}

export function formatPriceUSD(value, options = {}) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: options.minimumFractionDigits ?? 2,
    maximumFractionDigits: options.maximumFractionDigits ?? 2
  }).format(toNumber(value, 0));
}

export function formatPriceDual(value, options = {}) {
  const amount = toNumber(value, 0);
  const settings = getCurrencySettings();
  const selectedCurrency = normalizeCurrency(options.currency || getUserDisplayCurrency());

  if (selectedCurrency === 'USD') {
    const usd = amount / Math.max(1, toNumber(settings.htgPerUsd, DEFAULT_SETTINGS.htgPerUsd));
    return formatPriceUSD(usd, options);
  }

  return formatPriceHTG(amount, options);
}

loadCurrencySettings();
