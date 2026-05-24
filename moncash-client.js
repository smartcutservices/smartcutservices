const PROJECT_ID = 'smartcutservices-9ce54';
const REGION = 'us-central1';
const FUNCTION_BASE_URL = `https://${REGION}-${PROJECT_ID}.cloudfunctions.net`;

function sanitizeMoncashClientMessage(message) {
  const rawMessage = String(message || '').trim();
  const lowerMessage = rawMessage.toLowerCase();
  const technicalMarkers = [
    'jpa entitymanager',
    'jdbcconnectionexception',
    'jdbc connection',
    'hibernate',
    'org.hibernate',
    'nested exception',
    'stack trace',
    'exception:'
  ];

  if (!rawMessage || technicalMarkers.some(marker => lowerMessage.includes(marker))) {
    return 'MonCash est temporairement indisponible. Votre paiement n a pas ete lance. Veuillez reessayer dans quelques minutes.';
  }

  if (rawMessage.length > 180) {
    return 'Impossible de demarrer le paiement MonCash pour le moment. Veuillez reessayer dans quelques minutes.';
  }

  return rawMessage;
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    headers: {
      Accept: 'application/json',
      ...(options.body ? { 'Content-Type': 'application/json' } : {})
    },
    ...options
  });

  const text = await response.text();
  let payload = {};
  try {
    payload = text ? JSON.parse(text) : {};
  } catch (_) {
    payload = { raw: text };
  }

  if (!response.ok || payload?.ok === false) {
    const error = new Error(sanitizeMoncashClientMessage(payload?.message || payload?.error || 'MonCash request failed'));
    error.payload = payload;
    throw error;
  }

  return payload;
}

export async function createMoncashPaymentSession(payload) {
  return requestJson(`${FUNCTION_BASE_URL}/createMoncashPayment`, {
    method: 'POST',
    body: JSON.stringify(payload)
  });
}

export async function getMoncashPaymentStatus(reference) {
  const url = new URL(`${FUNCTION_BASE_URL}/getMoncashPaymentStatus`);

  if (typeof reference === 'string') {
    url.searchParams.set('session_id', reference);
  } else if (reference && typeof reference === 'object') {
    if (reference.sessionId) {
      url.searchParams.set('session_id', reference.sessionId);
    }
    if (reference.orderId) {
      url.searchParams.set('order_id', reference.orderId);
    }
    if (reference.transactionId) {
      url.searchParams.set('transaction_id', reference.transactionId);
    }
  }

  return requestJson(url.toString(), { method: 'GET' });
}

export function getMoncashReturnUrl() {
  return new URL('/moncash/return', window.location.origin).toString();
}
