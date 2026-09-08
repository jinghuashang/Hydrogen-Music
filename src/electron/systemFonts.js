const { exec } = require('child_process')
const os = require('os')
const fs = require('fs')
const path = require('path')

let cachedFonts = null

function getWindowsFonts() {
    return new Promise((resolve) => {
        const cmd = `powershell -NoProfile -NonInteractive -Command "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; $OutputEncoding = [System.Text.Encoding]::UTF8; Get-ItemProperty 'HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Fonts', 'HKCU:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Fonts' -ErrorAction SilentlyContinue | Get-Member -MemberType NoteProperty | Select-Object -ExpandProperty Name"`
        exec(cmd, { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024, windowsHide: true }, (err, stdout) => {
            if (err || !stdout) return resolve([])
            const lines = stdout.split(/\r?\n/)
            const set = new Set()
            for (let line of lines) {
                line = line.trim()
                if (!line || line.startsWith('PS') || line.startsWith('__')) continue
                // 移除 (TrueType)、(OpenType)、(All res) 等格式后缀
                const clean = line.replace(/\s*\([^)]*\)$/, '').trim()
                if (!clean || clean.includes('\uFFFD')) continue
                // 拆分多字体联合声明，例如 "Microsoft YaHei & Microsoft YaHei UI"
                if (clean.includes('&')) {
                    clean.split('&').forEach(f => {
                        const s = f.trim()
                        if (s && !s.includes('\uFFFD')) set.add(s)
                    })
                } else {
                    set.add(clean)
                }
            }
            resolve(Array.from(set))
        })
    })
}

function getMacFonts() {
    return new Promise((resolve) => {
        const dirs = [
            '/System/Library/Fonts',
            '/Library/Fonts',
            path.join(os.homedir(), 'Library/Fonts')
        ]
        const set = new Set()
        for (const dir of dirs) {
            try {
                if (fs.existsSync(dir)) {
                    const files = fs.readdirSync(dir)
                    for (const file of files) {
                        const ext = path.extname(file).toLowerCase()
                        if (['.ttf', '.otf', '.ttc', '.dfont'].includes(ext)) {
                            const name = path.basename(file, ext).replace(/[-_]/g, ' ')
                            if (name) set.add(name)
                        }
                    }
                }
            } catch (_) {}
        }
        resolve(Array.from(set))
    })
}

async function getSystemFonts() {
    if (cachedFonts && cachedFonts.length) {
        return cachedFonts
    }

    let fonts = []
    if (process.platform === 'win32') {
        fonts = await getWindowsFonts()
    } else if (process.platform === 'darwin') {
        fonts = await getMacFonts()
    }

    // 加入项目内置艺术字体
    const builtInFonts = [
        'Gilroy-ExtraBold',
        'SourceHanSansCN-Bold',
        'SourceHanSansCN-Heavy',
        'Bender-Bold',
        'Geometos'
    ]
    const allSet = new Set([...builtInFonts, ...fonts])
    cachedFonts = Array.from(allSet).sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'))
    return cachedFonts
}

module.exports = {
    getSystemFonts
}
