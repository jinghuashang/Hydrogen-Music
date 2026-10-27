<script setup>
  import { ref, computed, watch, nextTick, onMounted, onBeforeUnmount } from 'vue';
  import { useRouter, useRoute } from 'vue-router';
  import { logout } from '../api/user'
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
  /** 窗口较窄、搜索框让出第一行（落到标题下方），导航仍占第一行 */
  const searchStacked = ref(false)
  /** 再窄一些、导航在第一行也放不下时，整排导航下移到第二行 */
  const headerStacked = ref(false)
  let layoutObserver = null

  function updateTracker() {
    nextTick(() => {
      const headerRouter = document.querySelector('.header-router')
      // 顶部第一行的排布优先级：
      // 1. 搜索框留在标题右侧、导航跟在搜索框后（一行放下所有东西）
      // 2. 搜索框落到标题下方，把第一行让给导航（导航不下移，见 .widget-compact）
      // 3. 导航在第一行也放不下时，整排导航下移到第二行
      // 注意：偏移用 left 而非 transform——transform 会在 .header-router 上创建层叠上下文，
      // 把 .user（z-9999）关押在内，导致设置下拉被页面内容遮挡
      if (headerRouter) {
        const winWidth = window.innerWidth
        const routerWidth = headerRouter.getBoundingClientRect().width
        if (routerWidth > 0) {
          const globalWidget = document.querySelector('.globalWidget')
          const titleEl = document.querySelector('.widget-title')
          const searchEl = document.querySelector('.widget-search')
          // 关键：这里只能用与当前排布无关的尺寸，否则「紧凑」会把悬浮层量窄，
          // 下一轮又判定成放得下，两种排布会互相触发、界面反复闪烁
          const titleRight = titleEl ? titleEl.getBoundingClientRect().right : 0
          // 搜索框在标题右侧时的占宽：间隙 30Px（见 App.vue .widget-search），聚焦后加宽到 160Px
          const searchWidth = Math.max(searchEl ? searchEl.getBoundingClientRect().width : 0, 160)
          // 一行放下全部内容时，左侧需要让开「标题 + 搜索框」，再留 24Px 呼吸位
          const inlineLimit = titleRight + 30 + searchWidth + 24
          // 搜索框下移后，左侧只需要让开标题
          const compactLimit = titleRight + 16
          // 右侧窗口控制按钮区（约 190Px，含头像外挂）
          const maxRight = winWidth - 190
          const fitsInline = routerWidth <= maxRight - inlineLimit
          const fitsCompact = routerWidth <= maxRight - compactLimit
          const wasStacked = headerStacked.value
          headerStacked.value = !fitsInline && !fitsCompact
          const wasSearchStacked = searchStacked.value
          searchStacked.value = !fitsInline && fitsCompact
          if (globalWidget && wasSearchStacked !== searchStacked.value) {
            globalWidget.classList.toggle('widget-compact', searchStacked.value)
          }
          const leftLimit = searchStacked.value ? compactLimit : inlineLimit
          if (!headerStacked.value) {
            const desiredLeft = (winWidth - routerWidth) / 2
            // 先保证不压到左侧悬浮层，再保证不进入右侧按钮区（可能为负，表示需要往左挪）
            const shift = Math.min(Math.max(leftLimit - desiredLeft, 0), maxRight - routerWidth - desiredLeft)
            headerRouter.style.left = shift !== 0 ? `${shift}px` : ''
          } else {
            headerRouter.style.left = ''
          }
          // 堆叠状态切换会改变导航位置，等布局落定后再量下划线
          if (wasStacked !== headerStacked.value) {
            nextTick(updateTracker)
            return
          }
        }
      }

      const routeName = route.name
      let targetClass = ''
      if (routeName === 'homepage') targetClass = 'button-home'
      else if (routeName === 'clouddisk') targetClass = 'button-cloud'
      else if (routeName === 'heartbeat') targetClass = 'button-heartbeat'
      else if (routeName === 'listentogether') targetClass = 'button-together'
      else if (routeName === 'audiomatch') targetClass = 'button-match'
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
    () => [userStore.homePage, userStore.cloudDiskPage, userStore.heartbeatPage, userStore.listenTogetherPage, userStore.audioMatchPage, userStore.toplistPage],
    updateTracker
  )
  onMounted(() => {
    updateTracker()
    window.addEventListener('resize', updateTracker)
    // 首帧可能拿到尚未加载字体的宽度，挂载后导航/搜索框尺寸变化也要重算排布
    if (window.ResizeObserver) {
      const routerEl = document.querySelector('.header-router')
      const widgetEl = document.querySelector('.globalWidget')
      layoutObserver = new ResizeObserver(() => updateTracker())
      if (routerEl) layoutObserver.observe(routerEl)
      if (widgetEl) layoutObserver.observe(widgetEl)
    }
  })
  onBeforeUnmount(() => {
    window.removeEventListener('resize', updateTracker)
    if (layoutObserver) {
      layoutObserver.disconnect()
      layoutObserver = null
    }
  })

  // 首次启动时自定义字体可能尚未加载，按钮宽度按回退字体测量会导致下划线偏移；
  // 字体加载完成后与短延时兜底各校准一次
  if (document.fonts) document.fonts.ready.then(() => updateTracker())
  setTimeout(updateTracker, 600)

  // 页面切换动画：按导航序（首页→云盘→心动→识曲→我的音乐→搜索→设置）决定水平滑动方向
  const routeOrder = { login: -1, homepage: 0, toplist: 1, clouddisk: 2, heartbeat: 3, listentogether: 4, audiomatch: 5, mymusic: 6, search: 7, settings: 8 }
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
      <div class="home-header" :class="{ 'header-stacked': headerStacked, 'header-compact': searchStacked }">
        <div class="header-router" :class="{'router-closed': !userStore.homePage && !userStore.cloudDiskPage}">
          <!-- <div class="logout" @click="userLogout()">退出登录</div> -->
          <router-link class="button-home" :style="{color: router.currentRoute.value.name == 'homepage' ? 'black' : '#353535'}" to="/" v-if="userStore.homePage">首页</router-link>
          <router-link class="button-toplist" :style="{color: router.currentRoute.value.name == 'toplist' ? 'black' : '#353535'}" to="/toplist" v-if="userStore.toplistPage">排行</router-link>
          <router-link class="button-cloud" :style="{color: router.currentRoute.value.name == 'clouddisk' ? 'black' : '#353535'}" to="/cloud" v-if="userStore.cloudDiskPage">云盘</router-link>
          <router-link class="button-heartbeat" :style="{color: router.currentRoute.value.name == 'heartbeat' ? 'black' : '#353535'}" to="/heartbeat" v-if="userStore.heartbeatPage">心动</router-link>
          <router-link class="button-together" :style="{color: router.currentRoute.value.name == 'listentogether' ? 'black' : '#353535'}" to="/listentogether" v-if="userStore.listenTogetherPage">一起听</router-link>
          <router-link class="button-match" :style="{color: router.currentRoute.value.name == 'audiomatch' ? 'black' : '#353535'}" to="/audiomatch" v-if="userStore.audioMatchPage">听歌识曲</router-link>
          <router-link class="button-music" :style="{color: router.currentRoute.value.name == 'mymusic' ? 'black' : '#353535'}" to="/mymusic" v-if="userStore.homePage || userStore.cloudDiskPage || userStore.audioMatchPage">我的音乐</router-link>
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
        <router-view v-slot="{ Component }">
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
  @media (max-width: 1180px){
    .header-router .button-home, .header-router .button-cloud,
    .header-router .button-match, .header-router .button-heartbeat,
    .header-router .button-together, .header-router .button-toplist{
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
    /* 所有页签都开启且窗口较窄时，导航整排下移到品牌/搜索框下方，避免重叠 */
    &.header-stacked{
      margin-top: 66Px;
    }
    /* 搜索框落到标题下方后占住了第一行以下的空间，页面内容需要让出这段高度 */
    &.header-compact{
      margin-bottom: 36Px;
    }
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
	      .button-together{
	        margin-right: 40px;
	      }
	      .button-toplist{
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