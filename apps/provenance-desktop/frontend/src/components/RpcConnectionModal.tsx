import { useEffect, useRef } from 'react'
import { AlertTriangle, ChevronDown, Info, Lock, Unlock, X } from 'lucide-react'
import './RpcConnectionModal.css'

export type RpcAuthMode = 'none' | 'userpass'

export type RpcConnectionModalProps = {
  isOpen: boolean
  url: string
  authMode: RpcAuthMode
  username: string
  password: string
  publicEndpointAcknowledged: boolean
  isConnecting: boolean
  errorMessage: string | null
  successMessage: string | null
  onUrlChange: (value: string) => void
  onAuthModeChange: (value: RpcAuthMode) => void
  onUsernameChange: (value: string) => void
  onPasswordChange: (value: string) => void
  onPublicEndpointAcknowledgedChange: (value: boolean) => void
  onConnect: () => void | Promise<void>
  onClose: () => void
}

function parseRpcUrl(value: string): URL | null {
  const candidate = value.trim()
  if (!candidate) return null

  try {
    return new URL(candidate)
  } catch {
    try {
      return new URL(`http://${candidate}`)
    } catch {
      return null
    }
  }
}

function isPrivateIpv4(hostname: string): boolean {
  const parts = hostname.split('.').map((part) => Number.parseInt(part, 10))
  if (parts.length !== 4 || parts.some((part) => Number.isNaN(part) || part < 0 || part > 255)) return false

  if (parts[0] === 10) return true
  if (parts[0] === 127) return true
  if (parts[0] === 192 && parts[1] === 168) return true
  if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true
  if (parts[0] === 169 && parts[1] === 254) return true
  if (parts[0] === 0) return true

  return false
}

function isLocalHostname(hostname: string): boolean {
  const normalized = hostname.trim().toLowerCase()
  if (!normalized) return false

  if (
    normalized === 'localhost' ||
    normalized === '::1' ||
    normalized === '[::1]' ||
    normalized === '0.0.0.0'
  ) {
    return true
  }

  if (normalized.endsWith('.local')) {
    return true
  }

  if (isPrivateIpv4(normalized)) {
    return true
  }

  if (
    normalized.startsWith('fc') ||
    normalized.startsWith('fd') ||
    normalized.startsWith('fe80:')
  ) {
    return true
  }

  return false
}

function isPublicNoAuthEndpoint(url: string, authMode: RpcAuthMode): boolean {
  if (authMode !== 'none') return false

  const parsedUrl = parseRpcUrl(url)
  if (!parsedUrl) return false

  return !isLocalHostname(parsedUrl.hostname)
}

function canSubmit({
  url,
  authMode,
  username,
  password,
  isConnecting,
  requiresAcknowledgement,
  publicEndpointAcknowledged,
}: {
  url: string
  authMode: RpcAuthMode
  username: string
  password: string
  isConnecting: boolean
  requiresAcknowledgement: boolean
  publicEndpointAcknowledged: boolean
}): boolean {
  if (isConnecting) return false
  if (!url.trim()) return false

  if (authMode === 'userpass' && (!username.trim() || !password)) {
    return false
  }

  if (requiresAcknowledgement && !publicEndpointAcknowledged) {
    return false
  }

  return true
}

function RpcConnectionModal({
  isOpen,
  url,
  authMode,
  username,
  password,
  publicEndpointAcknowledged,
  isConnecting,
  errorMessage,
  successMessage,
  onUrlChange,
  onAuthModeChange,
  onUsernameChange,
  onPasswordChange,
  onPublicEndpointAcknowledgedChange,
  onConnect,
  onClose,
}: RpcConnectionModalProps) {
  const urlInputRef = useRef<HTMLInputElement | null>(null)
  const previousAuthMode = useRef<RpcAuthMode>(authMode)
  const usernameInputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (!isOpen) return

    urlInputRef.current?.focus()
  }, [isOpen])

  useEffect(() => {
    if (!isOpen) return

    if (previousAuthMode.current !== 'userpass' && authMode === 'userpass') {
      usernameInputRef.current?.focus()
    }

    previousAuthMode.current = authMode
  }, [authMode, isOpen])

  useEffect(() => {
    if (!isOpen) return

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape' && !isConnecting) {
        onClose()
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [isConnecting, isOpen, onClose])

  if (!isOpen) return null

  const requiresAcknowledgement = isPublicNoAuthEndpoint(url, authMode)
  const isSubmitEnabled = canSubmit({
    url,
    authMode,
    username,
    password,
    isConnecting,
    requiresAcknowledgement,
    publicEndpointAcknowledged,
  })

  return (
    <div className="rpc-connection-modal" role="dialog" aria-modal="true" aria-labelledby="rpc-connection-title">
      <div
        className="rpc-connection-modal__backdrop"
        onClick={() => {
          if (!isConnecting) onClose()
        }}
      />
      <section className="rpc-connection-modal__sheet">
        <header className="rpc-connection-modal__header">
          <div className="rpc-connection-modal__header-copy">
            <h2 id="rpc-connection-title" className="rpc-connection-modal__title">
              Connect Bitcoin RPC
            </h2>
            <p className="rpc-connection-modal__subtitle">
              Configure your RPC endpoint before loading graph data.
            </p>
          </div>
          <button
            type="button"
            className="rpc-connection-modal__close"
            aria-label="Close RPC connection modal"
            onClick={onClose}
            disabled={isConnecting}
          >
            <X size={20} aria-hidden="true" />
          </button>
        </header>

        <form
          className="rpc-connection-modal__body"
          onSubmit={(event) => {
            event.preventDefault()
            if (!isSubmitEnabled) return
            void onConnect()
          }}
        >
          <label className="rpc-connection-modal__field">
            <span className="rpc-connection-modal__field-label">RPC URL</span>
            <input
              ref={urlInputRef}
              className="rpc-connection-modal__input"
              type="url"
              aria-label="RPC URL"
              inputMode="url"
              autoCapitalize="none"
              autoCorrect="off"
              placeholder="http://127.0.0.1:8332"
              value={url}
              onChange={(event) => onUrlChange(event.target.value)}
              disabled={isConnecting}
              aria-describedby="rpc-connection-url-help"
            />
            <span id="rpc-connection-url-help" className="rpc-connection-modal__hint">
              Include scheme and port when possible.
            </span>
          </label>

          <label className="rpc-connection-modal__field">
            <span className="rpc-connection-modal__field-label">Authentication</span>
            <div className="rpc-connection-modal__select-wrap">
              <select
                className="rpc-connection-modal__select"
                aria-label="Authentication"
                value={authMode}
                onChange={(event) => onAuthModeChange(event.target.value as RpcAuthMode)}
                disabled={isConnecting}
              >
                <option value="none">None</option>
                <option value="userpass">Username + Password</option>
              </select>
              <ChevronDown size={16} className="rpc-connection-modal__select-icon" aria-hidden="true" />
            </div>
          </label>

          {authMode === 'userpass' ? (
            <div className="rpc-connection-modal__credentials">
              <label className="rpc-connection-modal__field">
                <span className="rpc-connection-modal__field-label">Username</span>
                <div className="rpc-connection-modal__icon-input-wrap">
                  <Lock size={16} aria-hidden="true" className="rpc-connection-modal__input-icon" />
                  <input
                    ref={usernameInputRef}
                    className="rpc-connection-modal__input rpc-connection-modal__input--with-icon"
                    aria-label="Username"
                    value={username}
                    onChange={(event) => onUsernameChange(event.target.value)}
                    disabled={isConnecting}
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                  />
                </div>
              </label>
              <label className="rpc-connection-modal__field">
                <span className="rpc-connection-modal__field-label">Password</span>
                <div className="rpc-connection-modal__icon-input-wrap">
                  <Unlock size={16} aria-hidden="true" className="rpc-connection-modal__input-icon" />
                  <input
                    className="rpc-connection-modal__input rpc-connection-modal__input--with-icon"
                    type="password"
                    aria-label="Password"
                    value={password}
                    onChange={(event) => onPasswordChange(event.target.value)}
                    disabled={isConnecting}
                  />
                </div>
              </label>
            </div>
          ) : null}

          {requiresAcknowledgement ? (
            <div className="rpc-connection-modal__warning" role="alert">
              <div className="rpc-connection-modal__warning-title">
                <AlertTriangle size={16} aria-hidden="true" />
                <span>Privacy warning</span>
              </div>
              <p className="rpc-connection-modal__warning-copy">
                Public unauthenticated RPC endpoints can log searched transactions and addresses.
              </p>
              <label className="rpc-connection-modal__checkbox-row">
                <input
                  type="checkbox"
                  checked={publicEndpointAcknowledged}
                  onChange={(event) => onPublicEndpointAcknowledgedChange(event.target.checked)}
                  disabled={isConnecting}
                />
                <span>I understand and still want to connect without authentication.</span>
              </label>
            </div>
          ) : (
            <div className="rpc-connection-modal__info">
              <Info size={16} aria-hidden="true" className="rpc-connection-modal__info-icon" />
              <p className="rpc-connection-modal__info-copy">
                Use authenticated RPC whenever possible, even on private networks.
              </p>
            </div>
          )}

          {errorMessage ? (
            <p className="rpc-connection-modal__status rpc-connection-modal__status--error" role="alert">
              {errorMessage}
            </p>
          ) : null}
          {successMessage ? (
            <p className="rpc-connection-modal__status rpc-connection-modal__status--success" role="status">
              {successMessage}
            </p>
          ) : null}

          <div className="rpc-connection-modal__actions">
            <button
              type="button"
              className="rpc-connection-modal__button rpc-connection-modal__button--secondary"
              onClick={onClose}
              disabled={isConnecting}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="rpc-connection-modal__button rpc-connection-modal__button--primary"
              disabled={!isSubmitEnabled}
            >
              {isConnecting ? 'Connecting…' : 'Connect'}
            </button>
          </div>
        </form>
      </section>
    </div>
  )
}

export default RpcConnectionModal
