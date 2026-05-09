import axios from "axios";
import { isLogin, getNeteaseCookieStringForApi } from '../utils/authority'
import pinia from "../store/pinia";
import { useLibraryStore } from '../store/libraryStore'

const libraryStore = useLibraryStore(pinia)

import { noticeOpen } from "./dialog";

const ncmBase =
    import.meta.env.VITE_WEB === 'true' || import.meta.env.VITE_WEB === '1'
        ? '/ncm'
        : 'http://localhost:36530'

const request = axios.create({
    baseURL: ncmBase,
    withCredentials: true,
    timeout: 10000,
});

export function clearProxyCache() {}

// 请求拦截器
request.interceptors.request.use(async function (config) {
  // 解锁灰色歌曲：对 /song/url/v1 请求附加 unblock=true
  if (config.url === '/song/url/v1') {
    let unblockOn = true
    try {
      const settings = await windowApi.getSettings()
      if (settings?.unblock?.enabled === false) unblockOn = false
    } catch (_) {}
    if (unblockOn) {
      config.params = config.params || {}
      config.params.unblock = true
      config.timeout = 30000
    }
  }
  if (config.url != '/login/qr/check' && isLogin()) {
    const cookieStr = getNeteaseCookieStringForApi()
    if (cookieStr) config.params.cookie = cookieStr
  }
  if(libraryStore.needTimestamp.indexOf(config.url) != -1) {
    config.params.timestamp = new Date().getTime()
  }
    return config;
  }, function (error) {
    noticeOpen("发起请求错误", 2)
    return Promise.reject(error);
});

// 响应拦截器
request.interceptors.response.use(function (response) {
    return response.data
  }, function (error) {
    noticeOpen("请求错误", 2)
    return Promise.reject(error);
});

export default request;
