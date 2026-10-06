import test from 'node:test'
import assert from 'node:assert/strict'
import { applyProxyEnv, buildSessionProxyConfig, isSocksProxy, normalizeProxyUrl } from '../src/server/proxyConfig.js'

test('parses the proxy forms a user may type', () => {
  assert.deepEqual(normalizeProxyUrl('http://127.0.0.1:7890'), { protocol: 'http', host: '127.0.0.1', port: 7890, url: 'http://127.0.0.1:7890', username: '', password: '' })
  assert.equal(normalizeProxyUrl('127.0.0.1:7890').url, 'http://127.0.0.1:7890')
  assert.equal(normalizeProxyUrl('socks5://127.0.0.1:1080').protocol, 'socks5')
  assert.equal(normalizeProxyUrl('user:p%40ss@10.0.0.2:8080').password, 'p@ss')
  assert.equal(isSocksProxy(normalizeProxyUrl('socks5://127.0.0.1:1080')), true)
  assert.equal(isSocksProxy(normalizeProxyUrl('http://127.0.0.1:7890')), false)
})

test('treats empty and unusable values as direct', () => {
  assert.equal(normalizeProxyUrl(''), null)
  assert.equal(normalizeProxyUrl('   '), null)
  assert.equal(normalizeProxyUrl(undefined), null)
  assert.equal(normalizeProxyUrl('ftp://127.0.0.1:21'), null)
  assert.equal(normalizeProxyUrl('http://127.0.0.1'), null)
  assert.equal(normalizeProxyUrl('http://127.0.0.1:99999'), null)
  assert.equal(normalizeProxyUrl('just some text'), null)
})

test('builds direct mode unless the setting holds a proxy', () => {
  assert.deepEqual(buildSessionProxyConfig(''), { mode: 'direct' })
  assert.deepEqual(buildSessionProxyConfig('   '), { mode: 'direct' })
  assert.deepEqual(buildSessionProxyConfig('nonsense'), { mode: 'direct' })
  assert.deepEqual(buildSessionProxyConfig('http://127.0.0.1:7890'), {
    proxyRules: 'http=127.0.0.1:7890;https=127.0.0.1:7890',
    proxyBypassRules: '<local>',
  })
  assert.deepEqual(buildSessionProxyConfig('socks5://127.0.0.1:1080'), {
    proxyRules: 'socks5://127.0.0.1:1080',
    proxyBypassRules: '<local>',
  })
})

test('clears every system/env proxy and only writes the configured one', () => {
  const env = {
    HTTP_PROXY: 'http://system:8080',
    https_proxy: 'http://system:8080',
    ALL_PROXY: 'socks5://system:1080',
    NO_PROXY: '',
    PATH: '/usr/bin',
  }
  applyProxyEnv(env, '')
  assert.deepEqual(env, { PATH: '/usr/bin' })

  applyProxyEnv(env, 'http://127.0.0.1:7890')
  assert.equal(env.HTTP_PROXY, 'http://127.0.0.1:7890')
  assert.equal(env.https_proxy, 'http://127.0.0.1:7890')
  assert.equal(env.ALL_PROXY, undefined)
  assert.equal(env.NO_PROXY, 'localhost,127.0.0.1,::1')

  // socks 走 agent，不写环境变量（否则 axios 会当 http 代理用）
  applyProxyEnv(env, 'socks5://127.0.0.1:1080')
  assert.equal(env.HTTP_PROXY, undefined)
  assert.equal(env.HTTPS_PROXY, undefined)
  assert.equal(env.NO_PROXY, undefined)
})
