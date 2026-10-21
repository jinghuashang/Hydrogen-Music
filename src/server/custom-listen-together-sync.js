// 自定义一起听共享列表命令 — 在官方 api-enhanced 模块基础上补上 playMode
// （上游模块只拼 commandType/version/randomList/displayList，播放模式会被丢弃）
const createOption = require('@neteasecloudmusicapienhanced/api/util/option')

function splitIds(value) {
  if (Array.isArray(value)) return value.map((id) => Number(id)).filter((id) => id > 0)
  return String(value || '')
    .split(',')
    .map((id) => Number(id.trim()))
    .filter((id) => id > 0)
}

module.exports = (query, request) => {
  const data = {
    roomId: query.roomId,
    playlistParam: JSON.stringify({
      commandType: query.commandType,
      version: [
        {
          userId: Number(query.userId) || 0,
          version: Number(query.version) || 0,
        },
      ],
      playMode: query.playMode || undefined,
      anchorSongId: '',
      anchorPosition: -1,
      randomList: splitIds(query.randomList),
      displayList: splitIds(query.displayList),
    }),
  }
  return request(
    '/api/listen/together/sync/list/command/report',
    data,
    createOption(query),
  )
}
