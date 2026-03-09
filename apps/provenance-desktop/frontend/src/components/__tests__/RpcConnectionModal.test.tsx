import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import RpcConnectionModal, { type RpcAuthMode } from '../RpcConnectionModal'

type ModalHarnessProps = {
  initialUrl?: string
  initialAuthMode?: RpcAuthMode
  initialUsername?: string
  initialPassword?: string
  initialPublicEndpointAcknowledged?: boolean
  isConnecting?: boolean
  errorMessage?: string | null
  successMessage?: string | null
  onConnect?: () => void | Promise<void>
  onClose?: () => void
}

function ModalHarness({
  initialUrl = '',
  initialAuthMode = 'none',
  initialUsername = '',
  initialPassword = '',
  initialPublicEndpointAcknowledged = false,
  isConnecting = false,
  errorMessage = null,
  successMessage = null,
  onConnect = vi.fn(),
  onClose = vi.fn(),
}: ModalHarnessProps) {
  const [url, setUrl] = useState(initialUrl)
  const [authMode, setAuthMode] = useState<RpcAuthMode>(initialAuthMode)
  const [username, setUsername] = useState(initialUsername)
  const [password, setPassword] = useState(initialPassword)
  const [publicEndpointAcknowledged, setPublicEndpointAcknowledged] = useState(
    initialPublicEndpointAcknowledged,
  )

  return (
    <RpcConnectionModal
      isOpen
      url={url}
      authMode={authMode}
      username={username}
      password={password}
      publicEndpointAcknowledged={publicEndpointAcknowledged}
      isConnecting={isConnecting}
      errorMessage={errorMessage}
      successMessage={successMessage}
      onUrlChange={setUrl}
      onAuthModeChange={setAuthMode}
      onUsernameChange={setUsername}
      onPasswordChange={setPassword}
      onPublicEndpointAcknowledgedChange={setPublicEndpointAcknowledged}
      onConnect={onConnect}
      onClose={onClose}
    />
  )
}

afterEach(() => {
  cleanup()
})

describe('RpcConnectionModal', () => {
  it('shows conditional credentials fields for username/password auth and submits when complete', async () => {
    const onConnect = vi.fn()
    const user = userEvent.setup()

    render(<ModalHarness initialUrl="http://127.0.0.1:8332" onConnect={onConnect} />)

    expect(screen.queryByLabelText('Username')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Password')).not.toBeInTheDocument()

    await user.selectOptions(screen.getByRole('combobox', { name: 'Authentication' }), 'userpass')
    expect(screen.getByLabelText('Username')).toBeInTheDocument()
    expect(screen.getByLabelText('Password')).toBeInTheDocument()

    await user.type(screen.getByLabelText('Username'), 'rpc-user')
    await user.type(screen.getByLabelText('Password'), 'rpc-pass')
    await user.click(screen.getByRole('button', { name: 'Connect' }))

    expect(onConnect).toHaveBeenCalledTimes(1)
  })

  it('requires acknowledgement before connect for public unauthenticated endpoints', async () => {
    const onConnect = vi.fn()
    const user = userEvent.setup()

    render(<ModalHarness initialUrl="https://rpc.example.com:8332" onConnect={onConnect} />)

    expect(screen.getByText('Privacy warning')).toBeInTheDocument()
    const connectButton = screen.getByRole('button', { name: 'Connect' })
    expect(connectButton).toBeDisabled()

    await user.click(
      screen.getByRole('checkbox', {
        name: 'I understand and still want to connect without authentication.',
      }),
    )
    expect(connectButton).toBeEnabled()

    await user.click(connectButton)
    expect(onConnect).toHaveBeenCalledTimes(1)
  })

  it('does not require acknowledgement for local unauthenticated endpoints', async () => {
    const onConnect = vi.fn()
    const user = userEvent.setup()

    render(<ModalHarness initialUrl="http://127.0.0.1:8332" onConnect={onConnect} />)

    expect(screen.queryByText('Privacy warning')).not.toBeInTheDocument()
    expect(
      screen.queryByRole('checkbox', {
        name: 'I understand and still want to connect without authentication.',
      }),
    ).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Connect' }))
    expect(onConnect).toHaveBeenCalledTimes(1)
  })

  it('applies disabled and loading states while connecting', () => {
    render(<ModalHarness initialUrl="http://127.0.0.1:8332" isConnecting />)

    expect(screen.getByLabelText('RPC URL')).toBeDisabled()
    expect(screen.getByRole('combobox', { name: 'Authentication' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Connecting…' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Close RPC connection modal' })).toBeDisabled()
  })

  it('renders inline error and success statuses', () => {
    render(
      <ModalHarness
        initialUrl="http://127.0.0.1:8332"
        errorMessage="Connection failed."
        successMessage="Connected successfully."
      />,
    )

    expect(screen.getByText('Connection failed.')).toBeInTheDocument()
    expect(screen.getByText('Connected successfully.')).toBeInTheDocument()
  })
})
