type DetailPanelProps = {
  label?: string
}

function DetailPanel({ label = 'Detail Panel' }: DetailPanelProps) {
  return <aside className="detail-panel panel">{label}</aside>
}

export default DetailPanel
