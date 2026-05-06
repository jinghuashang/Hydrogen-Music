/**
 * 本地目录设置（下载 / 视频缓存 / 扫描目录）的路径规范化。
 * 不依赖 Node path 模块，可在渲染进程与 Web 端使用。
 */

/**
 * 去空白、去掉末尾多余斜杠，便于展示与去重（兼容 `/home/foo/` 与 `C:\Music\`）。
 * @param {string|null|undefined} raw
 * @returns {string|null}
 */
export function normalizeLocalDirPath(raw) {
    if (raw == null || typeof raw !== 'string') return null
    let s = raw.trim()
    if (!s) return null
    s = s.replace(/[/\\]+$/, '')
    return s || null
}

/**
 * 比较两目录路径是否相同（忽略末尾斜杠与 Windows 反斜杠差异）。
 */
export function localDirPathEquals(a, b) {
    const na = normalizeLocalDirPath(a)
    const nb = normalizeLocalDirPath(b)
    if (!na || !nb) return false
    return na.replace(/\\/g, '/') === nb.replace(/\\/g, '/')
}
