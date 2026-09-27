import KeystaticApp from './keystatic'

// Keystatic 后台布局：全屏容器盖住博客的页头页脚，后台独立呈现
export default function KeystaticLayout() {
  return (
    <div
      className="fixed inset-0 z-50 overflow-auto bg-white"
      style={{ position: 'fixed', inset: 0, zIndex: 50, overflow: 'auto', background: '#fff' }}
    >
      <KeystaticApp />
    </div>
  )
}
