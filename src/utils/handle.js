import pinia from '../store/pinia'
import { setCookies } from '../utils/authority'
import { getUserProfile } from '../api/user'
import { getUserLikelist } from './initApp'
import { useUserStore } from '../store/userStore'
import { saveWebProfileIfSyncEnabled } from './webProfileNas'
import { noticeOpen } from './dialog'

const userStore = useUserStore(pinia)
const { updateUser } = userStore

//处理登录后的用户数据
export function loginHandle(data, type) {
    setCookies(data, type)
    getUserProfile().then(result => {
        updateUser(result.profile)
        getUserLikelist()
        saveWebProfileIfSyncEnabled().catch(() => {})
    }).catch(() => {
        // Cookie 已写入但资料拉取失败时提示，避免出现无提示的"半登录"态
        noticeOpen("获取用户信息失败，请检查网络", 2)
    })
}