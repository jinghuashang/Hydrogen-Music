import request from "../utils/request";

/**
 * 说明 : 登录后调用此接口 , 可获取云盘数据 , 获取的数据没有对应 url, 需要再调用一 次 /song/url 获取 url
 * 可选参数 :
 * limit : 返回数量 , 默认为 30
 * offset : 偏移数量，用于分页 , 如 :( 页数 -1)*200, 其中 200 为 limit 的值 , 默认为 0
 * @param {*} params 
 * @returns 
 */
 export function getCloudDiskData(params) {
    return request({
        url: '/user/cloud',
        method: 'get',
        params,
    })
}

/**
 * 说明 : 登录后调用此接口 , 传入云盘歌曲 id，可获取云盘数据详情
 * 必选参数 : id: 歌曲 id,可多个,用逗号隔开
 * @param {*} params 
 * @returns 
 */
 export function getCloudDiskDetail(params) {
    return request({
        url: '/user/cloud/detail',
        method: 'get',
        params,
    })
 }
// 兼容旧拼写
export { getCloudDiskDetail as getCloudDiskDrtail }

/**
 * 说明 : 云盘歌曲歌词获取（uid: 用户 id, sid: 云盘歌曲 id）
 * @param {*} params
 * @returns
 */
export function getCloudLyric(params) {
    return request({
        url: '/cloud/lyric_get',
        method: 'get',
        params,
        // 可选增强：云盘歌词取不到时由调用方降级，不弹「请求错误」
        silent: true,
    })
}

/**
 * 说明 : 云盘歌曲匹配曲库（uid: 用户 id, sid: 云盘歌曲 id, asid: 关联的曲库歌曲 id）
 * @param {*} params
 * @returns
 */
export function getCloudMatch(params) {
    return request({
        url: '/cloud/match',
        method: 'get',
        params,
    })
}

/**
 * 说明 : 登录后调用此接口 , 可删除云盘歌曲
 * 必选参数 : id: 歌曲 id,可多个,用逗号隔开
 * @param {*} params 
 * @returns 
 */
 export function deleteCloudSong(params) {
    return request({
        url: '/user/cloud/del',
        method: 'get',
        params,
    })
}

/**
 * 说明 : 登录后调用此接口,使用'Content-Type': 'multipart/form-data'上传 mp3 formData(name 为'songFile'),可上传歌曲到云盘
 * 参考: https://github.com/Binaryify/NeteaseCloudMusicApi/blob/master/public/cloud.html
 * 支持命令行调用,参考 module_example 目录下song_upload.js
 * @param {*} params 
 * @returns 
 */
export function uploadCloudSong(formData, onUploadProgress) {
    return request({
        url: '/cloud',
        method: 'post',
        headers: {
            'Content-Type': 'multipart/form-data',
        },
        data: formData,
        params: {
            timestamp: new Date().getTime(),
        },
        onUploadProgress,
        timeout: 300000,
    })
}