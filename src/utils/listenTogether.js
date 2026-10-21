/**
 * 一起听页面的纯工具函数（无 Vue / 网络依赖，便于单独验证）。
 */

export const LISTEN_TOGETHER_SHARE_BASE = 'https://st.music.163.com/listen-together/share/'

const ROOM_ID_RE = /^[A-Za-z0-9_-]{1,64}$/

function safeDecode(value) {
  if (value == null) return ''
  try {
    return decodeURIComponent(String(value))
  } catch (_) {
    return String(value)
  }
}

function readParam(text, name) {
  const re = new RegExp(`(?:[?&]|^)${name}=([^&#\\s]+)`, 'i')
  const m = text.match(re)
  return m ? safeDecode(m[1]) : ''
}

/**
 * 从邀请链接 / 纯房间号中解析出 { roomId, inviterId }。
 * 支持：
 * - https://st.music.163.com/listen-together/share/?roomId=...&inviterId=...
 * - roomId=...&inviterId=...
 * - 纯房间号
 * 解析失败返回 null。
 */
export function parseListenTogetherInput(raw) {
  const text = String(raw || '').trim()
  if (!text) return null

  let roomId = ''
  let inviterId = 0

  // 完整 URL 优先用 URL 解析（兼容 hash 中的 query）
  try {
    const url = new URL(text)
    roomId = url.searchParams.get('roomId') || ''
    inviterId = url.searchParams.get('inviterId') || 0
    if (!roomId && url.hash) {
      const hashQuery = url.hash.includes('?') ? url.hash.slice(url.hash.indexOf('?')) : ''
      roomId = readParam(hashQuery, 'roomId')
      inviterId = readParam(hashQuery, 'inviterId') || inviterId
    }
  } catch (_) {
    // 非完整 URL 时走下面的文本解析
  }

  if (!roomId) roomId = readParam(text, 'roomId')
  if (!inviterId) inviterId = readParam(text, 'inviterId')

  // 纯房间号
  if (!roomId && /^[A-Za-z0-9_-]{3,64}$/.test(text)) roomId = text

  roomId = safeDecode(roomId).trim()
  if (!ROOM_ID_RE.test(roomId)) return null

  const inviter = Number(inviterId)
  return {
    roomId,
    inviterId: Number.isFinite(inviter) && inviter > 0 ? inviter : 0,
  }
}

/**
 * 生成一起听邀请链接。songId 仅用于接收方落地页展示，可省略。
 */
export function buildListenTogetherShareLink({ roomId, inviterId, songId } = {}) {
  if (!roomId) return ''
  const params = new URLSearchParams()
  if (songId) params.set('songId', String(songId))
  params.set('roomId', String(roomId))
  if (inviterId) params.set('inviterId', String(inviterId))
  return `${LISTEN_TOGETHER_SHARE_BASE}?${params.toString()}`
}

/**
 * 播放器 store 的 0-3 模式映射到网易云一起听协议：
 * 0 顺序 / 1 列表循环 -> ORDER_LOOP
 * 2 单曲循环 -> SINGLE_LOOP
 * 3 随机 -> RANDOM
 */
export function toListenPlayMode(mode) {
  const n = Number(mode)
  if (n === 2) return 'SINGLE_LOOP'
  if (n === 3) return 'RANDOM'
  return 'ORDER_LOOP'
}

/**
 * 将 API 返回的 id 列表（数组 / 逗号字符串 / {result: []}）归一化为数字数组。
 * 保持原顺序，不静默去重（共享队列允许重复歌曲）。
 */
export function normalizeListenIdList(value) {
  let raw = value
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) raw = raw.result
  if (typeof raw === 'string') raw = raw.split(',')
  if (!Array.isArray(raw)) return []
  const out = []
  for (const item of raw) {
    const id = Number(item)
    if (Number.isFinite(id) && id > 0) out.push(id)
  }
  return out
}

/** 播放状态归一化：协议只认 PLAY / PAUSE，STOP 按暂停处理 */
export function normalizeListenPlayStatus(value) {
  const status = String(value || '').toUpperCase()
  return status === 'PLAY' ? 'PLAY' : 'PAUSE'
}

/** 毫秒进度 -> 秒，容忍上游偶尔返回秒 */
export function listenProgressToSeconds(progress, durationSeconds = 0) {
  const n = Number(progress)
  if (!Number.isFinite(n) || n <= 0) return 0
  // 一起听协议固定毫秒；若数值明显小于时长（且时长 > 1000 秒）则视为秒
  if (n < 1000 && durationSeconds > 1000) return n
  return n / 1000
}
