/**
 * Web：将 B 站 CDN 直链转为同源网关代理地址，便于携带 Referer/Cookie 拉流。
 */
export function buildBiliCdnPlaybackUrl(streamBaseUrl) {
  if (!streamBaseUrl || typeof streamBaseUrl !== 'string') return ''
  const api = import.meta.env.VITE_NCM_API_URL || '/api'
  const base = api.endsWith('/') ? api.slice(0, -1) : api
  return `${base}/bili-cdn?u=${encodeURIComponent(streamBaseUrl)}`
}
