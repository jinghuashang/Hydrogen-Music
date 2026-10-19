const createOption = require('@neteasecloudmusicapienhanced/api/util/option')

// 云盘歌曲删除模块（支持单曲及批量 ID 删除）
module.exports = (query, request) => {
  // 还原可能被 __proto__ 注入的原型，再剥离控制参数
  if (Object.getPrototypeOf(query) !== Object.prototype) Object.setPrototypeOf(query, Object.prototype)
  // 安全：禁止调用方指定上游域名/代理/请求头（SSRF）
  delete query.domain
  delete query.proxy
  delete query.headers
  const songIds = typeof query.id === 'string'
    ? query.id.split(',').map(id => id.trim()).filter(Boolean)
    : (Array.isArray(query.id) ? query.id : [query.id])

  const data = {
    songIds,
  }
  return request('/api/cloud/del', data, createOption(query, 'weapi'))
}
