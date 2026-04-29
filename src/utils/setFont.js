export const insertCustomFontStyle = (customFont) => {
  if (!document) return
  const head = document.querySelector('head')

  if (!customFont.length) {
    head.querySelector('#__CUSTOM_FONT__')?.remove()
  }
  else {
    const str = `
    @font-face {
      font-family: SourceHanSansCN-Bold;
            font-weight: 'bold';
      src: local(${customFont});
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