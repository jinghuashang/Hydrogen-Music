import axios from "axios";
import { isLogin, getNeteaseCookieStringForApi } from '../utils/authority'
import pinia from "../store/pinia";
import { useLibraryStore } from '../store/libraryStore'
import { usePlayerStore } from '../store/playerStore'

const libraryStore = useLibraryStore(pinia)
const playerStore = usePlayerStore(pinia)

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

// 重试配置
const MAX_RETRIES = 3
const RETRY_DELAY = 1000

export function clearProxyCache() {}

// 请求拦截器
request.interceptors.request.use(async function (config) {
  // 初始化重试计数器
  config._retryCount = config._retryCount || 0

  // 解锁灰色歌曲：对 /song/url/v1 请求附加 unblock=true 和歌曲元数据
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
      // 附带歌曲元数据供解灰源匹配（绕过网易云被版权方下架后 API 返回 name:null）
      try {
        const list = playerStore.songList
        if (list && list.length) {
          const song = list[playerStore.currentIndex]
          if (song && song.name) {
            config.params.unblock_name = song.name
            if (song.ar && song.ar.length) {
              config.params.unblock_artist = song.ar.map(a => a.name).join('/')
            }
            if (song.al && song.al.name) {
              config.params.unblock_album = song.al.name
            }
            if (song.dt) {
              config.params.unblock_duration = song.dt
            }
          }
        }
      } catch (_) {}
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

// 响应拦截器（带重试逻辑）
request.interceptors.response.use(function (response) {
    return response.data
  }, async function (error) {
    const config = error.config
    if (!config) {
      noticeOpen("请求错误", 2)
      return Promise.reject(error)
    }

    // 判断是否需要重试（网络错误或服务器错误）
    const shouldRetry = !error.response || error.response.status >= 500
    if (shouldRetry && config._retryCount < MAX_RETRIES) {
      config._retryCount++
      console.log(`[request] Retrying ${config.url} (${config._retryCount}/${MAX_RETRIES})`)
      await new Promise(resolve => setTimeout(resolve, RETRY_DELAY))
      return request(config)
    }

    noticeOpen("请求错误", 2)
    return Promise.reject(error);
});

export default request;
