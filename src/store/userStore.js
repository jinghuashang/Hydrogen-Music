import { defineStore } from "pinia";

export const useUserStore = defineStore('userStore', {
    state: () => {
        return {
            user: null,
            loginMode: null,
            likelist: null,
            appOptionShow: false,
            biliUser: null,
            homePage: true,
            cloudDiskPage: true,
            audioMatchPage: true,
            heartbeatPage: true,
        }
    },
    actions: {
        updateUser(userinfo) {
            this.user = userinfo
        },
    },
    persist: {
        storage: localStorage,
        paths: ['user','biliUser','homePage','cloudDiskPage','audioMatchPage','heartbeatPage']
    },
})