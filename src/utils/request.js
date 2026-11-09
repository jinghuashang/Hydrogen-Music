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
/** -460 风控自动重试的全局冷却：期间其它请求不再自动重试，避免重试风暴放大风控 */
const RISK_RETRY_COOLDOWN = 8000
let riskRetryAfter = 0
// 播放取址熔断：命中 -460 后一段时间内直接跳过 /song/url/v1，
// 避免连续切歌时每一首都先打一次接口、反复触发风控
const SONG_URL_BLOCK_MS = 8000
let songUrlBlockedUntil = 0
// 歌词接口串行化：一次歌单加载/连续切歌可能并发几十个 /lyric/new，
// 这是 -460 的主要触发源之一，这里按最小间隔排队放行
const LYRIC_MIN_INTERVAL = 250
let lyricGate = 0
// 音质降级链：风控对无损/高解析的阈值更严，命中 -460 时逐档降级重试
const LEVEL_FALLBACK = { lossless: 'exhigh', hires: 'exhigh', jymaster: 'exhigh', sky: 'exhigh', exhigh: 'standard' }

export function clearProxyCache() {}

// 请求拦截器
request.interceptors.request.use(async function (config) {
  // 初始化重试计数器
  config._retryCount = config._retryCount || 0

  // 歌词串行化：排队等待，避免瞬时并发打爆上游
  if (config.url === '/lyric/new') {
    const now = Date.now()
    const wait = Math.max(0, lyricGate - now)
    lyricGate = Math.max(now, lyricGate) + LYRIC_MIN_INTERVAL
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait))
  }

  // 熔断期内的取址请求直接拒绝，由调用方走"无法播放"提示
  if (config.url === '/song/url/v1' && Date.now() < songUrlBlockedUntil) {
    const blocked = new Error('risk-blocked')
    blocked._riskBlocked = true
    blocked.code = -460   // 供调用方识别：这是本地熔断，不是真的取不到地址
    return Promise.reject(blocked)
  }

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
  config.params = config.params || {}
  // 风控缓解（-460 网络环境存在风险）：上游据此不再把调用方私有 IP（127.0.0.1 / 内网地址）当 X-Real-IP 传给网易
  if (config.params.randomCNIP === undefined) config.params.randomCNIP = true
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

    // 判断是否需要重试：仅幂等的 GET/HEAD 重试，避免 POST（验证码发送、登录等）重复执行
    const method = (config.method || 'get').toLowerCase()
    // 网易云风控 -460（网络环境存在风险）：服务端已换 IP 重试一次，这里再兜一次（只兜一次，避免放大风控）
    const riskCode = error.response && error.response.data && error.response.data.code
    const isRiskControl = riskCode === -460
    if (isRiskControl && config.url === '/song/url/v1') {
      // 风控对高音质阈值更严：先尝试降一档音质，能拿到地址就继续播放
      // 逐档降级：lossless → exhigh → standard（每一步都允许重试一次，直到 standard）
      let curLevel = config.params?.level
      let step = config._levelStep || 0
      while (step < 3) {
        const nextLevel = LEVEL_FALLBACK[curLevel]
        if (!nextLevel) break
        step += 1
        config._levelStep = step
        config.params = { ...config.params, level: nextLevel }
        console.warn(`[request] -460 on /song/url/v1 (${curLevel}), 降级到 ${nextLevel} 重试`)
        try {
          return await request(config)
        } catch (e) {
          if (!(e && e.body && e.body.code === -460)) throw e
          curLevel = nextLevel
        }
      }
      // 已经是最低档仍被拦：熔断，避免连续请求放大风控
      songUrlBlockedUntil = Date.now() + SONG_URL_BLOCK_MS
      console.warn(`[request] -460 on /song/url/v1, blocked for ${SONG_URL_BLOCK_MS}ms`)
      if (!config.silent) noticeOpen('网易云风控：暂停取址 15 秒', 2)
      return Promise.reject(error)
    }
    if (isRiskControl && (method === 'get' || method === 'head') && !config._riskRetried && Date.now() >= riskRetryAfter) {
      config._riskRetried = true
      riskRetryAfter = Date.now() + RISK_RETRY_COOLDOWN
      if (!config.silent) noticeOpen('网易云风控：网络环境存在风险，正在重试', 2)
      console.log(`[request] Risk control -460 on ${config.url}, retrying once`)
      await new Promise(resolve => setTimeout(resolve, 1500))
      return request(config)
    }
    // 301/302 排查用：账号接口被重定向通常意味着 cookie 未生效，打出跳转目标便于定位
    if (error.response && error.response.status >= 300 && error.response.status < 400) {
      const location = error.response.headers?.location || '(no location)'
      console.warn(`[request] Redirect ${error.response.status} on ${config.url} -> ${location}`)
    }
    const shouldRetry = (!error.response || error.response.status >= 500) && (method === 'get' || method === 'head')
    if (shouldRetry && config._retryCount < MAX_RETRIES) {
      config._retryCount++
      // 指数退避，避免固定间隔重试放大服务端压力
      const delay = RETRY_DELAY * Math.pow(2, config._retryCount - 1)
      console.log(`[request] Retrying ${config.url} (${config._retryCount}/${MAX_RETRIES}) in ${delay}ms`)
      await new Promise(resolve => setTimeout(resolve, delay))
      return request(config)
    }

    // silent：可选增强请求（如云盘歌词、歌词补全）失败时由调用方自行降级，不打扰用户
    if (!config.silent) noticeOpen(isRiskControl ? '网易云风控：网络环境存在风险，请稍后再试' : '请求错误', 2)
    return Promise.reject(error);
});

export default request;
