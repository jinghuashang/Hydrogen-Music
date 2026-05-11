import { createApp } from 'vue'
import App from './App.vue'

/** Web：根节点标记（可选样式/脚本识别） */
if (import.meta.env.VITE_WEB === 'true' || import.meta.env.VITE_WEB === '1') {
  document.documentElement.classList.add('hydrogen-web')
}
import router from './router/router.js'
import pinia from './store/pinia'
import { init } from './utils/initApp'
import lazy from './utils/lazy'
import './style.css'
import 'normalize.css'
import '@/assets/css/common.css'
import '@/assets/css/fonts.css'
const app = createApp(App)
app.use(router)
app.use(pinia)
app.directive('lazy', lazy)
app.mount('#app')
init().catch((e) => console.error('[init]', e))