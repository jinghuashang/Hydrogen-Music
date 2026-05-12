<script setup>
import { ref, onActivated, onMounted } from 'vue'
import { onBeforeRouteLeave, useRouter } from 'vue-router';
import { logout } from '../api/user'
import { noticeOpen, dialogOpen } from "../utils/dialog";
import { initSettings } from '../utils/initApp';
import { getVipInfo } from '../api/user'
import { isLogin } from '../utils/authority';
import { useUserStore } from '../store/userStore';
import { usePlayerStore } from '../store/playerStore';
import { useOtherStore } from '../store/otherStore';
import { insertCustomFontStyle } from '../utils/setFont';
import { normalizeLocalDirPath, localDirPathEquals } from '../utils/localPath'
import {
    isHydrogenWeb,
    isVercelDeployment,
    saveWebProfileIfSyncEnabled,
    clearWebProfileOnNas,
} from '../utils/webProfileNas'
import Selector from '../components/Selector.vue'

const isWebClient = isHydrogenWeb()

const router = useRouter()
const userStore = useUserStore()
const playerStore = usePlayerStore()
const otherStore = useOtherStore()

const vipInfo = ref(null)
const musicLevel = ref('standard')
const searchResultLimit = ref(10)
const musicLevelOptions = ref([
    {
        label: '标准',
        value: 'standard'
    },
    {
        label: '较高',
        value: 'higher'
    },
    {
        label: '极高',
        value: 'exhigh'
    },
    {
        label: '无损',
        value: 'lossless'
    },
    {
        label: 'Hi-Res',
        value: 'hires'
    },
])
const lyricSize = ref(20)
const tlyricSize = ref(13)
const rlyricSize = ref(12)
const lyricInterlude = ref(13)
const globalShortcuts = ref(false)
const quitApp = ref('minimize')
const quitAppOptions = ref([
    {
        label: '最小化至托盘',
        value: 'minimize'
    },
    {
        label: '直接退出',
        value: 'quit'
    }
])
const downloadFolder = ref(null)
const videoFolder = ref(null)
const localFolder = ref([])
const shortcutsList = ref(null)
const selectedShortcut = ref(null)
const newShortcut = ref([])
const shortcutCharacter = ['=', '-', '~', '@', '#', '$', '[', ']', ';', "'", ',', '.', '/', '!'];
const customFont = ref('')
const updateProxy = ref('')
const appVersion = ref('')
const isCheckingUpdate = ref(false)
const unblockEnabled = ref(false)
/** Web：宽屏首页右侧分栏播放器（写入 settings.other，默认关） */
const webHomeSidePlayer = ref(false)
const syncProfileToNas = ref(false)
const downloadCover = ref(false)
const downloadInfo = ref(false)
const downloadLyric = ref(false)
const showNasSync = isWebClient && !isVercelDeployment()
/** 渲染进程用于文案：Linux/Web 下目录选择器或路径习惯与 Windows 不同 */
const isLinuxLikePath =
    typeof navigator !== 'undefined' &&
    /\b(Linux|X11|Wayland)\b/i.test(
        `${navigator.userAgent} ${navigator.platform || ''}`,
    )

if (isLogin()) {
    getVipInfo().then(result => {
        vipInfo.value = result.data
    })
}
onMounted(async () => {
    appVersion.value = await windowApi.getAppVersion()
})
onActivated(() => {
    windowApi.getSettings().then(settings => {
        if (!settings) return
        musicLevel.value = settings.music.level
        searchResultLimit.value = settings.music.searchResultLimit || 10
        lyricSize.value = settings.music.lyricSize
        tlyricSize.value = settings.music.tlyricSize
        rlyricSize.value = settings.music.rlyricSize
        lyricInterlude.value = settings.music.lyricInterlude
        videoFolder.value = normalizeLocalDirPath(settings.local.videoFolder)
        downloadFolder.value = normalizeLocalDirPath(settings.local.downloadFolder)
        localFolder.value = Array.isArray(settings.local.localFolder)
            ? settings.local.localFolder
                  .map((x) => normalizeLocalDirPath(x))
                  .filter(Boolean)
            : []
        shortcutsList.value = settings.shortcuts
        globalShortcuts.value = settings.other.globalShortcuts
        quitApp.value = settings.other.quitApp
        customFont.value = settings.other.customFont
        updateProxy.value = settings.other.updateProxy || ''
        if(settings.unblock) {
            unblockEnabled.value = settings.unblock.enabled
        }
        if (settings.other && Object.prototype.hasOwnProperty.call(settings.other, 'webHomeSidePlayer')) {
            webHomeSidePlayer.value = !!settings.other.webHomeSidePlayer
        } else {
            webHomeSidePlayer.value = false
        }
        playerStore.webHomeSidePlayer = webHomeSidePlayer.value
        syncProfileToNas.value = !!settings.local?.syncProfileToNas
        downloadCover.value = !!settings.local?.downloadCover
        downloadInfo.value = !!settings.local?.downloadInfo
        downloadLyric.value = !!settings.local?.downloadLyric
        const m = settings.music || {}
        if (Object.prototype.hasOwnProperty.call(m, 'coverBlur')) playerStore.coverBlur = !!m.coverBlur
        if (Object.prototype.hasOwnProperty.call(m, 'lyricBlur')) playerStore.lyricBlur = !!m.lyricBlur
        if (Object.prototype.hasOwnProperty.call(m, 'musicVideo')) playerStore.musicVideo = !!m.musicVideo
    })
})

const setAppSettings = async () => {
    let settings = {
        music: {
            level: musicLevel.value,
            searchResultLimit: searchResultLimit.value,
            lyricSize: lyricSize.value,
            tlyricSize: tlyricSize.value,
            rlyricSize: rlyricSize.value,
            lyricInterlude: lyricInterlude.value,
            coverBlur: playerStore.coverBlur,
            lyricBlur: playerStore.lyricBlur,
            musicVideo: playerStore.musicVideo,
        },
        local: {
            videoFolder: videoFolder.value,
            downloadFolder: downloadFolder.value,
            localFolder: localFolder.value,
            syncProfileToNas: syncProfileToNas.value,
            downloadCover: downloadCover.value,
            downloadInfo: downloadInfo.value,
            downloadLyric: downloadLyric.value,
        },
        shortcuts: shortcutsList.value,
        other: {
            globalShortcuts: globalShortcuts.value,
            quitApp: quitApp.value,
            customFont: customFont.value,
            updateProxy: updateProxy.value,
            webHomeSidePlayer: webHomeSidePlayer.value,
        },
        unblock: {
            enabled: unblockEnabled.value,
        },
    }
    const sent = windowApi.setSettings(JSON.stringify(settings))
    if (sent && typeof sent.then === 'function') await sent
}

/** Web：将当前表单写入网关 settings.json 并回灌 Pinia，便于多浏览器立即一致 */
const persistWebSettingsFromForm = async () => {
    if (!isWebClient) return
    try {
        await setAppSettings()
        await initSettings()
    } catch (_) {}
}

onBeforeRouteLeave((to, from, next) => {
    next()
    noticeOpen("设置已保存", 2)
    const withTimeout = (p, ms = 3000) =>
        Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))])
    withTimeout(setAppSettings())
        .then(() => withTimeout(initSettings()))
        .then(() => {
            if (isWebClient && syncProfileToNas.value) {
                return saveWebProfileIfSyncEnabled()
            }
        })
        .catch(e => console.warn('[Settings] 离开设置页保存失败', e))
})

const routerChange = () => {
    if (window.history.length > 1) {
        router.back()
    } else {
        router.push('/')
    }
}

function applyLocalFolderPath(type, raw) {
    const p = normalizeLocalDirPath(raw)
    if (!p) return
    if (type === 'download') downloadFolder.value = p
    else if (type === 'video') videoFolder.value = p
    else if (type === 'local') {
        if (!localFolder.value.some((x) => localDirPathEquals(x, p))) localFolder.value.push(p)
    }
    if (isWebClient) void persistWebSettingsFromForm()
}

const selectFolder = (type) => {
    windowApi.openFile().then((picked) => {
        if (picked) applyLocalFolderPath(type, picked)
    })
}

/** Linux/Wayland 或无法弹出系统选目录时，可粘贴绝对路径（与 Web 版行为一致） */
const manualInputFolder = (type) => {
    const def =
        type === 'download'
            ? downloadFolder.value || ''
            : type === 'video'
              ? videoFolder.value || ''
              : ''
    const hint = isLinuxLikePath
        ? '请输入绝对路径（示例：/home/用户名/Music 或 /mnt/nas/music）'
        : '请输入绝对路径（Windows 示例：D:\\\\Music；也可复制资源管理器地址栏路径）'
    const v = window.prompt(hint, def || '')
    if (v) applyLocalFolderPath(type, v)
}
const deleteLocalFolder = (index) => {
    localFolder.value.splice(index, 1)
    if (isWebClient) void persistWebSettingsFromForm()
}

const formatShortcutName = (name) => {
    return name.replaceAll('+', ' + ').replace('Up', '↑').replace('Down', '↓').replace('Right', '→').replace('Left', '←').replace('Space', '空格').replace('Numpad', '').replace('num', '').replace('CommandOrControl', 'Ctrl').replace('Control', 'Ctrl');
}
const changeShortcut = (id, type) => {
    selectedShortcut.value = {
        id: id,
        type: type
    }
    windowApi.unregisterShortcuts()
}
/**
 * author: yesplaymusic
 */
const updateShortcut = () => {
    let shortcut = [];
    newShortcut.value.map(e => {
        if (e.keyCode >= 65 && e.keyCode <= 90) {
            shortcut.push(e.code.replace('Key', ''));
        } else if (['Control', 'Shift', 'Alt'].includes(e.key)) {
            shortcut.push(e.key);
        } else if (e.keyCode >= 48 && e.keyCode <= 57) {
            shortcut.push(e.code.replace('Digit', ''));
        } else if (e.keyCode >= 96 && e.keyCode <= 105) {
            shortcut.push(e.code.replace('Numpad', 'num'));
        } else if (e.keyCode >= 112 && e.keyCode <= 123) {
            shortcut.push(e.code);
        } else if (['ArrowRight', 'ArrowLeft', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
            shortcut.push(e.code.replace('Arrow', ''));
        } else if (shortcutCharacter.includes(e.key)) {
            shortcut.push(e.key);
        }
    });
    const sortTable = {
        Control: 1,
        Shift: 2,
        Alt: 3
    };
    shortcut = shortcut.sort((a, b) => {
        if (!sortTable[a] || !sortTable[b]) return 0;
        if (sortTable[a] - sortTable[b] <= -1) {
            return -1;
        } else if (sortTable[a] - sortTable[b] >= 1) {
            return 1;
        } else {
            return 0;
        }
    });
    shortcut = shortcut.join('+');
    return shortcut;
}
const inputShortcut = (k) => {
    if (!selectedShortcut.value) return
    if (newShortcut.value.find(nk => nk.keyCode === k.keyCode)) return;
    else newShortcut.value.push(k)
    if ((k.keyCode >= 65 && k.keyCode <= 90) || (k.keyCode >= 48 && k.keyCode <= 57) || (k.keyCode >= 96 && k.keyCode <= 105) || (k.keyCode >= 112 && k.keyCode <= 123) || ['ArrowRight', 'ArrowLeft', 'ArrowUp', 'ArrowDown'].includes(k.key) || shortcutCharacter.includes(k.key)) {
        if (selectedShortcut.value.type) shortcutsList.value.find(sc => (sc.id == selectedShortcut.value.id)).globalShortcut = updateShortcut()
        else shortcutsList.value.find(sc => (sc.id == selectedShortcut.value.id)).shortcut = updateShortcut()
        newShortcut.value = []
        if (isWebClient) void persistWebSettingsFromForm()
    }
}
const setDefaultShortcuts = () => {
    shortcutsList.value = [{ id: 'play', name: '播放/暂停', shortcut: 'CommandOrControl+P', globalShortcut: 'CommandOrControl+Alt+P', }, { id: 'last', name: '上一首', shortcut: 'CommandOrControl+Left', globalShortcut: 'CommandOrControl+Alt+Left', }, { id: 'next', name: '下一首', shortcut: 'CommandOrControl+Right', globalShortcut: 'CommandOrControl+Alt+Right', }, { id: 'volumeUp', name: '增加音量', shortcut: 'CommandOrControl+Up', globalShortcut: 'CommandOrControl+Alt+Up', }, { id: 'volumeDown', name: '减少音量', shortcut: 'CommandOrControl+Down', globalShortcut: 'CommandOrControl+Alt+Down', }, { id: 'processForward', name: '快进(3s)', shortcut: 'CommandOrControl+]', globalShortcut: 'CommandOrControl+Alt+]' }, { id: 'processBack', name: '后退(3s)', shortcut: 'CommandOrControl+[', globalShortcut: 'CommandOrControl+Alt+[' },]
    if (isWebClient) void persistWebSettingsFromForm()
}
const clearMusicVideo = () => {
    windowApi.clearUnusedVideo().then(result => {
        if (result == 'noSavePath') {
            noticeOpen('请先在设置中设置音乐视频缓存目录', 2)
            return
        }
        else if (result) noticeOpen('清除完毕', 3)
        else noticeOpen('删除失败', 3)
    })
}
const setMusicVideo = () => {
    if (!playerStore.musicVideo)
        dialogOpen('确定开启', '开启后此功能会消耗一定性能且可能造成卡顿，确定开启吗？', openMusicVideo)
    else
        openMusicVideo(true)
}
const openMusicVideo = async (flag) => {
    if (flag)
        playerStore.musicVideo = !playerStore.musicVideo
    if (flag) await persistWebSettingsFromForm()
}
const setCoverBlur = () => {
    if (!playerStore.coverBlur)
        dialogOpen('确定开启', '开启后此功能会消耗一定性能且可能造成卡顿，确定开启吗？', openCoverBlur)
    else
        openCoverBlur(true)
}
const openCoverBlur = async (flag) => {
    if (flag) playerStore.coverBlur = !playerStore.coverBlur
    if (flag) await persistWebSettingsFromForm()
}
const setLyricBlur = () => {
    if (!playerStore.lyricBlur)
        dialogOpen('确定开启', '开启后此功能会消耗一定性能且可能造成卡顿，确定开启吗？', openLyricBlur)
    else
        openLyricBlur(true)
}
const openLyricBlur = async (flag) => {
    if (flag) playerStore.lyricBlur = !playerStore.lyricBlur
    if (flag) await persistWebSettingsFromForm()
}
const userLogout = () => {
    if (isLogin()) {
        logout().then(async (result) => {
            if (result.code == 200) {
                if (isWebClient) {
                    try {
                        const s = await windowApi.getSettings()
                        if (s?.local?.syncProfileToNas) await clearWebProfileOnNas()
                    } catch (_) {}
                }
                window.localStorage.clear()
                userStore.user = null
                userStore.biliUser = null
                router.push('/')
                noticeOpen("已退出账号", 2)
            }
            else noticeOpen("退出登录失败", 2)
        })
    } else noticeOpen("您已退出账号", 2)
}
const save = async () => {
    selectedShortcut.value = null
    await setAppSettings()
    await initSettings()
    if (isWebClient && syncProfileToNas.value) {
        try {
            await saveWebProfileIfSyncEnabled()
        } catch (_) {}
    }
    noticeOpen("设置已保存", 2)
}
const toGithub = () => {
    windowApi.toRegister("https://github.com/Kaidesuyo/Hydrogen-Music")
}
const toggleSyncProfileToNas = async () => {
    syncProfileToNas.value = !syncProfileToNas.value
    if (!isWebClient) return
    try {
        await setAppSettings()
        if (syncProfileToNas.value) await saveWebProfileIfSyncEnabled()
    } catch (e) {
        console.warn('[Settings] 同步开关保存失败', e)
    }
}
const toJinghuaGithub = () => {
    windowApi.toRegister("https://github.com/jinghuashang/Hydrogen-Music")
}
const checkForUpdate = async () => {
    if (isCheckingUpdate.value) return
    isCheckingUpdate.value = true
    try {
        const result = await windowApi.manualCheckUpdate()
        if (result.hasUpdate) {
            otherStore.toUpdate = true
            otherStore.newVersion = result.version
            otherStore.updateDownloadUrl = result.downloadUrl
            otherStore.updateIsWindows = result.isWindows
            otherStore.releaseBody = result.releaseBody || ''
        } else {
            noticeOpen(result.error || '当前已是最新版本', 2)
        }
    } catch (e) {
        noticeOpen('检查更新失败', 2)
    } finally {
        isCheckingUpdate.value = false
    }
}

const setCustomFont = () => {
    insertCustomFontStyle(customFont.value)
    if (isWebClient) void persistWebSettingsFromForm()
}

const toggleGlobalShortcuts = async () => {
    globalShortcuts.value = !globalShortcuts.value
    await persistWebSettingsFromForm()
}
const toggleUnblock = () => {
    unblockEnabled.value = !unblockEnabled.value
    setAppSettings()
    noticeOpen(unblockEnabled.value ? '解锁灰色歌曲已开启' : '解锁灰色歌曲已关闭', 1)
}

const toggleWebHomeSidePlayer = async () => {
    webHomeSidePlayer.value = !webHomeSidePlayer.value
    playerStore.webHomeSidePlayer = webHomeSidePlayer.value
    if (isWebClient) await persistWebSettingsFromForm()
    else await setAppSettings()
}
</script>

<template>
    <div class="settings-page" @click="selectedShortcut = null">
        <div class="view-control">
            <svg t="1669039513804" @click="routerChange()" class="router-last" viewBox="0 0 1024 1024" version="1.1"
                xmlns="http://www.w3.org/2000/svg" p-id="1053" width="200" height="200">
                <path d="M716.608 1010.112L218.88 512.384 717.376 13.888l45.248 45.248-453.248 453.248 452.48 452.48z"
                    p-id="1054"></path>
            </svg>
            <span class="setting-title">设置(离开页面以保存设置或
                <span class="save" @click="save()">点击</span>
                保存)
            </span>
        </div>
        <div class="settings-container">
            <h1 class="settings-title">设置</h1>
            <div class="settings-user-info" v-if="isLogin()">
                <div class="user">
                    <div class="user-head">
                        <img :src="userStore.user.avatarUrl + '?param=300y300'" alt="">
                    </div>
                    <div class="user-info">
                        <div class="user-name">{{ userStore.user.nickname }}</div>
                        <div class="user-vip" v-if="vipInfo && userStore.user.vipType != 0">
                            <img :src="vipInfo.redVipDynamicIconUrl" alt="">
                        </div>
                    </div>
                </div>
                <div class="logout" @click="userLogout()">
                    <span>退出</span>
                </div>
            </div>
            <div class="settings">
                <div class="settings-item">
                    <h2 class="item-title">音乐</h2>
                    <div class="line"></div>
                    <div class="item-options">
                        <div class="option">
                            <div class="option-name">音质选择</div>
                            <div class="option-operation">
                                <Selector v-model="musicLevel" :options="musicLevelOptions" @update:modelValue="persistWebSettingsFromForm"></Selector>
                            </div>
                        </div>
                        <div class="option">
                            <div class="option-name">搜索栏显示歌曲数量</div>
                            <div class="option-operation">
                                <input v-model.number="searchResultLimit" name="searchResultLimit" type="number" min="1" max="20" @change="persistWebSettingsFromForm">
                            </div>
                        </div>
                        <div class="option">
                            <div class="option-name">开启背景封面模糊</div>
                            <div class="option-operation">
                                <div class="toggle" @click="setCoverBlur()">
                                    <div class="toggle-off" :class="{ 'toggle-on-in': playerStore.coverBlur }">
                                        {{ playerStore.coverBlur ? '已开启' : '已关闭' }}</div>
                                    <Transition name="toggle">
                                        <div class="toggle-on" v-show="playerStore.coverBlur"></div>
                                    </Transition>
                                </div>
                            </div>
                        </div>
                        <div class="option">
                            <div class="option-name">开启歌词模糊</div>
                            <div class="option-operation">
                                <div class="toggle" @click="setLyricBlur()">
                                    <div class="toggle-off" :class="{ 'toggle-on-in': playerStore.lyricBlur }">
                                        {{ playerStore.lyricBlur ? '已开启' : '已关闭' }}</div>
                                    <Transition name="toggle">
                                        <div class="toggle-on" v-show="playerStore.lyricBlur"></div>
                                    </Transition>
                                </div>
                            </div>
                        </div>
                        <div class="option">
                            <div class="option-name">歌词字体大小</div>
                            <div class="option-operation">
                                <input v-model="lyricSize" name="lyricSize" @change="persistWebSettingsFromForm">
                            </div>
                        </div>
                        <div class="option">
                            <div class="option-name">歌词翻译字体大小</div>
                            <div class="option-operation">
                                <input v-model="tlyricSize" name="tlyricSize" @change="persistWebSettingsFromForm">
                            </div>
                        </div>
                        <div class="option">
                            <div class="option-name">罗马歌词字体大小</div>
                            <div class="option-operation">
                                <input v-model="rlyricSize" name="rlyricSize" @change="persistWebSettingsFromForm">
                            </div>
                        </div>
                        <div class="option">
                            <div class="option-name">歌词间奏等待时间(单位：秒)</div>
                            <div class="option-operation">
                                <input v-model="lyricInterlude" name="lyricInterlude" @change="persistWebSettingsFromForm">
                            </div>
                        </div>
                        <div class="option">
                            <div class="option-name">开启音乐视频功能</div>
                            <div class="option-operation">
                                <div class="toggle" @click="setMusicVideo()">
                                    <div class="toggle-off" :class="{ 'toggle-on-in': playerStore.musicVideo }">
                                        {{ playerStore.musicVideo ? '已开启' : '已关闭' }}</div>
                                    <Transition name="toggle">
                                        <div class="toggle-on" v-show="playerStore.musicVideo"></div>
                                    </Transition>
                                </div>
                            </div>
                        </div>
                        <div class="option" v-if="playerStore.musicVideo">
                            <div class="option-name">删除所有未被使用的音乐视频</div>
                            <div class="option-operation">
                                <div class="button" @click="clearMusicVideo()">清除</div>
                            </div>
                        </div>
                    </div>
                </div>
                <div class="settings-item">
                    <h2 class="item-title">本地</h2>
                    <div class="line"></div>
                    <div class="item-options">
                        <div class="option" v-if="playerStore.musicVideo">
                            <div class="option-name">音乐视频缓存</div>
                            <div class="select-download-folder">
                                <div class="selected-folder" :title="videoFolder || ''">{{ videoFolder ? videoFolder : '待选择' }}
                                </div>
                                <div class="select-option" @click="selectFolder('video')">选择</div>
                                <div class="select-option select-option-secondary" @click="manualInputFolder('video')">手动输入</div>
                            </div>
                        </div>
                        <div class="option">
                            <div class="option-name">下载目录</div>
                            <div class="select-download-folder">
                                <div class="selected-folder" :title="downloadFolder || ''">{{ downloadFolder ? downloadFolder :
                                    '待选择' }}</div>
                                <div class="select-option" @click="selectFolder('download')">选择</div>
                                <div class="select-option select-option-secondary" @click="manualInputFolder('download')">手动输入</div>
                            </div>
                        </div>
                        <div class="option">
                            <div class="option-name">本地目录</div>
                            <div class="local-folder">
                                <div class="selected-local-folder-item">
                                    <div class="selected-folder" :title="item" @contextmenu="deleteLocalFolder(index)"
                                        v-for="(item, index) in localFolder">{{ item ? item : '请添加' }}</div>
                                    <div class="tip">可同时添加多个目录；右键移除不需要的目录。路径需为绝对路径（Linux/macOS 多为「/home/…」开头；Windows 为盘符路径）。数据量过大时扫描会较慢。</div>
                                    <div class="tip tip-linux" v-if="isLinuxLikePath">Linux：若系统文件选择器异常（如部分 Wayland 环境），请用「手动输入」填写目录路径。</div>
                                </div>
                                <div class="add-option" @click="selectFolder('local')">添加</div>
                                <div class="add-option add-option-secondary" @click="manualInputFolder('local')">手动输入路径</div>
                            </div>
                        </div>
                        <div class="option option-nas-sync" v-if="showNasSync">
                            <div class="option-name">账户同步到 NAS</div>
                            <div class="tip">
                                此项仅同步网易与 B 站登录态，多浏览器共用；关同步或退出登录会清 NAS 副本。
                            </div>
                            <div class="option-operation">
                                <div class="toggle" @click="toggleSyncProfileToNas">
                                    <div class="toggle-off" :class="{ 'toggle-on-in': syncProfileToNas }">
                                        {{ syncProfileToNas ? '已开启' : '已关闭' }}</div>
                                    <Transition name="toggle">
                                        <div class="toggle-on" v-show="syncProfileToNas"></div>
                                    </Transition>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
                <div class="settings-item">
                    <h2 class="item-title">下载</h2>
                    <div class="line"></div>
                    <div class="item-options">
                        <div class="option">
                            <div class="option-name">下载歌曲封面</div>
                            <div class="option-operation">
                                <div class="toggle" @click="downloadCover = !downloadCover; setAppSettings()">
                                    <div class="toggle-off" :class="{ 'toggle-on-in': downloadCover }">
                                        {{ downloadCover ? '已开启' : '已关闭' }}</div>
                                    <Transition name="toggle">
                                        <div class="toggle-on" v-show="downloadCover"></div>
                                    </Transition>
                                </div>
                            </div>
                        </div>
                        <div class="option">
                            <div class="option-name">下载歌曲信息</div>
                            <div class="option-operation">
                                <div class="toggle" @click="downloadInfo = !downloadInfo; setAppSettings()">
                                    <div class="toggle-off" :class="{ 'toggle-on-in': downloadInfo }">
                                        {{ downloadInfo ? '已开启' : '已关闭' }}</div>
                                    <Transition name="toggle">
                                        <div class="toggle-on" v-show="downloadInfo"></div>
                                    </Transition>
                                </div>
                            </div>
                        </div>
                        <div class="option">
                            <div class="option-name">下载歌词</div>
                            <div class="option-operation">
                                <div class="toggle" @click="downloadLyric = !downloadLyric; setAppSettings()">
                                    <div class="toggle-off" :class="{ 'toggle-on-in': downloadLyric }">
                                        {{ downloadLyric ? '已开启' : '已关闭' }}</div>
                                    <Transition name="toggle">
                                        <div class="toggle-on" v-show="downloadLyric"></div>
                                    </Transition>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
                <div class="settings-item" v-if="!isWebClient">
                    <h2 class="item-title">快捷键</h2>
                    <div class="line"></div>
                    <div class="item-options" tabindex='0' @keydown="inputShortcut($event)">
                        <div class="option">
                            <div class="option-name">开启全局快捷键</div>
                            <div class="option-operation">
                                <div class="toggle" @click="toggleGlobalShortcuts">
                                    <div class="toggle-off" :class="{ 'toggle-on-in': globalShortcuts }">{{ globalShortcuts
                                        ?
                                        '已开启' : '已关闭' }}</div>
                                    <Transition name="toggle">
                                        <div class="toggle-on" v-show="globalShortcuts"></div>
                                    </Transition>
                                </div>
                            </div>
                        </div>
                        <div class="shortcuts-title">
                            <div class="title-function">功能说明</div>
                            <div class="title-shortcuts">快捷键</div>
                            <div class="title-globalShortcuts" :class="{ 'forbid-shortcuts': !globalShortcuts }">全局快捷键</div>
                        </div>
                        <div class="shortcuts" v-for="(item, index) in shortcutsList">
                            <div class="shortcut-name">{{ item.name }}</div>
                            <div class="shortcut"
                                :class="{ 'shortcut-selected': (selectedShortcut && selectedShortcut.id == item.id && !selectedShortcut.type) }"
                                @click.stop="changeShortcut(item.id, false)">{{ formatShortcutName(item.shortcut) }}</div>
                            <div class="globalShortcut"
                                :class="{ 'shortcut-selected': (selectedShortcut && selectedShortcut.id == item.id && selectedShortcut.type), 'forbid-shortcuts': !globalShortcuts }"
                                @click.stop="changeShortcut(item.id, true)">{{ formatShortcutName(item.globalShortcut) }}
                            </div>
                        </div>
                        <div class="default-shortcuts" @click="setDefaultShortcuts()">恢复默认快捷键</div>
                    </div>
                </div>
                <div class="settings-item">
                    <h2 class="item-title">其他</h2>
                    <div class="line"></div>
                    <div class="item-options">
                        <div class="option">
                            <div class="option-name">开启首页页面</div>
                            <div class="option-operation">
                                <div class="toggle" @click="userStore.homePage = !userStore.homePage">
                                    <div class="toggle-off" :class="{ 'toggle-on-in': userStore.homePage }">
                                        {{ userStore.homePage ? '已开启' : '已关闭' }}</div>
                                    <Transition name="toggle">
                                        <div class="toggle-on" v-show="userStore.homePage"></div>
                                    </Transition>
                                </div>
                            </div>
                        </div>
                        <div class="option" v-if="isWebClient">
                            <div class="option-name">宽屏首页右侧播放器</div>
                            <div class="option-operation">
                                <div class="toggle" @click="toggleWebHomeSidePlayer">
                                    <div class="toggle-off" :class="{ 'toggle-on-in': webHomeSidePlayer }">
                                        {{ webHomeSidePlayer ? '已开启' : '已关闭' }}</div>
                                    <Transition name="toggle">
                                        <div class="toggle-on" v-show="webHomeSidePlayer"></div>
                                    </Transition>
                                </div>
                            </div>
                        </div>
                        <div class="option">
                            <div class="option-name">开启云盘页面</div>
                            <div class="option-operation">
                                <div class="toggle" @click="userStore.cloudDiskPage = !userStore.cloudDiskPage">
                                    <div class="toggle-off" :class="{ 'toggle-on-in': userStore.cloudDiskPage }">
                                        {{ userStore.cloudDiskPage ? '已开启' : '已关闭' }}</div>
                                    <Transition name="toggle">
                                        <div class="toggle-on" v-show="userStore.cloudDiskPage"></div>
                                    </Transition>
                                </div>
                            </div>
                        </div>
                        <div class="option">
                            <div class="option-name">开启听歌识曲</div>
                            <div class="option-operation">
                                <div class="toggle" @click="userStore.audioMatchPage = !userStore.audioMatchPage">
                                    <div class="toggle-off" :class="{ 'toggle-on-in': userStore.audioMatchPage }">
                                        {{ userStore.audioMatchPage ? '已开启' : '已关闭' }}</div>
                                    <Transition name="toggle">
                                        <div class="toggle-on" v-show="userStore.audioMatchPage"></div>
                                    </Transition>
                                </div>
                            </div>
                        </div>
                        <div class="option">
                            <div class="option-name">自定义字体</div>
                            <div class="custom-font local-folder">
                                <!-- <div class="custom-font-path">{{customFont ? customFont : '未设置'}}</div> -->
                                <input type="text" placeholder="输入本地已安装字体名字" @blur="setCustomFont()"
                                    v-model.lazy="customFont">
                            </div>
                        </div>
                        <div class="option">
                            <div class="option-name">退出应用时</div>
                            <div class="option-operation">
                                <Selector v-model="quitApp" :options="quitAppOptions" @update:modelValue="persistWebSettingsFromForm"></Selector>
                            </div>
                        </div>
                        <div class="option" v-if="!isWebClient">
                            <div class="option-name">更新加速地址</div>
                            <div class="option-operation">
                                <input type="text" v-model="updateProxy" placeholder="留空不加速，如 https://gh.llkk.cc/" @change="persistWebSettingsFromForm()">
                            </div>
                        </div>
                        <div class="option">
                            <div class="option-name">解锁灰色歌曲</div>
                            <div class="option-operation">
                                <div class="toggle" @click="toggleUnblock()">
                                    <div class="toggle-off" :class="{ 'toggle-on-in': unblockEnabled }">
                                        {{ unblockEnabled ? '已开启' : '已关闭' }}</div>
                                    <Transition name="toggle">
                                        <div class="toggle-on" v-show="unblockEnabled"></div>
                                    </Transition>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
            <div class="app-version">
                <div class="app-icon">
                    <img src="../assets/icon/icon.ico" alt="">
                </div>
                <div class="version">V{{ appVersion }}</div>
                <div v-if="!isWebClient" class="check-update-btn" @click="checkForUpdate()" :class="{ 'checking': isCheckingUpdate }">
                    {{ isCheckingUpdate ? '检查中...' : '检查更新' }}
                </div>
                <div class="app-author" @click="toGithub()">Made by Kaidesuyo</div>
                <div class="app-author" @click="toJinghuaGithub()">Modified by jinghuashang</div>
            </div>
        </div>
    </div>
</template>

<style scoped lang="scss">
.settings-page {
    width: 100%;
    height: 100%;

    .view-control {
        margin-bottom: 15Px;
        margin-left: -8Px;
        height: 32Px;
        display: flex;
        flex-direction: row;
        align-items: center;

        svg {
            padding: 8Px;
            width: 32Px;
            height: 32Px;
            float: left;
            transition: 0.2s;

            &:hover {
                cursor: pointer;
                opacity: 0.7;
            }

            &:active {
                transform: scale(0.9);
            }
        }

        .router-last {
            margin-right: 5Px;
        }

        .setting-title {
            font: 17Px SourceHanSansCN-Bold;
            color: black;

            .save {
                font-size: 15px;
                padding: 6px;
                background-color: rgba(255, 255, 255, 0.35);
                transition: 0.1s;

                &:hover {
                    cursor: pointer;
                    opacity: 0.8;
                }

                &:active {
                    opacity: 0.5;
                }
            }
        }
    }

    .settings-container {
        margin: 0 auto;
        padding-bottom: 140px;
        width: 80%;
        height: calc(100% - 47px);
        overflow: auto;

        &::-webkit-scrollbar {
            display: none;
        }

        .settings-title {
            font-family: SourceHanSansCN-Bold;
            color: black;
            text-align: left;
        }

        .settings-user-info {
            padding: 10px 40px;
            width: 100%;
            height: 100px;
            background-color: rgba(255, 255, 255, 0.35);
            display: flex;
            flex-direction: row;
            align-items: center;
            justify-content: space-between;

            .user {
                display: flex;
                flex-direction: row;
                align-items: center;

                .user-head {
                    margin-right: 15px;
                    width: 70px;
                    height: 70px;
                    border-radius: 50%;
                    overflow: hidden;

                    img {
                        width: 100%;
                        height: 100%;
                    }
                }

                .user-info {
                    .user-name {
                        font: 20px Source Han Sans;
                        font-weight: bold;
                        color: black;
                    }

                    .user-vip {
                        width: 40px;

                        img {
                            width: 100%;
                        }
                    }
                }
            }

            .logout {
                font: 14Px SourceHanSansCN-Bold;
                font-weight: bold;
                color: black;
                transition: 0.2s;

                &:hover {
                    cursor: pointer;
                }

                &:active {
                    transform: scale(0.95);
                }
            }
        }

        .settings {
            width: 100%;

            .settings-item {
                margin-top: 45px;
                width: 100%;

                .item-title {
                    margin: 0;
                    font: 20Px SourceHanSansCN-Bold;
                    color: black;
                    font-family: SourceHanSansCN-Bold;
                    color: black;
                    text-align: left;
                }

                .line {
                    margin-top: 8px;
                    margin-bottom: 25px;
                    width: 100%;
                    height: 0.5px;
                    background-color: rgba(0, 0, 0, 0.2);
                }

                .item-options {
                    outline: none;

                    .option {
                        margin-bottom: 32px;
                        display: flex;
                        flex-direction: row;
                        align-items: flex-start;
                        justify-content: flex-start;
                        gap: 16px 24px;
                        flex-wrap: wrap;

                        &.option-nas-sync {
                            align-items: flex-start;
                            gap: 12px;

                            .option-name {
                                flex: 0 0 168px;
                                min-width: 168px;
                                max-width: 220px;
                            }

                            .tip {
                                flex: 1 1 200px;
                                min-width: 0;
                                margin-top: 2px;
                                font: 10px SourceHanSansCN-Bold;
                                color: black;
                                text-align: left;
                            }

                            .option-operation {
                                flex: 0 0 auto;
                                margin-top: 0;
                                align-self: center;
                            }
                        }

                        .option-name {
                            font-family: SourceHanSansCN-Bold;
                            font-size: 16px;
                            color: black;
                            text-align: left;
                            flex: 0 0 168px;
                            min-width: 168px;
                            max-width: 220px;
                            flex-shrink: 0;
                            white-space: normal;
                            word-break: keep-all;
                            line-height: 1.35;
                            padding-top: 4px;
                        }

                        .option-operation {
                            flex: 0 0 auto;
                            align-self: center;
                        }

                        input,
                        .selector {
                            margin-right: 1px;
                            width: 200px;
                            height: 34px;
                            padding: 5px 1px;
                            background-color: rgba(255, 255, 255, 0.35);
                            color: black;
                            border: none;
                            outline: none;
                            appearance: none;
                            font: 13px SourceHanSansCN-Bold;
                            text-align: center;
                            transition: 0.2s;

                            &:hover {
                                cursor: pointer;
                                opacity: 0.8;
                                box-shadow: 0 0 0 1px black;
                            }
                        }

                        select {
                            padding: 8px 10px;
                        }

                        option {
                            background-color: rgba(255, 255, 255, 0.35);
                            border: none;
                            outline: none;
                        }

                        .toggle {
                            margin-right: 1px;
                            height: 34px;
                            width: 200px;
                            position: relative;
                            overflow: hidden;

                            &:hover {
                                cursor: pointer;
                            }

                            .toggle-on,
                            .toggle-off {
                                padding: 5px 10px;
                                width: 100%;
                                height: 100%;
                                font: 13px SourceHanSansCN-Bold;
                                transition: 0.2s;
                                line-height: 24px;
                            }

                            .toggle-off {
                                background-color: rgba(255, 255, 255, 0.35);
                            }

                            .toggle-on {
                                background-color: black;
                                position: absolute;
                                top: 0;
                                left: 0;
                                z-index: -1;
                            }

                            .toggle-on-in {
                                color: white;
                                background-color: transparent;
                            }
                        }

                        .button {
                            margin-right: 1px;
                            padding: 5px 10px;
                            width: 200px;
                            background-color: rgba(255, 255, 255, 0.35);
                            font: 13px SourceHanSansCN-Bold;

                            &:hover {
                                cursor: pointer;
                                opacity: 0.8;
                                box-shadow: 0 0 0 1px black;
                            }
                        }

                        .select-download-folder {
                            display: flex;
                            flex-direction: row;
                            align-items: center;
                            flex: 1 1 280px;
                            min-width: 0;
                            flex-wrap: wrap;
                            gap: 8px 12px;
                            justify-content: flex-end;

                            .selected-folder {
                                flex: 1 1 200px;
                                min-width: 0;
                                max-width: 100%;
                                height: 30px;
                                background-color: rgba(255, 255, 255, 0.35);
                                font: 13px SourceHanSansCN-Bold;
                                color: black;
                                line-height: 30px;
                                overflow: hidden;
                                text-overflow: ellipsis;
                                white-space: nowrap;
                                padding: 0 8px;
                                box-sizing: border-box;
                            }

                            .select-option {
                                margin-right: 0;
                                margin-left: 0;
                                padding: 5px 15px;
                                font: 13px SourceHanSansCN-Bold;
                                color: black;
                                background-color: rgba(255, 255, 255, 0.35);
                                transition: 0.2s;
                                white-space: nowrap;

                                &:hover {
                                    cursor: pointer;
                                    opacity: 0.8;
                                    box-shadow: 0 0 0 1px black;
                                }
                            }

                            .select-option-secondary {
                                margin-left: 8px;
                            }
                        }

                        .local-folder {
                            display: flex;
                            flex-direction: row;
                            align-items: flex-start;
                            flex: 1 1 280px;
                            min-width: 0;
                            flex-wrap: wrap;
                            gap: 10px 12px;
                            justify-content: flex-end;

                            .selected-local-folder-item {
                                display: flex;
                                flex-direction: column;
                                flex: 1 1 220px;
                                min-width: 0;

                                .selected-folder {
                                    margin-bottom: 10px;
                                    width: 100%;
                                    max-width: 100%;
                                    height: 30px;
                                    background-color: rgba(255, 255, 255, 0.35);
                                    font: 13px SourceHanSansCN-Bold;
                                    color: black;
                                    line-height: 30px;
                                    overflow: hidden;
                                    text-overflow: ellipsis;
                                    white-space: nowrap;
                                    padding: 0 8px;
                                    box-sizing: border-box;
                                }

                                .tip {
                                    font: 10px SourceHanSansCN-Bold;
                                    color: black;
                                    text-align: left;
                                    line-height: 1.45;
                                }

                                .tip-linux {
                                    margin-top: 4px;
                                    opacity: 0.85;
                                    text-align: left;
                                }
                            }

                            .add-option {
                                margin-right: 0;
                                margin-left: 0;
                                align-self: center;
                                padding: 5px 15px;
                                font: 13px SourceHanSansCN-Bold;
                                color: black;
                                background-color: rgba(255, 255, 255, 0.35);
                                transition: 0.2s;
                                white-space: nowrap;

                                &.selected {
                                    color: white;
                                    background-color: black;
                                    box-shadow: 0 0 0 1px black;
                                }

                                &:hover {
                                    cursor: pointer;
                                    opacity: 0.8;
                                    box-shadow: 0 0 0 1px black;
                                }
                            }

                            .add-option-secondary {
                                margin-left: 8px;
                            }
                        }

                        .custom-font {
                            flex: 1 1 280px;
                            min-width: 0;
                            align-items: center;
                            flex-wrap: nowrap;

                            input {
                                flex: 1 1 auto;
                                min-width: 0;
                                width: 100%;
                                max-width: 100%;
                            }

                            .custom-font-path {
                                width: 100%;
                                max-width: 100%;
                                height: 30px;
                                background-color: rgba(255, 255, 255, 0.35);
                                font: 13px SourceHanSansCN-Bold;
                                color: black;
                                line-height: 30px;
                                overflow: hidden;
                            }
                        }
                    }

                    .forbid-shortcuts {
                        opacity: 0.5;
                        pointer-events: none;
                    }

                    .shortcuts-title {
                        font: 14px SourceHanSansCN-Bold;
                        color: black;
                        display: flex;
                        flex-direction: row;
                        align-items: center;
                        text-align: left;

                        div {
                            margin-right: 15px;
                            padding: 0 6px;
                        }

                        .title-function {
                            min-width: 130px;
                        }

                        .title-shortcuts,
                        .title-globalShortcuts {
                            min-width: 200px;
                        }
                    }

                    .shortcuts {
                        font: 14px SourceHanSansCN-Bold;
                        color: black;
                        display: flex;
                        flex-direction: row;
                        display: flex;
                        flex-direction: row;
                        align-items: center;
                        text-align: left;

                        div {
                            margin-top: 15px;
                            margin-right: 15px;
                            padding: 6px;
                            background-color: rgba(255, 255, 255, 0.35);
                        }

                        .shortcut-name {
                            min-width: 130px;
                            background-color: transparent;
                        }

                        .shortcut,
                        .globalShortcut {
                            min-width: 200px;

                            &:hover {
                                cursor: pointer;
                            }
                        }

                        .shortcut-selected {
                            box-shadow: 0 0 0 1px black;
                        }
                    }

                    .default-shortcuts {
                        margin-top: 15px;
                        margin-left: 1px;
                        width: 120px;
                        padding: 6px;
                        background-color: rgba(255, 255, 255, 0.35);
                        font: 14px SourceHanSansCN-Bold;
                        transition: 0.2s;
                        color: black;

                        &:hover {
                            cursor: pointer;
                            box-shadow: 0 0 0 1px black;
                        }
                    }
                }
            }
        }

        .app-version {
            display: flex;
            flex-direction: column;
            align-items: center;

            .app-icon {
                margin-bottom: 10px;
                width: 65px;
                height: 65px;

                img {
                    width: 100%;
                    height: 100%;
                }
            }

            .version {
                font: 14px Geometos;
                color: black;
            }

            .check-update-btn {
                margin-top: 15px;
                padding: 8px 20px;
                background-color: rgba(255, 255, 255, 0.35);
                font: 14px SourceHanSansCN-Bold;
                color: black;
                transition: 0.2s;
                cursor: pointer;

                &:hover {
                    opacity: 0.8;
                    box-shadow: 0 0 0 1px black;
                }

                &:active {
                    transform: scale(0.95);
                }

                &.checking {
                    opacity: 0.6;
                    cursor: not-allowed;
                }
            }

            .app-author {
                margin-top: 10px;
                font: 14px Bender-Bold;
                color: black;

                &:hover {
                    cursor: pointer;
                    text-decoration: underline;
                }
            }
        }
    }
}

.toggle-enter-active,
.toggle-leave-active {
    transition: 0.1s;
}

.toggle-enter-from,
.toggle-leave-to {
    transform: translateX(-100%)
}
</style>