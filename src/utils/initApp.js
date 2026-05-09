import pinia from '../store/pinia'
import { isLogin } from '../utils/authority'
import { loadLastSong } from './player'
import { scanMusic } from './locaMusic'
import { getUserProfile, getLikelist } from '../api/user'
import { useUserStore } from '../store/userStore'
import { usePlayerStore } from '../store/playerStore'
import { useLocalStore } from '../store/localStore'
import { storeToRefs } from 'pinia'
import { insertCustomFontStyle } from './setFont'
import { isHydrogenWeb } from './webProfileNas'

const userStore = useUserStore(pinia)
const playerStore = usePlayerStore()
const { quality, lyricSize, tlyricSize, rlyricSize, lyricInterludeTime } = storeToRefs(playerStore)
const localSotre = useLocalStore()
const { updateUser } = userStore

function applySettingsPayload(settings) {
    if (!settings) return
    quality.value = settings.music.level
    lyricSize.value = settings.music.lyricSize
    tlyricSize.value = settings.music.tlyricSize
    rlyricSize.value = settings.music.rlyricSize
    lyricInterludeTime.value = settings.music.lyricInterlude
    const m = settings.music || {}
    if (Object.prototype.hasOwnProperty.call(m, 'coverBlur')) playerStore.coverBlur = !!m.coverBlur
    if (Object.prototype.hasOwnProperty.call(m, 'lyricBlur')) playerStore.lyricBlur = !!m.lyricBlur
    if (Object.prototype.hasOwnProperty.call(m, 'musicVideo')) playerStore.musicVideo = !!m.musicVideo
    localSotre.downloadedFolderSettings = settings.local.downloadFolder
    localSotre.localFolderSettings = settings.local.localFolder
    localSotre.quitApp = settings.other.quitApp
    if (localSotre.downloadedFolderSettings && !localSotre.downloadedMusicFolder) {
        scanMusic({ type: 'downloaded', refresh: false })
    }
    if (localSotre.localFolderSettings.length != 0 && !localSotre.localMusicFolder) {
        scanMusic({ type: 'local', refresh: false })
    }
    if (!localSotre.downloadedFolderSettings && localSotre.downloadedMusicFolder) {
        localSotre.downloadedMusicFolder = null
        localSotre.downloadedFiles = null
        windowApi.clearLocalMusicData('downloaded')
    }
    if (localSotre.localFolderSettings.length == 0 && localSotre.localMusicFolder) {
        localSotre.localMusicFolder = null,
            localSotre.localMusicList = null
        localSotre.localMusicClassify = null
        windowApi.clearLocalMusicData('local')
    }
    insertCustomFontStyle(settings.other.customFont)
}

export const initSettings = async () => {
    const settings = await windowApi.getSettings()
    applySettingsPayload(settings)
    return settings
}

/**
 * Web：用户切回标签页后，重新拉取 settings.json。
 */
export async function refreshWebRemoteState() {
    if (!isHydrogenWeb()) return
    try {
        await initSettings()
        if (isLogin()) {
            const result = await getUserProfile()
            updateUser(result.profile)
            getUserLikelist()
        }
    } catch (e) {
        console.warn('[refreshWebRemoteState]', e)
    }
}

let webVisibilitySyncInstalled = false
function installWebVisibilitySync() {
    if (!isHydrogenWeb() || webVisibilitySyncInstalled || typeof document === 'undefined') return
    webVisibilitySyncInstalled = true
    let timer = null
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState !== 'visible') return
        if (timer) clearTimeout(timer)
        timer = setTimeout(() => {
            refreshWebRemoteState().catch((e) => console.warn('[web visibility sync]', e))
        }, 400)
    })
}
export const getUserLikelist = () => {
    if (userStore.user?.userId)
        getLikelist(userStore.user.userId).then(result => {
            userStore.likelist = result.ids
        })
    else {
        userStore.likelist = []
    }
}
//初始化
export const init = async () => {
    try {
        await initSettings()
    } catch (e) {
        console.warn('[init] 设置拉取失败', e)
    }
    loadLastSong()
    if (isLogin()) {
        getUserProfile().then((result) => {
            updateUser(result.profile)
            getUserLikelist()
        })
    }
    installWebVisibilitySync()
}