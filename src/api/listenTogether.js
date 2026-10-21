import request from '../utils/request'

/**
 * 一起听（Listen Together）接口封装。
 *
 * 注意：上游 API 模块的心跳路由拼写是 `/listentogether/heatbeat`（历史拼写），
 * 不是 `/heartbeat`；调用错误路由会直接 404。
 */

/** 获取当前账号的一起听状态（是否在房间、房间成员、远端播放快照） */
export function getListenTogetherStatus(options = {}) {
  return request({
    url: '/listentogether/status',
    method: 'get',
    params: {
      timestamp: Date.now(),
    },
    ...options,
  })
}

/** 创建双人一起听房间 */
export function createListenRoom(options = {}) {
  return request({
    url: '/listentogether/room/create',
    method: 'get',
    params: {
      timestamp: Date.now(),
    },
    ...options,
  })
}

/** 检查房间是否存在 / 是否还能加入，同时返回房主 userId */
export function checkListenRoom(roomId, options = {}) {
  return request({
    url: '/listentogether/room/check',
    method: 'post',
    data: {
      roomId,
    },
    ...options,
  })
}

/** 接受邀请加入房间（inviterId 可由 room/check 的 hostUserId 补全） */
export function acceptListenInvitation(roomId, inviterId, options = {}) {
  return request({
    url: '/listentogether/accept',
    method: 'post',
    data: {
      roomId,
      inviterId,
    },
    ...options,
  })
}

/** 获取房间共享播放列表（displayList.result 为歌曲 id 数组） */
export function getListenRoomPlaylist(roomId, options = {}) {
  return request({
    url: '/listentogether/sync/playlist/get',
    method: 'post',
    data: {
      roomId,
    },
    ...options,
  })
}

/**
 * 上报播放命令。
 * commandType: PLAY / PAUSE / GOTO / seek
 * progress: 毫秒
 */
export function sendListenPlayCommand(params, options = {}) {
  return request({
    url: '/listentogether/play/command',
    method: 'post',
    data: {
      roomId: params.roomId,
      progress: params.progress,
      commandType: params.commandType,
      formerSongId: params.formerSongId,
      targetSongId: params.targetSongId,
      clientSeq: params.clientSeq,
      playStatus: params.playStatus,
    },
    ...options,
  })
}

/**
 * 上报共享播放列表 / 播放模式。
 * displayList、randomList 传逗号分隔字符串（上游模块会再 split）。
 */
export function syncListenPlaylist(params, options = {}) {
  return request({
    url: '/listentogether/sync/list/command',
    method: 'post',
    data: {
      roomId: params.roomId,
      commandType: params.commandType,
      userId: params.userId,
      version: params.version,
      playMode: params.playMode,
      displayList: params.displayList,
      randomList: params.randomList,
    },
    ...options,
  })
}

/** 30 秒一次的心跳，维持房间 CONNECTED 状态并携带最新播放快照 */
export function sendListenHeartbeat(params, options = {}) {
  const data = {
    roomId: params.roomId,
    songId: params.songId,
    playStatus: params.playStatus,
    progress: params.progress,
  }
  const send = (url) =>
    request({
      url,
      method: 'post',
      data,
      ...options,
    })
  // api-enhanced 的历史路由拼写为 heatbeat；部分部署已修正为 heartbeat
  return send('/listentogether/heatbeat')
    .then((res) => {
      if (res?.code === 404) return send('/listentogether/heartbeat')
      return res
    })
    .catch(() => send('/listentogether/heartbeat'))
}

/** 房主结束房间（解散） */
export function endListenRoom(roomId, options = {}) {
  return request({
    url: '/listentogether/end',
    method: 'post',
    data: {
      roomId,
    },
    ...options,
  })
}

/**
 * 房客退出房间。
 * 上游 api-enhanced 未内置该模块，Electron 端由自定义模块补齐；
 * Web 端若上游 404，调用方会降级为仅清理本地房间状态。
 */
export function leaveListenRoom(roomId, options = {}) {
  return request({
    url: '/listentogether/leave',
    method: 'post',
    data: {
      roomId,
    },
    ...options,
  })
}
