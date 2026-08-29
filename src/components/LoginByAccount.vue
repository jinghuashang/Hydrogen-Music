<script setup>
  import { ref, computed, onActivated, onDeactivated, onBeforeUnmount } from 'vue'
  import DataCheckAnimaton from './DataCheckAnimaton.vue';
  import md5 from 'js-md5';
  import { noticeOpen } from '../utils/dialog';
  import { loginByEmail, loginByPhone, sendCaptcha } from '../api/login'
  import { loginHandle } from '../utils/handle'

  const props = defineProps(['currentMode'])
  const accountInput = ref()
  const countrycode = ref('+86')
  const accountNumber = ref('')
  const typePassword = ref('')
  const captchaCode = ref('')
  const focusTimer = ref(null)
  const emits = defineEmits(['jumpTo'])

  // 登录方式：'password' 或 'captcha'
  const loginType = ref('password')
  const captchaSent = ref(false)
  const captchaCountdown = ref(0)
  const sendingCaptcha = ref(false)
  let countdownTimer = null

  const stopCaptchaCountdown = () => {
    if(countdownTimer) {
      clearInterval(countdownTimer)
      countdownTimer = null
    }
  }

  const loginAnimation = ref(false)
  const dataCheckAnimaton = ref(null)

  const canSendCaptcha = computed(() => {
    return accountNumber.value.trim() !== '' && captchaCountdown.value === 0 && !sendingCaptcha.value
  })

  onActivated(() => {
    accountInput.value.focus()
  })

  // 组件在 keep-alive 中，onBeforeUnmount 不会因页面切换触发，需同时挂 onDeactivated
  onDeactivated(stopCaptchaCountdown)
  onBeforeUnmount(stopCaptchaCountdown)

  const inputFocus = () => {
    accountNumber.value = ''
    typePassword.value = ''
    captchaCode.value = ''
    loginType.value = 'password'
    captchaSent.value = false
    stopCaptchaCountdown()
    captchaCountdown.value = 0
    sendingCaptcha.value = false
    focusTimer.value = setTimeout(() => {
      accountInput.value.focus()
      clearTimeout(focusTimer.value)
    }, 1);
  }
  defineExpose({inputFocus})

  const checkMail = () => {
    const emailReg = /^[a-zA-Z0-9_-]+@[a-zA-Z0-9_-]+(\.[a-zA-Z0-9_-]+)+$/
    if(accountNumber.value === '' || typePassword.value === '') {
      noticeOpen("请输入正确的邮箱或密码！", 2)
      return false
    } else if (emailReg.test(accountNumber.value)) {
      return true
    } else {
      noticeOpen("请输入正确的邮箱", 2)
      return false
    }
  }

  const checkPhone = () => {
    if(countrycode.value === '' || accountNumber.value === '') {
      noticeOpen("请输入手机号！", 2)
      return false
    }
    if(loginType.value === 'password' && typePassword.value === '') {
      noticeOpen("请输入密码！", 2)
      return false
    }
    if(loginType.value === 'captcha' && captchaCode.value === '') {
      noticeOpen("请输入验证码！", 2)
      return false
    }
    return true
  }

  // 发送验证码
  async function handleSendCaptcha() {
    if(!canSendCaptcha.value || sendingCaptcha.value) return
    const phone = accountNumber.value.replace(/\s/g, '')
    if(!phone) {
      noticeOpen("请先输入手机号", 2)
      return
    }
    sendingCaptcha.value = true
    try {
      const params = {
        ctcode: countrycode.value.replace('+', '').replace(/\s/g, ''),
        phone: phone
      }
      const result = await sendCaptcha(params)
      if(result.code === 200) {
        captchaSent.value = true
        noticeOpen("验证码已发送", 1)
        // 开始倒计时
        stopCaptchaCountdown()
        captchaCountdown.value = 60
        countdownTimer = setInterval(() => {
          captchaCountdown.value--
          if(captchaCountdown.value <= 0) stopCaptchaCountdown()
        }, 1000)
      } else {
        noticeOpen(result.message || "发送验证码失败", 2)
      }
    } catch(e) {
      noticeOpen("发送验证码失败，请稍后重试", 2)
    } finally {
      sendingCaptcha.value = false
    }
  }

  // 切换登录方式
  function toggleLoginType() {
    loginType.value = loginType.value === 'password' ? 'captcha' : 'password'
    typePassword.value = ''
    captchaCode.value = ''
    stopCaptchaCountdown()
    captchaCountdown.value = 0
  }

  async function login() {
    if(props.currentMode == 0) {
      //邮箱登录
      if(checkMail()) {
        let params = {
          email: accountNumber.value.replace(/\s/g, ''),
          password: 'none',
          md5_password: md5(typePassword.value)
        }
        loginAnimation.value = true
        try {
          const result = await loginByEmail(params)
          if(result.code == 200) {
            loginSuccess(result)
          } else {
            loginError()
          }
        } catch(e) {
          loginError()
        }
      }
    } else if(props.currentMode == 1) {
      //手机登录
      if(checkPhone()) {
        loginAnimation.value = true
        let params
        if(loginType.value === 'password') {
          // 密码登录
          params = {
            phone: accountNumber.value.replace(/\s/g, ''),
            password: 'none',
            countrycode: countrycode.value.replace('+', '').replace(/\s/g, ''),
            md5_password: md5(typePassword.value)
          }
        } else {
          // 验证码登录
          params = {
            phone: accountNumber.value.replace(/\s/g, ''),
            countrycode: countrycode.value.replace('+', '').replace(/\s/g, ''),
            captcha: captchaCode.value.replace(/\s/g, '')
          }
        }
        try {
          const result = await loginByPhone(params)
          if(result.code == 200) {
            loginSuccess(result)
          } else {
            loginError()
          }
        } catch(e) {
          loginError()
        }
      }
    }
  }

  async function loginSuccess(result) {
    loginHandle(result, 'account')
    emits('jumpTo')
  }

  const loginError = () => {
    dataCheckAnimaton.value.errorAnimation()
    const errorTimer = setTimeout(() => {
      loginAnimation.value = false
      clearTimeout(errorTimer)
    }, 1500);
  }

</script>

<template>
  <div class="account-container">
    <div class="account">
      <div class="account-adress">
        <label for="account" v-if="props.currentMode == 0">邮箱：</label>
        <label for="account" v-else>手机：</label>
        <div class="input-container" :class="{'login-animation': loginAnimation}">
          <input class="phone-country" type="text" v-model="countrycode" v-show="props.currentMode == 1" spellcheck="false">
          <input class="account-input" :class="{'account-input2': props.currentMode == 1}" v-model="accountNumber" type="text" name="account" ref="accountInput" spellcheck="false">
        </div>
      </div>

      <!-- 密码输入框 -->
      <div class="mail-password" v-if="props.currentMode == 0 || loginType === 'password'">
        <label for="password">密码：</label>
        <input class="password-input" :class="{'login-animation': loginAnimation}" type="password" name="password" v-model="typePassword" spellcheck="false">
        <div class="forget-password" v-if="props.currentMode == 0">
          <div class="forget-title">您忘记了密码？</div>
          <div class="password-line" :class="{'login-animation': loginAnimation}"></div>
        </div>
      </div>

      <!-- 验证码输入框 -->
      <div class="captcha-container" v-if="props.currentMode == 1 && loginType === 'captcha'">
        <label for="captcha">验证码：</label>
        <div class="captcha-input-group" :class="{'login-animation': loginAnimation}">
          <input class="captcha-input" type="text" v-model="captchaCode" placeholder="请输入验证码" maxlength="6" spellcheck="false">
          <button class="captcha-btn" :class="{'disabled': !canSendCaptcha}" @click="handleSendCaptcha()" :disabled="!canSendCaptcha">
            {{ captchaCountdown > 0 ? `${captchaCountdown}s` : '获取验证码' }}
          </button>
        </div>
      </div>

      <!-- 手机登录时显示切换登录方式 -->
      <div class="login-type-switch" v-if="props.currentMode == 1">
        <span class="switch-btn" @click="toggleLoginType()">
          {{ loginType === 'password' ? '使用验证码登录' : '使用密码登录' }}
        </span>
      </div>

      <div class="animation">
        <DataCheckAnimaton class="check-animation" ref="dataCheckAnimaton" v-if="loginAnimation"></DataCheckAnimaton>
      </div>
    </div>
    <div class="account-operation">
      <div class="login-button" @click="login()">登录</div>
    </div>
  </div>
</template>

<style scoped lang="scss">
  .account-container{
    margin-top: 7vh;
    display: flex;
    flex-direction: column;
    align-items: center;
    .account{
      position: relative;
      width: fit-content;
      .account-adress{
        margin-bottom: 3vh;
        display: flex;
        justify-content: flex-start;
        align-items: center;
        label{
          font: 2.2vh SourceHanSansCN-Bold;
          color: black;
          white-space: nowrap;
          width: 5vh;
          text-align: right;
          margin-right: 1vh;
        }
        .input-container{
          transition: 0.2s ease-out;
          .phone-country{
            margin-right: 1vh;
            width: 6vh;
            font-size: 2vh;
            color: rgb(150, 150, 150);
            font-style: italic;
            border: none;
            border-right: 0.5px solid rgb(200, 200, 200);
            background: none;
            outline: none;
          }
          .account-input{
            width: 30.2vh;
            font-size: 2.7vh;
            color: black;
            font-style: italic;
            border: none;
            background: none;
            outline: none;
            transition: 0.2s;
          }
          .account-input2{
            width: 23.2vh;
          }
        }
      }

      .login-type-switch{
        display: flex;
        justify-content: flex-start;
        margin-top: 1.5vh;
        padding-left: 6vh;
        .switch-btn{
          font: 1.4vh SourceHanSansCN-Bold;
          color: rgb(150, 150, 150);
          cursor: pointer;
          transition: 0.2s;
          &:hover{
            color: black;
          }
        }
      }

      .mail-password{
        position: relative;
        margin-bottom: 2vh;
        display: flex;
        justify-content: flex-start;
        align-items: center;
        label{
          font: 2.2vh SourceHanSansCN-Bold;
          color: black;
          white-space: nowrap;
          width: 5vh;
          text-align: right;
          margin-right: 8vh;
        }
        .password-input{
          transition: 0.2s ease-out;
          width: 30.2vh;
          font-family: Password;
          font-size: 2.7vh;
          font-style: italic;
          color: black;
          border: none;
          background: none;
          outline: none;
        }
        .forget-password{
          width: 100%;
          display: flex;
          justify-content: center;
          align-items: center;
          position: absolute;
          bottom: -1.5vh;
          .forget-title{
            margin-right: 2px;
            font: 1.3vh Source Han Sans;
            color: rgb(118, 118, 118);
            white-space: nowrap;
          }
          .password-line{
            transition: 0.2s ease-out;
            background-color: black;
            width: 33vh;
            height: 0.5px;
          }
        }
      }

      .captcha-container{
        margin-bottom: 2vh;
        display: flex;
        justify-content: flex-start;
        align-items: center;
        label{
          font: 2.2vh SourceHanSansCN-Bold;
          color: black;
          white-space: nowrap;
          width: 5vh;
          text-align: right;
          margin-right: 8vh;
        }
        .captcha-input-group{
          display: flex;
          align-items: center;
          gap: 1vh;
          width: 30.2vh;
          .captcha-input{
            flex: 1;
            font-size: 2.7vh;
            color: black;
            border: none;
            background: none;
            outline: none;
            font-style: italic;
            letter-spacing: 2px;
            &::placeholder{
              font-size: 1.8vh;
              font-style: normal;
              color: rgb(180, 180, 180);
            }
          }
          .captcha-btn{
            padding: 0.8vh 1.5vh;
            font-size: 1.6vh;
            font-family: SourceHanSansCN-Bold;
            color: black;
            background: none;
            border: 1px solid black;
            border-radius: 0;
            cursor: pointer;
            transition: 0.2s;
            white-space: nowrap;
            &:hover:not(.disabled){
              background-color: black;
              color: white;
            }
            &.disabled{
              opacity: 0.5;
              cursor: not-allowed;
            }
          }
        }
      }

      .animation{
        display: flex;
        flex-direction: column;
        align-items: center;
        .check-animation{
          width: 19vh;
          height: 19vh;
          position: absolute;
          top: -2vh;
          transform: translateX(-10%);
        }
      }

      .login-animation{
        opacity: 0;transform: scale(0.8);
      }
    }
    .account-operation{
      margin-top: 5vh;
      display: flex;
      flex-direction: column;
      justify-content: center;
      align-items: center;
      .login-button{
        padding: 0.8vh 0;
        width: 30vh;
        border: 1px solid black;
        font: 14px SourceHanSansCN-Bold;
        color: black;
        position: relative;
        &:hover{
          cursor: pointer;
          background-color: black;
          color: white;
          &::before, &::after{
            opacity: 1;
          }
          &::before{
            left: -40px;
          }
          &::after{
            right: -40px;
        }
        }
        &::before, &::after{
          content: '';
          width: 30px;
          height: 1px;
          position: absolute;
          top: 50%;
          transform: translateY(-50%);
          opacity: 0;
          transition: 0.1s;
        }
        &::before{
          background: linear-gradient(to left, black 20%, rgba(0, 0, 0, 0.05));
          left: -50px;
        }
        &::after{
          background: linear-gradient(to right, black 20%, rgba(0, 0, 0, 0.05));
          right: -50px;
        }
      }
    }
  }
</style>