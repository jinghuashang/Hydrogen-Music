let pendingHandoff = null

export function stageMvHandoff(value) {
  pendingHandoff = value
}

export function consumeMvHandoff() {
  const value = pendingHandoff
  pendingHandoff = null
  return value
}
