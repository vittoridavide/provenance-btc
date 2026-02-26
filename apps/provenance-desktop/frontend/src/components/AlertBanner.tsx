type AlertBannerProps = {
  visible?: boolean
  message?: string
}

function AlertBanner({ visible = false, message = 'Alert Banner' }: AlertBannerProps) {
  if (!visible) return null

  return <div className="alert-banner state-tone state-tone--warning state-surface">{message}</div>
}

export default AlertBanner
