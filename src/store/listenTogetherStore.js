import { defineStore } from 'pinia'
import { watch } from 'vue'
import {
  acceptListenInvitation,
  checkListenRoom,
  createListenRoom,
  endListenRoom,
  getListenRoomPlaylist,
  getListenTogetherStatus,
  leaveListenRoom,
  sendListenHeartbeat,
  sendListenPlayCommand,
  syncListenPlaylist,
} from '../api/listenTogether'
import { getSongsDetail } from '../api/song'
import { noticeOpen } from '../utils/dialog'
import {
  listenProgressToSeconds,
  normalizeListenIdList,
  normalizeListenPlayStatus,
  toListenPlayMode,
} from '../utils/listenTogether'
import { usePlayerStore } from './playerStore'
import { useUserStore } from './userStore'
import { addToList, addSong, changeProgress, pauseMusic, startMusic } from '../utils/player'

const POLL_INTERVAL = 3000
const HEARTBEAT_INTERVAL = 30000
/** 应用远端状态期间，忽略本地 watcher 的上报 */
const LOCAL_GRACE_MS = 1800
/** 进度漂移超过 3 秒才硬 seek，避免每 3 秒轮询都抖动 */
const SEEK_DRIFT_SECONDS = 3
/** 网易云 song/detail 单次最多 1000 首，按 200 分片更稳 */
const SONG_DETAIL_CHUNK = 200
const LEFT_ROOM_KEY = 'hydrogen:listenTogether:leftRoom'

let pollTimer = null
let heartbeatTimer = null
let modeTimer = null
let applyingTimer = null
let pollInFlight = false
let watchers = []
let progressSample = { value: 0, at: 0, songId: 0 }
let lastSeekReportAt = 0
let suppressPlayReportUntil = 0
/** 最近一次已处理的一起听 playCommand 签名（同一命令在轮询中会重复返回） */
let lastRemoteCommandSignature = ''
/** 房主房间列表为空时的自动补发节流 */
let nextAutoPublishAt = 0

function readLeftRoomMarker() {
  try {
    return localStorage.getItem(LEFT_ROOM_KEY) || ''
  } catch (_) {
    return ''
  }
}

function writeLeftRoomMarker(roomId) {
  try {
    if (roomId) localStorage.setItem(LEFT_ROOM_KEY, String(roomId))
    else localStorage.removeItem(LEFT_ROOM_KEY)
  } catch (_) {}
}

function clearLeftRoomMarker() {
  writeLeftRoomMarker('')
}

export const useListenTogetherStore = defineStore('listenTogetherStore', {
  state: () => ({
    inRoom: false,
    roomId: null,
    creatorId: 0,
    /** none | host | guest */
    role: 'none',
    users: [],
    connected: false,
    recovering: false,
    creating: false,
    joining: false,
    leaving: false,
    syncing: false,
    /** 正在把远端快照写入播放器（页面用于展示同步中状态） */
    applyingRemote: false,
    /** 本端上报命令的单调序号 */
    clientSeq: 0,
    /** 房间共享列表的歌曲 id（顺序与房间一致） */
    playlistIds: [],
    lastSyncAt: 0,
    lastReportedSongId: 0,
    lastError: '',
    /** 应用远端状态期间的本地上报忽略窗口 */
    ignoreLocalUntil: 0,
  }),

  actions: {
    _userId() {
      const userStore = useUserStore()
      return Number(userStore.user?.userId || 0)
    },

    _currentSong() {
      const playerStore = usePlayerStore()
      return playerStore.songList?.[playerStore.currentIndex] || null
    },

    _isHostUser() {
      const uid = this._userId()
      if (!uid) return this.role === 'host'
      return Number(this.creatorId) === uid
    },

    _setApplying(value, duration = 0) {
      this.applyingRemote = !!value
      clearTimeout(applyingTimer)
      if (value && duration > 0) {
        applyingTimer = setTimeout(() => {
          this.applyingRemote = false
        }, duration)
      }
    },

    _applyRoomInfo(info) {
      if (!info || typeof info !== 'object') return
      if (info.roomId) this.roomId = String(info.roomId)
      if (info.creatorId) {
        this.creatorId = Number(info.creatorId)
      }
      if (Array.isArray(info.roomUsers)) this.users = info.roomUsers
      if (this.creatorId) {
        this.role = this._isHostUser() ? 'host' : 'guest'
      }
    },

    _resetRemoteCommandState() {
      lastRemoteCommandSignature = ''
      nextAutoPublishAt = 0
    },

    _commandSignature(cmd) {
      return [
        cmd?.clientSeq ?? '',
        cmd?.userId ?? '',
        cmd?.commandType ?? '',
        cmd?.targetSongId ?? '',
        cmd?.progress ?? '',
        cmd?.playStatus ?? '',
      ].join('|')
    },

    /**
     * 用 /sync/playlist/get 返回的 playCommand 驱动远端同步。
     * 不能依赖 /status：官方 status 只提供房间/另一台设备信息，不提供当前播放快照。
     */
    async _applyPlayCommand(cmd, { force = false } = {}) {
      if (!cmd || typeof cmd !== 'object') return false
      const signature = this._commandSignature(cmd)
      if (!force && signature === lastRemoteCommandSignature) return false
      lastRemoteCommandSignature = signature

      // 自己发出的命令已经在本机执行过，不能回灌成“远端命令”
      const senderId = Number(cmd.userId || 0)
      if (senderId && senderId === this._userId()) return false

      const remoteId = Number(cmd.targetSongId || 0)
      if (!remoteId) return false
      const status = normalizeListenPlayStatus(cmd.playStatus)
      const type = String(cmd.commandType || '').toUpperCase()
      const playerStore = usePlayerStore()
      let index = (playerStore.songList || []).findIndex(
        (song) => Number(song.id) === remoteId,
      )

      if (index === -1) {
        await this.reloadRoomPlaylist()
        index = (playerStore.songList || []).findIndex(
          (song) => Number(song.id) === remoteId,
        )
      }
      if (index === -1) {
        const songs = await this._fetchSongs([remoteId])
        const song = songs[0]
        if (!song) return false
        this._setApplying(true, LOCAL_GRACE_MS)
        this.ignoreLocalUntil = Date.now() + LOCAL_GRACE_MS
        playerStore.songList = [...(playerStore.songList || []), song]
        index = playerStore.songList.length - 1
      }

      const currentId = Number(playerStore.songId)
      const song = playerStore.songList[index]
      const durationSeconds = Number(song?.dt || 0) / 1000
      // serverSeq 是命令的服务端毫秒时间戳：PLAY 状态下按已流逝时间外推，
      // 避免新成员加入时从“命令发出那一刻”的旧进度开始。
      const issuedAt = Number(cmd.serverSeq) || 0
      const elapsedMs =
        status === 'PLAY' && issuedAt > 0 ? Math.max(0, Date.now() - issuedAt) : 0
      const effectiveMs = Math.min(
        (Number(cmd.progress) || 0) + elapsedMs,
        Number(song?.dt || 0) || Number.MAX_SAFE_INTEGER,
      )
      const seconds = listenProgressToSeconds(effectiveMs, durationSeconds)

      if (currentId !== remoteId) {
        this._setApplying(true, LOCAL_GRACE_MS)
        this.ignoreLocalUntil = Date.now() + LOCAL_GRACE_MS + 400
        progressSample = { value: 0, at: Date.now(), songId: remoteId }
        addSong(remoteId, index, status === 'PLAY')
        if (seconds > 0.5) this._seekWhenReady(seconds)
        return true
      }

      if (status === 'PLAY' && !playerStore.playing) {
        this._setApplying(true, LOCAL_GRACE_MS)
        this.ignoreLocalUntil = Date.now() + LOCAL_GRACE_MS
        if (playerStore.currentMusic) startMusic()
        else addSong(remoteId, index, true)
      } else if (status === 'PAUSE' && playerStore.playing) {
        this._setApplying(true, LOCAL_GRACE_MS)
        this.ignoreLocalUntil = Date.now() + LOCAL_GRACE_MS
        pauseMusic()
      }

      const forceSeek = force || type === 'GOTO' || type === 'SEEK'
      if (
        seconds > 0.5 &&
        (forceSeek ||
          Math.abs(Number(playerStore.progress || 0) - seconds) > SEEK_DRIFT_SECONDS)
      ) {
        this._setApplying(true, LOCAL_GRACE_MS)
        this.ignoreLocalUntil = Date.now() + LOCAL_GRACE_MS
        progressSample = { value: seconds, at: Date.now(), songId: remoteId }
        changeProgress(seconds)
      }
      return true
    },

    /** 用 /sync/playlist/get 的 playlist 数据更新共享队列 */
    async _applySharedPlaylistData(playlist) {
      if (!this.roomId) return []
      const ids = normalizeListenIdList(playlist?.displayList?.result)
      this.playlistIds = ids
      if (!ids.length) return []

      const playerStore = usePlayerStore()
      const currentIds = (playerStore.songList || []).map((song) => Number(song.id))
      const same =
        currentIds.length === ids.length &&
        currentIds.every((id, index) => id === ids[index])
      if (same) return playerStore.songList || []

      const songs = await this._fetchSongs(ids)
      if (!songs.length) return []
      this._setApplying(true, LOCAL_GRACE_MS)
      this.ignoreLocalUntil = Date.now() + LOCAL_GRACE_MS
      addToList('listentogether', songs, this.roomId)
      return songs
    },

    /** 房主房间列表为空（创建时上报失败/重进页面）时自动补发一次 */
    async _ensureHostPlaylistPublished() {
      if (!this.inRoom || !this.roomId || !this._isHostUser()) return false
      if (this.playlistIds.length) return false
      if (Date.now() < nextAutoPublishAt) return false
      const playerStore = usePlayerStore()
      const hasShareable = (playerStore.songList || []).some(
        (song) => song && song.id && song.type !== 'local',
      )
      if (!hasShareable) return false
      nextAutoPublishAt = Date.now() + 10000
      const ok = await this.syncPlaylistToRoom('REPLACE', { notify: false })
      if (ok) {
        const song = this._currentSong()
        if (song?.id) {
          await this.sendPlayCommand('GOTO', {
            progressMs: Math.round((playerStore.progress || 0) * 1000),
            formerSongId: '-1',
          })
        }
      }
      return ok
    },

    /** 每轮轮询拉取共享队列 + 最新 playCommand */
    async pollRoomPlayback() {
      if (!this.inRoom || !this.roomId) return
      try {
        const res = await getListenRoomPlaylist(this.roomId, { silent: true })
        if (res?.code !== 200) return
        await this._applySharedPlaylistData(res.data?.playlist)
        await this._applyPlayCommand(res.data?.playCommand)
        await this._ensureHostPlaylistPublished()
      } catch (_) {}
    },

    // ---------------------------------------------------------------- 房间生命周期

    async createRoom() {
      if (!this._userId()) {
        noticeOpen('请先登录', 2)
        return false
      }
      if (this.creating) return false
      const playerStore = usePlayerStore()
      this.creating = true
      this.lastError = ''
      try {
        const res = await createListenRoom({ silent: true })
        const info = res?.data?.roomInfo
        if (res?.code !== 200 || !info?.roomId) {
          throw new Error(res?.message || res?.msg || '创建房间失败')
        }

        this.inRoom = true
        this.roomId = String(info.roomId)
        this.creatorId = Number(info.creatorId || this._userId())
        this.role = 'host'
        this.users = Array.isArray(info.roomUsers) ? info.roomUsers : []
        this.connected = true
        this.clientSeq = 0
        this.lastReportedSongId = Number(playerStore.songId || 0)
        this._resetRemoteCommandState()
        clearLeftRoomMarker()

        const shareable = (playerStore.songList || []).some(
          (song) => song && song.id && song.type !== 'local',
        )
        if (shareable) {
          await this.syncPlaylistToRoom('REPLACE', { notify: false })
          await this.sendPlayCommand('GOTO', {
            progressMs: Math.round((playerStore.progress || 0) * 1000),
            formerSongId: '-1',
          })
        }

        this.startSync()
        this.lastSyncAt = Date.now()
        noticeOpen('一起听房间已创建', 2)
        return true
      } catch (err) {
        this.lastError = err?.message || '创建房间失败'
        noticeOpen(this.lastError, 2)
        return false
      } finally {
        this.creating = false
      }
    },

    async joinRoom({ roomId, inviterId = 0 } = {}) {
      if (!this._userId()) {
        noticeOpen('请先登录', 2)
        return false
      }
      if (!roomId || this.joining) return false
      this.joining = true
      this.lastError = ''
      try {
        const check = await checkListenRoom(roomId, { silent: true })
        if (check?.code !== 200) {
          throw new Error(check?.message || check?.msg || '房间不存在或已过期')
        }
        if (check.data?.joinable === false) {
          throw new Error(check.data?.copywriting || '房间当前不可加入')
        }
        const hostId = Number(
          check.data?.hostUserId || check.data?.creatorId || inviterId || 0,
        )
        if (!hostId) throw new Error('无法确认房主，请粘贴完整邀请链接')

        const accept = await acceptListenInvitation(roomId, hostId, { silent: true })
        if (accept?.code !== 200) {
          throw new Error(accept?.message || accept?.msg || '加入房间失败')
        }

        const joinedRoomId = String(accept.data?.roomId || roomId)
        this.roomId = joinedRoomId
        this.creatorId = hostId
        this.role = this._isHostUser() ? 'host' : 'guest'
        this.inRoom = true
        this.connected = true
        this.clientSeq = 0
        this.users = []
        clearLeftRoomMarker()

        // 加入后以 status 为准补全成员与远端播放快照
        const status = await getListenTogetherStatus({ silent: true })
        if (status?.code === 200 && status.data?.inRoom) {
          this._applyRoomInfo(status.data.roomInfo || status.data)
          if (status.data.roomInfo?.creatorId) {
            this.creatorId = Number(status.data.roomInfo.creatorId)
            this.role = this._isHostUser() ? 'host' : 'guest'
          }
        }

        this._resetRemoteCommandState()
        const playlistRes = await getListenRoomPlaylist(this.roomId, { silent: true })
        if (playlistRes?.code === 200) {
          await this._applySharedPlaylistData(playlistRes.data?.playlist)
          await this._applyPlayCommand(playlistRes.data?.playCommand, { force: true })
        } else {
          await this.reloadRoomPlaylist()
        }
        await this._ensureHostPlaylistPublished()
        this.startSync()
        this.lastSyncAt = Date.now()
        noticeOpen('已加入一起听房间', 2)
        return true
      } catch (err) {
        this.lastError = err?.message || '加入房间失败'
        noticeOpen(this.lastError, 2)
        if (!this.inRoom) this.resetRoom()
        return false
      } finally {
        this.joining = false
      }
    },

    /**
     * 应用启动 / 页面重新激活时恢复账号已有房间。
     * 注意：若用户刚主动退出（本地 marker），不自动拉回。
     */
    async recoverRoom() {
      if (this.recovering) return false
      if (this.inRoom) {
        this.ensureSync()
        return true
      }
      this.recovering = true
      try {
        const res = await getListenTogetherStatus({ silent: true })
        if (!(res?.code === 200 && res.data?.inRoom)) {
          this.resetRoom()
          return false
        }
        const info = res.data.roomInfo || res.data || {}
        const roomId = String(info.roomId || res.data.roomId || this.roomId || '')
        if (!roomId) {
          this.resetRoom()
          return false
        }
        if (readLeftRoomMarker() === roomId) {
          this.resetRoom()
          return false
        }

        this.inRoom = true
        this.roomId = roomId
        this.creatorId = Number(info.creatorId || res.data.creatorId || this.creatorId || 0)
        this.users = Array.isArray(info.roomUsers) ? info.roomUsers : this.users
        this.role = this.creatorId ? (this._isHostUser() ? 'host' : 'guest') : this.role
        this.clientSeq = 0
        this._resetRemoteCommandState()

        const playlistRes = await getListenRoomPlaylist(this.roomId, { silent: true })
        if (playlistRes?.code === 200) {
          await this._applySharedPlaylistData(playlistRes.data?.playlist)
          await this._applyPlayCommand(playlistRes.data?.playCommand, { force: true })
        } else {
          await this.reloadRoomPlaylist()
        }
        await this._ensureHostPlaylistPublished()
        this.startSync()
        this.lastSyncAt = Date.now()
        this.connected = true
        noticeOpen('已恢复一起听房间', 2)
        return true
      } catch (_) {
        return false
      } finally {
        this.recovering = false
      }
    },

    async leaveRoom() {
      if (!this.roomId) {
        this.resetRoom()
        return
      }
      if (this.leaving) return
      const roomId = this.roomId
      const wasHost = this._isHostUser()
      this.leaving = true
      try {
        if (wasHost) {
          const res = await endListenRoom(roomId, { silent: true })
          if (res?.code !== 200) {
            noticeOpen('结束房间失败，已在本地退出', 2)
          }
          writeLeftRoomMarker(roomId)
        } else {
          try {
            const res = await leaveListenRoom(roomId, { silent: true })
            if (res?.code !== 200) writeLeftRoomMarker(roomId)
          } catch (_) {
            // Web 端上游若没有 leave 模块，退化为仅清理本地状态
            writeLeftRoomMarker(roomId)
          }
        }
      } finally {
        this.resetRoom()
        this.leaving = false
        noticeOpen(wasHost ? '已结束一起听房间' : '已退出一起听房间', 2)
      }
    },

    resetRoom() {
      this.stopSync()
      this.inRoom = false
      this.roomId = null
      this.creatorId = 0
      this.role = 'none'
      this.users = []
      this.connected = false
      this.clientSeq = 0
      this.playlistIds = []
      this.lastSyncAt = 0
      this.lastReportedSongId = 0
      this.lastError = ''
      this.ignoreLocalUntil = 0
      this._resetRemoteCommandState()
      this._setApplying(false)
    },

    // ---------------------------------------------------------------- 轮询与心跳

    ensureSync() {
      if (!this.inRoom) return
      if (!pollTimer) this.startPolling()
      if (!heartbeatTimer) this.startHeartbeat()
      if (!watchers.length) this.attachWatchers()
    },

    startSync() {
      this.ensureSync()
    },

    stopSync() {
      this.stopPolling()
      this.stopHeartbeat()
      this.detachWatchers()
      clearTimeout(modeTimer)
      modeTimer = null
    },

    startPolling() {
      this.stopPolling()
      this.pollStatus()
      pollTimer = setInterval(() => this.pollStatus(), POLL_INTERVAL)
    },

    stopPolling() {
      if (pollTimer) {
        clearInterval(pollTimer)
        pollTimer = null
      }
    },

    startHeartbeat() {
      this.stopHeartbeat()
      this.sendHeartbeat()
      heartbeatTimer = setInterval(() => this.sendHeartbeat(), HEARTBEAT_INTERVAL)
    },

    stopHeartbeat() {
      if (heartbeatTimer) {
        clearInterval(heartbeatTimer)
        heartbeatTimer = null
      }
    },

    async pollStatus() {
      if (!this.inRoom || !this.roomId || pollInFlight) return
      pollInFlight = true
      try {
        const res = await getListenTogetherStatus({ silent: true })
        if (!(res?.code === 200 && res.data)) {
          this.connected = false
          return
        }
        if (!res.data.inRoom) {
          this.connected = false
          if (this.inRoom) noticeOpen('一起听房间已结束', 2)
          this.resetRoom()
          return
        }

        this.connected = true
        this.lastSyncAt = Date.now()
        this._applyRoomInfo(res.data.roomInfo || res.data)
        // 官方 status 不含当前歌曲/进度；播放同步以 /sync/playlist/get 的 playCommand 为准
        await this.pollRoomPlayback()
      } catch (_) {
        this.connected = false
      } finally {
        pollInFlight = false
      }
    },

    sendHeartbeat() {
      if (!this.inRoom || !this.roomId) return
      const song = this._currentSong()
      if (!song?.id) return
      const playerStore = usePlayerStore()
      sendListenHeartbeat(
        {
          roomId: this.roomId,
          songId: Number(song.id),
          playStatus: playerStore.playing ? 'PLAY' : 'PAUSE',
          progress: Math.max(0, Math.round((playerStore.progress || 0) * 1000)),
        },
        { silent: true },
      )
        .then((res) => {
          if (res?.code === 200) {
            this.connected = true
          }
        })
        .catch(() => {})
    },

    // ---------------------------------------------------------------- 播放命令与列表同步

    async sendPlayCommand(commandType, { progressMs, formerSongId } = {}) {
      if (!this.inRoom || !this.roomId) return false
      const playerStore = usePlayerStore()
      const song = this._currentSong()
      if (!song?.id) return false

      const targetSongId = Number(song.id)
      const progress = Number.isFinite(Number(progressMs))
        ? Math.max(0, Math.round(Number(progressMs)))
        : Math.max(0, Math.round((playerStore.progress || 0) * 1000))
      const former =
        formerSongId != null
          ? String(formerSongId)
          : commandType === 'GOTO'
            ? String(this.lastReportedSongId || '-1')
            : '-1'

      const playStatus = playerStore.playing ? 'PLAY' : 'PAUSE'
      try {
        const res = await sendListenPlayCommand(
          {
            roomId: this.roomId,
            progress,
            commandType,
            formerSongId: former,
            targetSongId,
            clientSeq: ++this.clientSeq,
            playStatus,
          },
          { silent: true },
        )
        if (res?.code === 200) {
          this.lastReportedSongId = targetSongId
          return true
        }
      } catch (_) {}
      return false
    },

    reportSeek(seconds) {
      if (!this.inRoom || this.applyingRemote) return
      const value = Math.max(0, Number(seconds) || 0)
      lastSeekReportAt = Date.now()
      progressSample = {
        value,
        at: Date.now(),
        songId: Number(this._currentSong()?.id || 0),
      }
      this.sendPlayCommand('seek', { progressMs: Math.round(value * 1000) })
    },

    playRoomSong(index) {
      const playerStore = usePlayerStore()
      const song = playerStore.songList?.[index]
      if (!song) return
      addSong(song.id, index, true)
    },

    async syncPlaylistToRoom(commandType = 'REPLACE', { notify = true } = {}) {
      if (!this.inRoom || !this.roomId) return false
      const playerStore = usePlayerStore()
      const list = (playerStore.songList || []).filter(
        (song) => song && song.id && song.type !== 'local',
      )
      const ids = normalizeListenIdList(list.map((song) => song.id))
      if (!ids.length) {
        if (notify) noticeOpen('当前播放列表没有可共享的歌曲', 2)
        return false
      }

      const randomSource =
        playerStore.playMode === 3 && playerStore.shuffledList?.length
          ? playerStore.shuffledList
          : list
      const randomIds = normalizeListenIdList(randomSource.map((song) => song.id))

      this.syncing = true
      try {
        const res = await syncListenPlaylist(
          {
            roomId: this.roomId,
            commandType,
            userId: this._userId(),
            version: ++this.clientSeq,
            playMode: toListenPlayMode(playerStore.playMode),
            displayList: ids.join(','),
            randomList: (randomIds.length ? randomIds : ids).join(','),
          },
          { silent: true },
        )
        if (res?.code === 200) {
          this.playlistIds = ids
          this.lastSyncAt = Date.now()
          if (notify) noticeOpen('已同步当前播放列表', 2)
          return true
        }
        if (notify) noticeOpen(res?.message || res?.msg || '同步播放列表失败', 2)
        return false
      } catch (_) {
        if (notify) noticeOpen('同步播放列表失败', 2)
        return false
      } finally {
        this.syncing = false
      }
    },

    async reloadRoomPlaylist() {
      if (!this.roomId) return []
      try {
        const res = await getListenRoomPlaylist(this.roomId, { silent: true })
        if (res?.code !== 200) return []
        const ids = normalizeListenIdList(res.data?.playlist?.displayList?.result)
        this.playlistIds = ids
        if (!ids.length) return []

        const songs = await this._fetchSongs(ids)
        if (!songs.length) return []

        const playerStore = usePlayerStore()
        const currentIds = (playerStore.songList || []).map((song) => Number(song.id))
        const same =
          currentIds.length === ids.length &&
          currentIds.every((id, index) => id === ids[index])
        if (!same) {
          this._setApplying(true, LOCAL_GRACE_MS)
          this.ignoreLocalUntil = Date.now() + LOCAL_GRACE_MS
          addToList('listentogether', songs, this.roomId)
        }
        return songs
      } catch (_) {
        return []
      }
    },

    async _fetchSongs(ids) {
      const chunks = []
      for (let i = 0; i < ids.length; i += SONG_DETAIL_CHUNK) {
        chunks.push(ids.slice(i, i + SONG_DETAIL_CHUNK))
      }
      const results = await Promise.all(
        chunks.map((chunk) =>
          getSongsDetail(chunk, { silent: true }).catch(() => null),
        ),
      )
      const map = new Map()
      for (const res of results) {
        for (const song of res?.songs || []) {
          if (song?.id) map.set(Number(song.id), song)
        }
      }
      return ids.map((id) => map.get(id)).filter(Boolean)
    },

    _seekWhenReady(seconds) {
      const target = Math.max(0, Number(seconds) || 0)
      if (!target) return
      let tries = 0
      let timer = null
      const tick = () => {
        if (!this.inRoom) {
          clearInterval(timer)
          return
        }
        const playerStore = usePlayerStore()
        const howl = playerStore.currentMusic
        if (howl && (howl.state() === 'loaded' || howl.state() === 'playing')) {
          clearInterval(timer)
          changeProgress(target)
          return
        }
        tries += 1
        if (tries >= 200) {
          clearInterval(timer)
          changeProgress(target)
        }
      }
      timer = setInterval(tick, 150)
      tick()
    },

    async resync() {
      if (!this.inRoom || !this.roomId) return false
      if (this.syncing) return false
      this.syncing = true
      try {
        const res = await getListenTogetherStatus({ silent: true })
        if (res?.code === 200 && res.data?.inRoom) {
          this._applyRoomInfo(res.data.roomInfo || res.data)
          this._resetRemoteCommandState()
          const playlistRes = await getListenRoomPlaylist(this.roomId, { silent: true })
          if (playlistRes?.code === 200) {
            await this._applySharedPlaylistData(playlistRes.data?.playlist)
            await this._applyPlayCommand(playlistRes.data?.playCommand, { force: true })
          } else {
            await this.reloadRoomPlaylist()
          }
          await this._ensureHostPlaylistPublished()
          this.connected = true
          this.lastSyncAt = Date.now()
          noticeOpen('已重新同步房间状态', 2)
          return true
        }
        if (res?.code === 200 && !res.data?.inRoom) {
          noticeOpen('房间已结束', 2)
          this.resetRoom()
          return false
        }
        noticeOpen('重新同步失败', 2)
        return false
      } catch (_) {
        noticeOpen('重新同步失败', 2)
        return false
      } finally {
        this.syncing = false
      }
    },

    // ---------------------------------------------------------------- 本地播放器 watcher

    attachWatchers() {
      this.detachWatchers()
      const playerStore = usePlayerStore()
      const store = this
      // 进入房间时播放器可能已经播到一半：先对齐采样基准，避免首个进度事件被误判为拖动
      progressSample = {
        value: Number(playerStore.progress || 0),
        at: Date.now(),
        songId: Number(playerStore.songId || 0),
      }
      watchers = [
        watch(
          () => playerStore.songId,
          (id, oldId) => {
            progressSample = {
              value: Number(playerStore.progress || 0),
              at: Date.now(),
              songId: Number(id || 0),
            }
            store._onLocalSongChange(id, oldId)
          },
        ),
        watch(
          () => playerStore.playing,
          (playing) => store._onLocalPlayChange(playing),
        ),
        watch(
          () => playerStore.progress,
          (progress) => store._onLocalProgressChange(progress),
        ),
        watch(
          () => playerStore.playMode,
          () => store._onLocalPlayModeChange(),
        ),
      ]
    },

    detachWatchers() {
      for (const stop of watchers) {
        try {
          stop()
        } catch (_) {}
      }
      watchers = []
    },

    async _onLocalSongChange(id, oldId) {
      if (!this.inRoom || this.applyingRemote || Date.now() < this.ignoreLocalUntil) return
      if (!id) return
      const song = this._currentSong()
      if (!song || song.type === 'local') return

      this.ignoreLocalUntil = Date.now() + LOCAL_GRACE_MS
      suppressPlayReportUntil = Date.now() + LOCAL_GRACE_MS
      const numericId = Number(id)

      // 用户从房间外选歌：先把当前列表同步进房间，否则远端无法定位目标歌曲
      if (!this.playlistIds.includes(numericId)) {
        await this.syncPlaylistToRoom('REPLACE', { notify: false })
      }

      await this.sendPlayCommand('GOTO', {
        progressMs: 0,
        formerSongId: this.lastReportedSongId || (oldId ? Number(oldId) : '-1'),
      })
      this.sendHeartbeat()
    },

    _onLocalPlayChange(playing) {
      if (!this.inRoom || this.applyingRemote) return
      if (Date.now() < this.ignoreLocalUntil || Date.now() < suppressPlayReportUntil) return
      if (!this._currentSong()?.id) return
      this.sendPlayCommand(playing ? 'PLAY' : 'PAUSE')
    },

    _onLocalProgressChange(progress) {
      const now = Date.now()
      const playerStore = usePlayerStore()
      const songId = Number(playerStore.songId || 0)
      if (!this.inRoom || this.applyingRemote || now < this.ignoreLocalUntil) {
        progressSample = { value: Number(progress || 0), at: now, songId }
        return
      }

      const sameSong = progressSample.songId === songId
      const elapsed = sameSong ? Math.max(0, (now - progressSample.at) / 1000) : 0
      const expected = progressSample.value + (playerStore.playing ? elapsed : 0)
      const jumped = Math.abs(Number(progress || 0) - expected) > SEEK_DRIFT_SECONDS
      progressSample = { value: Number(progress || 0), at: now, songId }

      if (!jumped) return
      if (Date.now() < lastSeekReportAt + 1200) return
      if (!this._currentSong()?.id) return
      this.reportSeek(Number(progress || 0))
    },

    _onLocalPlayModeChange() {
      if (!this.inRoom || this.applyingRemote) return
      clearTimeout(modeTimer)
      modeTimer = setTimeout(() => {
        if (this.inRoom && !this.applyingRemote) {
          this.syncPlaylistToRoom('PLAYMODE_CHANGE', { notify: false })
        }
      }, 500)
    },
  },

  persist: {
    storage: localStorage,
    pick: ['roomId', 'creatorId', 'role', 'users'],
  },
})
