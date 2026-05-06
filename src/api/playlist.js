import request from "../utils/request";

/**
 * 获取推荐歌单（偏编辑推荐 / 热门，未登录也可用）
 * @param {number} num
 */
export function getRecommendedSongList(num) {
    return request({
        url: '/personalized',
        method: 'get',
        params: {
            limit: num
        }
    })
}

/**
 * 首页-发现 block page（移动端首页结构，与官方 App「发现」推荐流接近，需完整 cookie）
 * @param {boolean} refresh 是否刷新（避免喂缓存）
 */
export function getHomepageBlockPage(refresh = true) {
    return request({
        url: '/homepage/block/page',
        method: 'get',
        params: {
            refresh,
            timestamp: Date.now(),
        },
    })
}

/**
 * 每日推荐歌单（discovery；需登录）
 */
export function getRecommendResource() {
    return request({
        url: '/recommend/resource',
        method: 'get',
        params: {
            timestamp: Date.now(),
        },
    })
}

/**
 * 按 id 去重合并歌单列表，最多保留 limit 条
 */
export function mergePlaylistsById(primary, more, limit) {
    const seen = new Set(primary.map((p) => p.id))
    const out = [...primary]
    for (const p of more) {
        if (!p?.id || seen.has(p.id)) continue
        seen.add(p.id)
        out.push(p)
        if (out.length >= limit) break
    }
    return out
}

function extractPlaylistNodesDeep(root, maxDepth, depth, seen, acc) {
    if (depth > maxDepth || root == null || typeof root !== 'object') return
    const nested = root.playlist
    if (
        nested &&
        nested.id != null &&
        nested.name &&
        !seen.has(nested.id)
    ) {
        seen.add(nested.id)
        acc.push(nested)
    }
    for (const k of Object.keys(root)) {
        const v = root[k]
        if (Array.isArray(v)) {
            for (const item of v)
                extractPlaylistNodesDeep(item, maxDepth, depth + 1, seen, acc)
        } else if (typeof v === 'object') {
            extractPlaylistNodesDeep(v, maxDepth, depth + 1, seen, acc)
        }
    }
}

/**
 * 解析 /homepage/block/page，抽取「推荐歌单」类资源（resourceType 多为 list）
 */
export function playlistsFromHomepageBlockPage(body) {
    if (!body || body.code !== 200) return []
    const data = body.data
    if (!data || typeof data !== 'object') return []
    const blocks = data.blocks
    if (!Array.isArray(blocks)) return []

    const out = []
    const seen = new Set()
    const tryPush = (id, name, cover) => {
        if (id == null || name == null) return
        const s = String(name).trim()
        if (!s) return
        const nid =
            typeof id === 'string' && /^\d+$/.test(id) ? Number(id) : id
        if (seen.has(nid)) return
        seen.add(nid)
        out.push({
            id: nid,
            name: s,
            coverImgUrl: cover || '',
            picUrl: cover || '',
        })
    }

    const playlistBlockRe = /PLAYLIST|SONGLIST|歌单|RCMD|个性化|推荐/i

    for (const block of blocks) {
        const blockHint =
            playlistBlockRe.test(String(block.blockCode || '')) ||
            playlistBlockRe.test(String(block.showType || ''))
        const creatives = block.creatives || []
        for (const creative of creatives) {
            const resources = creative.resources || []
            for (const res of resources) {
                const rt = String(res.resourceType || '').toLowerCase()
                const id = res.resourceId ?? res.id
                const ui = res.uiElement || {}
                const mt = ui.mainTitle
                const title =
                    (typeof mt === 'object' && mt != null && mt.title) ||
                    (typeof mt === 'string' ? mt : '') ||
                    ui.title ||
                    ''
                const img =
                    ui.image?.imageUrl ||
                    ui.image?.url ||
                    res.coverUrl ||
                    ''

                const looksPlaylist =
                    rt === 'list' ||
                    rt === 'playlist' ||
                    (blockHint && id && title)

                if (looksPlaylist && id && title) tryPush(id, title, img)
            }
        }
    }
    return out
}

/**
 * 将 /recommend/resource 响应解析为歌单列表（兼容 recommend / feature / 嵌套 playlist）
 */
export function playlistsFromRecommendResource(body) {
    if (!body || body.code !== 200) return []
    const out = []
    const seen = new Set()
    const tryPush = (pl) => {
        if (!pl || pl.id == null || seen.has(pl.id)) return
        seen.add(pl.id)
        out.push(pl)
    }
    const collectFromArray = (arr) => {
        if (!Array.isArray(arr)) return
        for (const item of arr) {
            const pl =
                item?.playlist ||
                item?.resource?.playlist ||
                (item?.resource?.name != null && item?.resource?.id != null
                    ? item.resource
                    : null) ||
                (item?.id != null && item?.name != null ? item : null)
            tryPush(pl)
        }
    }
    collectFromArray(body.recommend)
    collectFromArray(body.feature)
    collectFromArray(body.result)
    if (body.data) {
        collectFromArray(body.data.recommend)
        collectFromArray(body.data.feature)
    }
    if (!out.length) {
        extractPlaylistNodesDeep(body, 12, 0, seen, out)
    }
    return out
}

export function getTopList() {
    return request({
      url: '/toplist',
      method: 'get',
      params: {

      }
    });
}

/**
 * 获取歌单详情
 * 说明 : 歌单能看到歌单名字, 但看不到具体歌单内容 , 调用此接口 , 传入歌单 id, 
 * 可以获取对应歌单内的所有的音乐(未登录状态只能获取不完整的歌单,登录后是完整的)，
 * 但是返回的 trackIds 是完整的，tracks 则是不完整的，可拿全部 trackIds 请求一次 song/detail 
 * 接口获取所有歌曲的详情 (https://github.com/Binaryify/NeteaseCloudMusicApi/issues/452)
 * @returns 
 */
export function getPlaylistDetail(params) {
    return request({
      url: '/playlist/detail',
      method: 'get',
      params,
    });
}

/**
 * 说明 : 由于网易云接口限制，歌单详情只会提供 10 首歌，通过调用此接口，传入对应的歌单id，即可获得对应的所有歌曲
 * 必选参数 : id : 歌单 id
 * 可选参数 : limit : 限制获取歌曲的数量，默认值为当前歌单的歌曲数量
 * 可选参数 : offset : 默认值为0
 * @param {*} params 
 * @returns 
 */
export function getPlaylistAll(params) {
    return request({
      url: '/playlist/track/all',
      method: 'get',
      params,
    });
}

/**
 * 调用此接口 , 可获得每日推荐歌曲 ( 需要登录 )
 * @returns 
 */
export function getRecommendSongs(params) {
    return request({
      url: '/recommend/songs',
      method: 'get',
      params: {
        
      },
    });
}

/**
 * 说明 : 调用此接口 , 传入类型和歌单 id 可收藏歌单或者取消收藏歌单
 * 必选参数 :
 * t : 类型,1:收藏,2:取消收藏 id : 歌单 id
 * @param {*} params 
 * @returns 
 */
export function subPlaylist(params) {
    return request({
      url: '/playlist/subscribe',
      method: 'get',
      params,
    });
}

/**
 * 说明 : 调用后可获取歌单详情动态部分,如评论数,是否收藏,播放数
 * 必选参数 : id : 歌单 id
 * @param {*} params 
 * @returns 
 */
export function playlistDynamic(id) {
    return request({
      url: '/playlist/detail/dynamic',
      method: 'get',
      params: {
        id: id,
        timestamp: new Date().getTime(),
      }
    });
}

/**
 * 说明 : 调用此接口 , 传入歌单名字可新建歌单
 * 必选参数 : name : 歌单名
 * 可选参数 :
 * privacy : 是否设置为隐私歌单，默认否，传'10'则设置成隐私歌单
 * type : 歌单类型,默认'NORMAL',传 'VIDEO'则为视频歌单,传 'SHARED'则为共享歌单
 * @param {*} params 
 * @returns 
 */
export function createPlaylist(params) {
  return request({
    url: '/playlist/create',
    method: 'post',
    params,
  });
}

/**
 * 必选参数 :
 * op: 从歌单增加单曲为 add, 删除为 del
 * pid: 歌单 id tracks: 歌曲 id,可多个,用逗号隔开
 * @param {*} params 
 * @returns 
 */
export function updatePlaylist(params) {
    return request({
      url: '/playlist/tracks',
      method: 'post',
      params,
    });
}

/**
 * 说明 : 调用此接口 , 传入歌单 id 可删除歌单
 * 必选参数 : id : 歌单 id,可多个,用逗号隔开
 * @param {*} params 
 * @returns 
 */
export function deletePlaylist(params) {
    return request({
      url: '/playlist/delete',
      method: 'post',
      params,
    });
}