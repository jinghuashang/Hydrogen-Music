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

let cachedProxy = null
let lastDisabledCheck = 0

async function getProxyUrl() {
    const now = Date.now()
    if (cachedProxy) return cachedProxy
    // Allow re-checking disabled state every 30 seconds to handle startup race
    if (cachedProxy === '' && now - lastDisabledCheck < 30000) return ''
    try {
        const status = await windowApi.getUnblockStatus()
        if (status) {
            const settings = await windowApi.getSettings()
            const portConfig = settings.unblock?.port || '36531:36532'
            cachedProxy = `http://localhost:${portConfig.split(':')[0]}`
        } else {
            cachedProxy = ''
            lastDisabledCheck = now
        }
    } catch(e) {
        cachedProxy = ''
        lastDisabledCheck = now
    }
    return cachedProxy
}

export function clearProxyCache() {
    cachedProxy = null
}

// 请求拦截器
request.interceptors.request.use(async function (config) {
  if (!cachedProxy) await getProxyUrl()
  if (cachedProxy) {
    config.params = config.params || {}
    config.params.proxy = cachedProxy
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