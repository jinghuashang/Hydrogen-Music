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