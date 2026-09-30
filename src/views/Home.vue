<script setup>
  import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
  import { useRoute, useRouter } from 'vue-router'
  import { noticeOpen } from "../utils/dialog";
  import { isLogin } from '../utils/authority'
  import { useUserStore } from '../store/userStore';
  import { isHydrogenWeb, clearWebProfileOnNas } from '../utils/webProfileNas'
  const router = useRouter()
  const route = useRoute()
  const userStore = useUserStore()

  const isActive = ref(false)
  const trackerLeft = ref(0)
  const trackerWidth = ref(14)

  function updateTracker() {
    nextTick(() => {
      const headerRouter = document.querySelector('.header-router')
      // 导航整体尽量按窗口居中；窗口较窄时向右偏移刚好避开左侧悬浮层
      // （logo+搜索框，聚焦展开后约 365Px，预留 380），且不进入右侧窗口控制按钮区（约 190Px，含头像外挂）
      // 注意：偏移用 left 而非 transform——transform 会在 .header-router 上创建层叠上下文，
      // 把 .user（z-9999）关押在内，导致设置下拉被页面内容遮挡
      if (headerRouter) {
        const winWidth = window.innerWidth
        const routerWidth = headerRouter.getBoundingClientRect().width
        if (routerWidth > 0) {
          const desiredLeft = (winWidth - routerWidth) / 2
          const minLeft = 380
          const maxRight = winWidth - 190
          let offset = 0
          if (desiredLeft < minLeft) offset = minLeft - desiredLeft
          if (desiredLeft + offset + routerWidth > maxRight) offset = maxRight - routerWidth - desiredLeft
          headerRouter.style.left = offset > 0 ? `${offset}px` : ''
        }
      }

      const routeName = route.name
      let targetClass = ''
      if (routeName === 'homepage') targetClass = 'button-home'
      else if (routeName === 'clouddisk') targetClass = 'button-cloud'
      else if (routeName === 'heartbeat') targetClass = 'button-heartbeat'
      else if (routeName === 'audiomatch') targetClass = 'button-match'
      else if (routeName === 'mv') targetClass = 'button-mv'
      else if (routeName === 'toplist') targetClass = 'button-toplist'
      else if (route.fullPath.split('/')[1] === 'mymusic' || route.fullPath.split('/')[1] === 'login') targetClass = 'button-music'

      if (targetClass) {
        const targetBtn = document.querySelector('.' + targetClass)
        if (headerRouter && targetBtn) {
          const routerRect = headerRouter.getBoundingClientRect()
          const btnRect = targetBtn.getBoundingClientRect()
          trackerLeft.value = btnRect.left - routerRect.left + btnRect.width * 3 / 8
          trackerWidth.value = btnRect.width / 4
        }
      }
    })
  }

  watch(() => route.fullPath, updateTracker)
  // 导航按钮由页签开关 v-if 控制，开关后按钮挂载/移除，指示器需重新定位
  watch(
    () => [userStore.homePage, userStore.cloudDiskPage, userStore.heartbeatPage, userStore.audioMatchPage, userStore.toplistPage],
    updateTracker
  )
  onMounted(() => {
    updateTracker()
    window.addEventListener('resize', updateTracker)
  })
  onBeforeUnmount(() => {
    window.removeEventListener('resize', updateTracker)
  })

  // 首次启动时自定义字体可能尚未加载，按钮宽度按回退字体测量会导致下划线偏移；
  // 字体加载完成后与短延时兜底各校准一次
  if (document.fonts) document.fonts.ready.then(() => updateTracker())
  setTimeout(updateTracker, 600)

  // 页面切换动画：按导航序（首页→云盘→心动→识曲→我的音乐→搜索→设置）决定水平滑动方向
  const routeOrder = { login: -1, homepage: 0, toplist: 1, clouddisk: 2, heartbeat: 3, audiomatch: 4, mymusic: 5, mv: 6, search: 7, settings: 8 }
  let prevRouteName = null
  watch(() => route.name, (to, from) => { prevRouteName = from })
  const pageTransition = computed(() => {
    const to = routeOrder[route.name] ?? 0
    const from = routeOrder[prevRouteName] ?? 0
    return from > to ? 'page-nav-left' : 'page-nav-right'
  })

  const toSettings = () => {
      router.push('/settings')
  }
  const userLogout = () => {
    if(isLogin()){
      logout().then(async (result) => {
        if(result.code == 200) {
            if (isHydrogenWeb()) {
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
      }).catch(() => {
        // 网络失败已由请求拦截器统一提示，这里兜底避免未处理 rejection
      })
    } else noticeOpen("您已退出账号", 2)
  }
  const onAfterEnter = () => isActive.value = true
  const onAfterLeave = () => isActive.value = false
</script>

<template>
  <div>
    <main>
      <div class="home-header">
        <div class="header-router" :class="{'router-closed': !userStore.homePage && !userStore.cloudDiskPage}">
          <!-- <div class="logout" @click="userLogout()">退出登录</div> -->
          <router-link class="button-home" :style="{color: router.currentRoute.value.name == 'homepage' ? 'black' : '#353535'}" to="/" v-if="userStore.homePage">首页</router-link>
          <router-link class="button-toplist" :style="{color: router.currentRoute.value.name == 'toplist' ? 'black' : '#353535'}" to="/toplist" v-if="userStore.toplistPage">排行</router-link>
          <router-link class="button-cloud" :style="{color: router.currentRoute.value.name == 'clouddisk' ? 'black' : '#353535'}" to="/cloud" v-if="userStore.cloudDiskPage">云盘</router-link>
          <router-link class="button-heartbeat" :style="{color: router.currentRoute.value.name == 'heartbeat' ? 'black' : '#353535'}" to="/heartbeat" v-if="userStore.heartbeatPage">心动</router-link>
          <router-link class="button-match" :style="{color: route.name == 'audiomatch' ? 'black' : '#353535'}" to="/audiomatch" v-if="userStore.audioMatchPage">听歌识曲</router-link>
          <router-link class="button-mv" :style="{color: route.name == 'mv' ? 'black' : '#353535'}" to="/mv">MV</router-link>
          <router-link class="button-music" :style="{color: route.name == 'mymusic' ? 'black' : '#353535'}" to="/mymusic" v-if="userStore.homePage || userStore.cloudDiskPage || userStore.audioMatchPage">我的音乐</router-link>
          <div class="user">
            <div class="user-container">
              <div class="user-head" @click="userStore.appOptionShow = true">
                <img v-if="isLogin() && userStore.user" :src="userStore.user.avatarUrl + '?param=100y100'" alt="">
                <svg v-else t="1672136404205" class="icon" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg" p-id="5403" width="200" height="200"><path d="M511.997 551.041c-218.044 0-399.92 168.61-441.722 392.645l883.45-0.439C911.607 719.432 729.83 551.041 511.997 551.041zM266.597 305.64c0 135.532 109.868 245.401 245.403 245.401 135.53 0 245.403-109.87 245.403-245.4C757.403 170.105 647.53 60.235 512 60.235c-135.535 0-245.403 109.87-245.403 245.406z" fill="#2c2c2c" p-id="5404" data-spm-anchor-id="a313x.7781069.0.i5" class="selected"></path></svg>
                <div class="img-mask"></div>
              </div>
              <transition name="app-option" @after-enter="onAfterEnter" @after-leave="onAfterLeave">
                <div class="app-option" :class="{ 'app-option-active': isActive }" v-show="userStore.appOptionShow">
                  <div class="option" @click="toSettings()">设置</div>
                  <div class="option" @click="userLogout()">退出登录</div>
  
                  <div class="option-style option-style1"></div>
                  <div class="option-style option-style2"></div>
                  <div class="option-style option-style3"></div>
                  <div class="option-style option-style4"></div>
                </div>
              </transition>
            </div>
          </div>
          <div v-show="route.name != 'search' && route.name != 'settings'" class="router-tracker" :style="{left: trackerLeft + 'px', width: trackerWidth + 'px'}">
          </div>
        </div>
      </div>
      
      <div class="home-content">
        <router-view v-slot="{ Component }" v-if="route.name !== 'mv'">
          <Transition :name="pageTransition" mode="out-in">
            <keep-alive>
              <component :is="Component"></component>
            </keep-alive>
          </Transition>
        </router-view>
      </div>
    </main>
  </div>
</template>

<style scoped lang="scss">
  main{
    height: 100%;
  }
  
  /* 窄窗口时收紧导航间距，给左右悬浮层留出空间 */
  @media (min-width: 1181px) and (max-width: 1440px){
    .header-router .button-home, .header-router .button-cloud,
    .header-router .button-match, .header-router .button-heartbeat,
    .header-router .button-toplist, .header-router .button-mv {
      margin-right: 26px;
    }
  }

  .home-header{
    margin: 30px 0 20px 0;
    /* 独立层级：保证头像/设置下拉（.user z-9999）永远压过页面内容 */
    position: relative;
    z-index: 10;
    display: flex;
    flex-direction: row;
    justify-content: center;
    align-items: center;
    .header-router{
      position: relative;
      a{
        font: 18px SourceHanSansCN-Bold;
        color: black;
        outline: none;
      }
      .button-home{
        margin-right: 40px;
      }
      .button-cloud{
        margin-right: 40px;
      }
      .button-match{
	        margin-right: 40px;
	      }
	      .button-heartbeat{
	        margin-right: 40px;
	      }
	      .button-toplist{
          margin-right: 40px;
      }
      .button-mv {
        margin-right: 40px;
	      }
	      .router-tracker{
        height: 2px;
        background-color: black;
        position: absolute;
        transition: 0.3s;
        bottom: 0;
      }
      .user{
        position: absolute;
        top: 50%;
        right: -35px;
        transform: translateY(-50%);
        /* 头像/设置下拉需要压过所有页面内容（mainWindow__content 的 container-type 会创建层叠上下文） */
        z-index: 9999;
        .user-container{
          width: 25px;
          height: 25px;
          position: relative;
          .user-head{
            width: 100%;
            height: 100%;
            border: 1px solid rgb(0, 0, 0, 0.6);
            border-radius: 50%;
            overflow: hidden;
            position: relative;
            &:hover{
              cursor: pointer;
            }
            img, svg{
              width: 100%;
              height: 100%;
            }
            svg{
              margin-top: 2px;
            }
            .img-mask{
              width: 100%;
              height: 100%;
              background-color: rgba(0, 0, 0, 0.3);
              opacity: 0;
              position: absolute;
              top: 0;
              left: 0;
              transition: 0.15s;
              &:hover{
                opacity: 1;
              }
            }
          }
          .app-option{
            padding: 0;
            width: 100px;
            height: 0;
            background-image: url('../assets/img/halftone.png');
            background-size: 120%;
            background-repeat: repeat;
            background-color: rgb(20, 20, 20);
            overflow: hidden;
            position: absolute;
            top: 35px;
            left: -32.5px;
            &-active {
              height: 96px;padding: 12Px 0;
            }
            .option{
              padding: 8px 14px;
              font: 14Px SourceHanSansCN-Bold;
              color: white;
              text-align: left;
              transition: 0.2s;
              &:hover{
                cursor: pointer;
                background-color: rgba(53, 53, 53, 0.7);
              }
              &:active{
                transform: scale(0.95);
              }
            }
            .option-style{
              width: 4px;
              height: 4px;
              background-color: white;
              position: absolute;
            }
            $stylePosition: 4px;
            .option-style1{
              top: $stylePosition;
              left: $stylePosition;
            }
            .option-style2{
              top: $stylePosition;
              right: $stylePosition;
            }
            .option-style3{
              bottom: $stylePosition;
              right: $stylePosition;
            }
            .option-style4{
              bottom: $stylePosition;
              left: $stylePosition;
            }
          }
        }
      }
    }
    .router-closed{
      width: 100%;
      height: 27px;
      .user{
        width: 30px;
        position: absolute;
        left: 365px;
        transform: translateY(-55%);
        z-index: 999;
      }
    }
  }

  @media (max-width: 1180px) {
    .home-header {
      margin: 66px 0 14px;
      padding: 0 14px;
      justify-content: flex-start;
    }
    .home-header .header-router:not(.router-closed) {
      display: flex;
      align-items: center;
      justify-content: space-between;
      width: 100%;
      padding-right: 32px;
      min-width: 0;
    }
    .header-router a {
      flex: 0 0 auto;
      margin-right: 0 !important;
      font-size: 16px !important;
      white-space: nowrap;
    }
    .header-router .user { right: 0; }
    .home-header .router-tracker { display: none; }
  }

  @media (max-width: 960px) {
    .home-header {
      margin: 82px 0 14px;
      padding: 0 12px;
      justify-content: flex-start;
    }
    .home-header .header-router:not(.router-closed) {
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex: 1;
      min-width: 0;
    }
    .header-router a {
      flex: 0 0 auto;
      margin-right: 0 !important;
      font-size: 14px !important;
      white-space: nowrap;
    }
    .header-router .button-match { display: none; }
    .header-router .user { right: -32px; }
    .home-header .router-tracker { display: none; }
  }

  .home-content{
    padding: 0 45px;
    height: calc(100% + 1px);
    overflow: auto;
    overflow-x: hidden;
    &::-webkit-scrollbar{
      display: none;
    }
  }
</style>

<style lang="scss">
.app-option-enter-active {
  animation: app-option-in 0.2s forwards;

}
.app-option-leave-active {
  animation: app-option-in 0.2s reverse;
}
@keyframes app-option-in {
  0%{height: 0;padding: 0;}
  100%{height: 96px;padding: 12Px 0;}
}
</style>