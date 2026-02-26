type SidebarProps = {
  label?: string
  collapsed?: boolean
}

function Sidebar({ label = 'Sidebar', collapsed = false }: SidebarProps) {
  if (collapsed) {
    return (
      <aside className="sidebar sidebar--collapsed surface-panel" aria-label={label}>
        <div className="sidebar__collapsed-label">{label}</div>
      </aside>
    )
  }
  return (
    <aside className="sidebar surface-panel">
      <div className="sidebar__content">
        <h2 className="section-header section-header--lg section-header--with-divider">{label}</h2>
        <div className="sidebar__placeholder-card surface-card border-variant-subtle">
          <p className="sidebar__placeholder-text text-muted">
            Filters and labels will appear here.
          </p>
        </div>
      </div>
    </aside>
  )
}

export default Sidebar
