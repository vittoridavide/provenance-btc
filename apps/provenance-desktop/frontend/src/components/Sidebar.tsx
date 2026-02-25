type SidebarProps = {
  label?: string
}

function Sidebar({ label = 'Sidebar' }: SidebarProps) {
  return <aside className="sidebar panel">{label}</aside>
}

export default Sidebar
