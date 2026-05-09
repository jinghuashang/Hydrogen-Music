import request from '../utils/request'

export function audioMatch(duration, audioFP) {
  return request({
    url: '/audio/match',
    method: 'post',
    params: {
      duration,
      audioFP,
    },
  })
}
