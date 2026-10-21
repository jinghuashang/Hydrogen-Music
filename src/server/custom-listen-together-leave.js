// 自定义一起听退出房间 — 上游 api-enhanced 未内置 leave 模块。
// 依次尝试已知的官方路径；都失败时返回最后一次响应，由渲染层降级为本地退出。
const createOption = require('@neteasecloudmusicapienhanced/api/util/option')

const LEAVE_PATHS = [
  '/api/listen/together/leave',
  '/api/listen/together/room/leave',
]

module.exports = async (query, request) => {
  const data = {
    roomId: query.roomId,
  }
  let last = null
  for (const path of LEAVE_PATHS) {
    try {
      const res = await request(path, data, createOption(query))
      last = res
      if (res?.body?.code === 200) return res
    } catch (_) {
      // 继续尝试下一个路径
    }
  }
  return last || { status: 404, body: { code: 404, message: 'leave not supported' } }
}
