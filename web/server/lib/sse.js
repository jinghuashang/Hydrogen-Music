const clients = new Set()

function addClient(res) {
  clients.add(res)
}

function removeClient(res) {
  clients.delete(res)
}

function broadcast(event, data) {
  const payload =
    typeof data === 'string' ? data : JSON.stringify(data !== undefined ? data : null)
  const chunk = `event: ${event}\ndata: ${payload}\n\n`
  for (const res of clients) {
    try {
      res.write(chunk)
    } catch {
      clients.delete(res)
    }
  }
}

function sseMiddleware(req, res) {
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.flushHeaders?.()
  addClient(res)
  res.write(':ok\n\n')
  const ping = setInterval(() => {
    try {
      res.write(':ping\n\n')
    } catch {
      clearInterval(ping)
      removeClient(res)
    }
  }, 25000)
  req.on('close', () => {
    clearInterval(ping)
    removeClient(res)
  })
}

module.exports = { broadcast, sseMiddleware, addClient, removeClient }
