export function isRemoteMediaUrl(value) {
  const url = String(value || '').trim();
  return /^https?:\/\//i.test(url) || url.startsWith('data:') || url.startsWith('blob:');
}

export function resolveMediaUrl(value, imageBasePath = './') {
  const url = String(value || '').trim();
  if (!url) return '';
  if (isRemoteMediaUrl(url)) return url;

  const cleanName = url.split('/').pop();
  return cleanName ? `${imageBasePath}${cleanName}` : '';
}
