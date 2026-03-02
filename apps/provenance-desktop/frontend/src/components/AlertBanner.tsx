type AlertBannerProps = {
  visible?: boolean
  unclassifiedCount?: number
}

function AlertBanner({ visible = false, unclassifiedCount = 0 }: AlertBannerProps) {
  if (!visible || unclassifiedCount <= 0) return null

  return (
    <div className="alert-banner">
      <p className="alert-banner__text">
        This transaction graph has {unclassifiedCount} unclassified transactions.
      </p>
      <p className="alert-banner__text">
        Classification improves audit traceability and tax reporting.
      </p>
    </div>
  )
}

export default AlertBanner
