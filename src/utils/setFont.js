export const insertCustomFontStyle = (customFont) => {
  if (!document) return
  const head = document.querySelector('head')
  // 仅允许合法字体族名，避免 CSS 注入（闭合 local(...) 注入任意样式）
  const safe = String(customFont || '').replace(/[^\w\s\u4e00-\u9fa5-]/g, '').slice(0, 128)

  if (!safe) {
    head.querySelector('#__CUSTOM_FONT__')?.remove()
  }
  else {
    const str = `
    @font-face {
      font-family: SourceHanSansCN-Bold;
            font-weight: 'bold';
      src: local(${safe});
    }`, el = head.querySelector('#__CUSTOM_FONT__')
    if (el) {
      el.innerHTML = str
    }
    else {
      const style = document.createElement('style')
      style.setAttribute('id', '__CUSTOM_FONT__')
      style.innerHTML = str
      head.appendChild(style)
    }
  }
}