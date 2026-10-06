import test from 'node:test'
import assert from 'node:assert/strict'
import { enableRandomCnIp } from '../src/server/apiRiskControl.js'

test('turns on the upstream random CN IP mitigation and seeds global.cnIp', () => {
  const env = {}
  const globalScope = {}
  let generated = 0

  const applied = enableRandomCnIp({ env, globalScope, generateIp: () => `10.0.0.${++generated}` })

  assert.equal(applied, true)
  assert.equal(env.ENABLE_RANDOM_CN_IP, 'true')
  assert.equal(globalScope.cnIp, '10.0.0.1')
  assert.equal(generated, 1)
})

test('keeps an already generated CN IP instead of regenerating it', () => {
  const env = {}
  const globalScope = { cnIp: '116.25.146.177' }
  let generated = 0

  enableRandomCnIp({ env, globalScope, generateIp: () => `10.0.0.${++generated}` })

  assert.equal(globalScope.cnIp, '116.25.146.177')
  assert.equal(generated, 0)
})

test('honours an explicit opt-out and stays out of the way', () => {
  const env = { ENABLE_RANDOM_CN_IP: 'false' }
  const globalScope = {}

  const applied = enableRandomCnIp({ env, globalScope, generateIp: () => '10.0.0.9' })

  assert.equal(applied, false)
  assert.equal(env.ENABLE_RANDOM_CN_IP, 'false')
  assert.equal(globalScope.cnIp, undefined)
})

test('never leaves cnIp empty when the generator fails', () => {
  const env = {}
  const globalScope = {}

  const applied = enableRandomCnIp({
    env,
    globalScope,
    generateIp: () => {
      throw new Error('boom')
    },
  })

  assert.equal(applied, true)
  assert.equal(env.ENABLE_RANDOM_CN_IP, 'true')
  assert.equal(typeof globalScope.cnIp, 'string')
  assert.match(globalScope.cnIp, /^\d{1,3}(\.\d{1,3}){3}$/)
})
