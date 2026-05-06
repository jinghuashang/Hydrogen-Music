import Cookies from "js-cookie";

export function setCookies(data, type) {
  if(type == 'account') {
    const cookies = data.cookie.split(';;')
    cookies.map(cookie => {
      document.cookie = cookie;
      const temCookie = cookie.split(';')[0].split('=');
      localStorage.setItem('cookie:' + temCookie[0], temCookie[1])
    });
  }
  if(type == 'qr') {
    const cookies = data.cookie.split(';')
    const qrCookieNames = ['MUSIC_U', 'MUSIC_A_T', 'MUSIC_R_T', '__csrf', 'ntes_kaola_ad', 'MUSIC_R_T_AG', 'MUSIC_A_T_AG']
    cookies.map(cookie => {
      const temCookie = cookie.split('=');
      if(qrCookieNames.includes(temCookie[0].trim())) {
        document.cookie = cookie.trim();
        localStorage.setItem('cookie:' + temCookie[0].trim(), temCookie[1])
      }
    });
  }
}

//获取Cookie
export function getCookie(key) {
  return Cookies.get(key) ?? localStorage.getItem('cookie:' + key)
}

//判断是否登录
export function isLogin() {
  return (getCookie('MUSIC_U') != undefined)
}

/** 网易云个性化接口常用的 Cookie 键（账号 / 扫码登录均可能写入） */
const NETEASE_API_COOKIE_KEYS = [
  'MUSIC_U',
  'MUSIC_A_T',
  'MUSIC_R_T',
  '__csrf',
  'ntes_kaola_ad',
  'MUSIC_R_T_AG',
  'MUSIC_A_T_AG',
]

/**
 * 拼接传给 NeteaseCloudMusicApi 的 cookie 字符串。
 * 仅传 MUSIC_U 时，部分「首页 / 推荐」接口无法正确按账号个性化。
 */
export function getNeteaseCookieStringForApi() {
  if (!isLogin()) return ''
  const parts = []
  const seen = new Set()
  for (const key of NETEASE_API_COOKIE_KEYS) {
    const val = getCookie(key)
    if (val != null && val !== '') {
      parts.push(`${key}=${val}`)
      seen.add(key)
    }
  }
  if (typeof localStorage !== 'undefined') {
    for (let i = 0; i < localStorage.length; i++) {
      const fullKey = localStorage.key(i)
      if (!fullKey || !fullKey.startsWith('cookie:')) continue
      const name = fullKey.slice('cookie:'.length)
      if (!/^MUSIC_|^__csrf|^ntes_/i.test(name) || seen.has(name)) continue
      const val = localStorage.getItem(fullKey)
      if (val != null && val !== '') {
        parts.push(`${name}=${val}`)
        seen.add(name)
      }
    }
  }
  return parts.join('; ')
}