type TopBarProps = {
  title?: string
}

function TopBar({ title = 'Top Bar' }: TopBarProps) {
  return <header className="top-bar panel">{title}</header>
}

export default TopBar
