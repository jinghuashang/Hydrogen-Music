/** 与扫码登录后 OAuth 回调里整段 Cookie 一致，供 B 站 API（playurl 等）使用；仅 SESSDATA 往往不够 */
export const BILI_FULL_COOKIE_STORAGE_KEY = 'HydrogenBiliCookie'

export function isHydrogenWeb() {
  return import.meta.env.VITE_WEB === 'true' || import.meta.env.VITE_WEB === '1'
}

function extractSessdataFromCookieHeader(header) {
  if (!header || typeof header !== 'string') return null
  const m = header.match(/(?:^|;\s*)SESSDATA=([^;]+)/i)
  if (!m) return null
  try {
    return decodeURIComponent(m[1].trim())
  } catch {
    return m[1].trim()
  }
}

/** 写入扫码登录得到的完整 Cookie 串（含 bili_jct、DedeUserID 等），并同步 Sessdata 供旧逻辑使用 */
export function persistFullBiliSessionCookieHeader(cookieHeader) {
  if (typeof localStorage === 'undefined') return
  const raw = (cookieHeader || '').trim()
  if (!raw) {
    localStorage.removeItem('Sessdata')
    localStorage.removeItem(BILI_FULL_COOKIE_STORAGE_KEY)
    return
  }
  const normalized = raw.endsWith(';') ? raw : `${raw};`
  localStorage.setItem(BILI_FULL_COOKIE_STORAGE_KEY, normalized)
  const sd = extractSessdataFromCookieHeader(normalized)
  if (sd) localStorage.setItem('Sessdata', sd)
}

export function clearBiliStoredSession() {
  if (typeof localStorage === 'undefined') return
  localStorage.removeItem('Sessdata')
  localStorage.removeItem(BILI_FULL_COOKIE_STORAGE_KEY)
}

/** 发给 B 站网关请求的 Cookie 头（优先完整串，否则仅 SESSDATA） */
export function getBiliCookieForApi() {
  if (typeof localStorage === 'undefined') return ''
  const full = localStorage.getItem(BILI_FULL_COOKIE_STORAGE_KEY)
  if (full && full.trim()) {
    const t = full.trim()
    return t.endsWith(';') ? t : `${t};`
  }
  const sd = localStorage.getItem('Sessdata')
  if (sd != null && sd !== '') return `SESSDATA=${sd};`
  return ''
}

export function hasBiliSessionInStorage() {
  return !!getBiliCookieForApi().trim()
}
