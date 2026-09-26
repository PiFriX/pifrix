// Keystatic 后台路由入口。实际 UI 由上层 layout 挂载（见 app/keystatic/layout.tsx），
// 官方要求 page 返回 null，UI 在子路由间保持挂载不重载。
export default function Page() {
  return null
}
