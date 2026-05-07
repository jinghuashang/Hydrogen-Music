import pinia from '../store/pinia'
import { useUserStore } from '../store/userStore'

export function isHydrogenWeb() {
  return import.meta.env.VITE_WEB === 'true' || import.meta.env.VITE_WEB === '1'
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

/** B 站：与 MusicVideo 中 localStorage「Sessdata」一致，用于请求 playurl 等 */
export function collectBiliForNas() {
  if (typeof localStorage === 'undefined') return { sessdata: null }
  const v = localStorage.getItem('Sessdata')
  return { sessdata: v != null && v !== '' ? v : null }
}

export function applyBiliFromNas(bili) {
  if (!bili || typeof bili !== 'object') return
  if (bili.sessdata != null && bili.sessdata !== '') {
    localStorage.setItem('Sessdata', String(bili.sessdata))
  } else {
    localStorage.removeItem('Sessdata')
  }
}

export function applyNeteaseCookiesFromNas(map) {
  if (!map || typeof map !== 'object') return
  for (const [key, val] of Object.entries(map)) {
    if (val == null || val === '') continue
    localStorage.setItem(`cookie:${key}`, String(val))
    try {
      document.cookie = `${key}=${String(val)}; path=/`
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
  if (!isHydrogenWeb() || typeof windowApi.getWebProfile !== 'function') return
  const data = await windowApi.getWebProfile()
  applyWebProfileFromNas(data)
}

export async function pushWebProfileToNas() {
  if (!isHydrogenWeb() || typeof windowApi.setWebProfile !== 'function') return
  await windowApi.setWebProfile(buildWebProfilePayload())
}

export async function saveWebProfileIfSyncEnabled() {
  if (!isHydrogenWeb() || typeof windowApi.getSettings !== 'function') return
  const settings = await windowApi.getSettings()
  if (!settings?.local?.syncProfileToNas) return
  await pushWebProfileToNas()
}

export async function clearWebProfileOnNas() {
  if (!isHydrogenWeb() || typeof windowApi.clearWebProfile !== 'function') return
  await windowApi.clearWebProfile()
}
