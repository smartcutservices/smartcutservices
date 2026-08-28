export function cleanText(value, maxLength = 5000) {
  return String(value ?? '').replace(/\u0000/g, '').trim().slice(0, maxLength);
}

export function parseLines(value, maxItems = 20) {
  return cleanText(value, 12000).split('\n').map((item) => item.trim()).filter(Boolean).slice(0, maxItems);
}

export function clampNumber(value, min, max, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
}
