import pinia from '../store/pinia'
import { useUserStore } from '../store/userStore'

/** 与扫码登录后 OAuth 回调里整段 Cookie 一致，供 B 站 API（playurl 等）使用；仅 SESSDATA 往往不够 */
export const BILI_FULL_COOKIE_STORAGE_KEY = 'HydrogenBiliCookie'

export function isHydrogenWeb() {
  return import.meta.env.VITE_WEB === 'true' || import.meta.env.VITE_WEB === '1'
}

export function isVercelDeployment() {
  if (typeof window === 'undefined') return false
  const host = window.location?.hostname || ''
  return host.endsWith('.vercel.app') || import.meta.env.VERCEL === '1'
}

export function collectNeteaseCookiesForNas() {
  const map = {}
  if (typeof localStorage === 'undefined') return map
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i)
    if (!k || !k.startsWith('cookie:')) continue
    const name = k.slice('cookie:'.length)
    if (!/^MUSIC_|^__csrf|^ntes_/i.test(name)) continue
    const v = localStorage.getItem(k)
    if (v != null && v !== '') map[name] = v
  }
  return map
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
  const raw = String(cookieHeader || '').trim()
  if (!raw) {
    localStorage.removeItem('Sessdata')
    localStorage.removeItem(BILI_FULL_COOKIE_STORAGE_KEY)
    return
  }
  // 拒绝换行/NUL（header 注入）；分号是 cookie 分隔符，属合法
  if (/[\r\n\0]/.test(raw)) return
  const normalized = raw.endsWith(';') ? raw : `${raw};`
  localStorage.setItem(BILI_FULL_COOKIE_STORAGE_KEY, normalized)
  const sd = extractSessdataFromCookieHeader(normalized)
  if (sd && !/[;\r\n\0]/.test(sd)) localStorage.setItem('Sessdata', sd)
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

/**
 * B 站：写入 NAS 的配置
 * - sessdata：与旧版兼容，单独存 SESSDATA 值
 * - cookieHeader：完整 Cookie，恢复后 playurl / view 等与浏览器登录一致
 */
export function collectBiliForNas() {
  if (typeof localStorage === 'undefined') {
    return { sessdata: null, cookieHeader: null }
  }
  const v = localStorage.getItem('Sessdata')
  const full = localStorage.getItem(BILI_FULL_COOKIE_STORAGE_KEY)
  return {
    sessdata: v != null && v !== '' ? v : null,
    cookieHeader: full != null && full.trim() !== '' ? full.trim() : null,
  }
}

export function applyBiliFromNas(bili) {
  if (!bili || typeof bili !== 'object') {
    clearBiliStoredSession()
    return
  }
  const header =
    bili.cookieHeader != null && String(bili.cookieHeader).trim() !== ''
      ? String(bili.cookieHeader).trim()
      : null
  if (header) {
    persistFullBiliSessionCookieHeader(header)
    return
  }
  if (bili.sessdata != null && bili.sessdata !== '') {
    const s = String(bili.sessdata)
    // 拒绝属性/换行注入，避免写入被污染的 cookie
    if (/[;\r\n]/.test(s)) {
      clearBiliStoredSession()
      return
    }
    localStorage.setItem('Sessdata', s)
    localStorage.setItem(BILI_FULL_COOKIE_STORAGE_KEY, `SESSDATA=${s};`)
    return
  }
  clearBiliStoredSession()
}

export function applyNeteaseCookiesFromNas(map) {
  if (!map || typeof map !== 'object') return
  for (const [key, val] of Object.entries(map)) {
    // 仅允许网易云相关 cookie 键，拒绝任意键与 CRLF 注入
    if (!/^(MUSIC_|__csrf|ntes_)/i.test(key)) continue
    if (val == null || val === '') continue
    const v = String(val)
    if (/[;\r\n]/.test(key) || /[;\r\n]/.test(v)) continue
    localStorage.setItem(`cookie:${key}`, v)
    try {
      document.cookie = `${key}=${v}; path=/`
    } catch (_) {}
  }
}

export function buildWebProfilePayload() {
  const userStore = useUserStore(pinia)
  return {
    cookies: collectNeteaseCookiesForNas(),
    bili: collectBiliForNas(),
    user: {
      user: userStore.user,
      biliUser: userStore.biliUser,
      homePage: userStore.homePage,
      cloudDiskPage: userStore.cloudDiskPage,
      loginMode: userStore.loginMode,
      likelist: userStore.likelist,
    },
    updatedAt: Date.now(),
  }
}

export function applyWebProfileFromNas(data) {
  if (!data || typeof data !== 'object') return
  if (data.cookies) applyNeteaseCookiesFromNas(data.cookies)
  if (Object.prototype.hasOwnProperty.call(data, 'bili')) {
    applyBiliFromNas(data.bili || { sessdata: null })
  }
  if (data.user) {
    const userStore = useUserStore(pinia)
    userStore.$patch({
      user: data.user.user ?? null,
      biliUser: data.user.biliUser ?? null,
      homePage: data.user.homePage !== undefined ? data.user.homePage : userStore.homePage,
      cloudDiskPage: data.user.cloudDiskPage !== undefined ? data.user.cloudDiskPage : userStore.cloudDiskPage,
      loginMode: data.user.loginMode ?? null,
      likelist: data.user.likelist ?? null,
    })
  }
}

export async function pullWebProfileFromNas() {
  if (!isHydrogenWeb() || isVercelDeployment() || typeof windowApi.getWebProfile !== 'function') return
  const data = await windowApi.getWebProfile()
  applyWebProfileFromNas(data)
}

export async function pushWebProfileToNas() {
  if (!isHydrogenWeb() || isVercelDeployment() || typeof windowApi.setWebProfile !== 'function') return
  await windowApi.setWebProfile(buildWebProfilePayload())
}

export async function saveWebProfileIfSyncEnabled() {
  if (!isHydrogenWeb() || isVercelDeployment() || typeof windowApi.getSettings !== 'function') return
  const settings = await windowApi.getSettings()
  if (!settings?.local?.syncProfileToNas) return
  await pushWebProfileToNas()
}

export async function clearWebProfileOnNas() {
  if (!isHydrogenWeb() || isVercelDeployment() || typeof windowApi.clearWebProfile !== 'function') return
  await windowApi.clearWebProfile()
}
