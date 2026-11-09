import request from "../utils/request";

/**
 * 调用此接口获取轮播图
 * @param {number} id 
 * @returns 
 */
export function getBanner(id) {
    return request({
        url: '/banner',
        method: 'get',
        params: {
            type: id
        }
    }).then(data => {
        return data
    })
}

/**
 * 说明 : 调用此接口 , 传入搜索关键词可以搜索该音乐 / 专辑 / 歌手 / 歌单 / 用户 , 关键词可以多个 , 以空格隔开 , 如 " 周杰伦 搁浅 "( 不需要登录 ), 可通过 /song/url 接口传入歌曲 id 获取具体的播放链接
 * 必选参数 : keywords : 关键词
 * 可选参数 : limit : 返回数量 , 默认为 30 offset : 偏移数量，用于分页 , 如 : 如 :( 页数 -1)*30, 其中 30 为 limit 的值 , 默认为 0
 * type: 搜索类型；默认为 1 即单曲 , 取值意义 : 1: 单曲, 10: 专辑, 100: 歌手, 1000: 歌单, 1002: 用户, 1004: MV, 1006: 歌词, 1009: 电台, 1014: 视频, 1018:综合, 2000:声音(搜索声音返回字段格式会不一样)
 * @param {*} id 
 * @returns 
 */
// 搜索是 -460 风控的高发入口：连点/输入联想会在极短时间内打出大量并发请求。
// 这里做最小间隔 800ms 的串行节流 + 30s 短时缓存，同一关键词不重复打接口。
const SEARCH_MIN_INTERVAL = 800
const SEARCH_CACHE_TTL = 30000
const SEARCH_CACHE_LIMIT = 30
const searchCache = new Map()
let searchChain = Promise.resolve()

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

export function search(params, options = {}) {
    const cacheKey = JSON.stringify(params || {})
    const hit = searchCache.get(cacheKey)
    if (hit && Date.now() - hit.at < SEARCH_CACHE_TTL) return Promise.resolve(hit.value)

    const run = async () => {
        // 排队后再查一次缓存：并发调用会被合并成一次请求
        const cached = searchCache.get(cacheKey)
        if (cached && Date.now() - cached.at < SEARCH_CACHE_TTL) return cached.value

        await delay(SEARCH_MIN_INTERVAL)
        const result = await request({
            url: '/cloudsearch',
            method: 'get',
            params,
            ...options,
        })
        searchCache.set(cacheKey, { at: Date.now(), value: result })
        if (searchCache.size > SEARCH_CACHE_LIMIT) {
            searchCache.delete(searchCache.keys().next().value)
        }
        return result
    }

    const pending = searchChain.then(run, run)
    searchChain = pending.catch(() => {})
    return pending
}