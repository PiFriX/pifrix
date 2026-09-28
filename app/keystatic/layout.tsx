import KeystaticApp from './keystatic'

// Keystatic 条目列表第一列固定渲染文件名 Slug —— 源码硬编码，无配置可关
// （node_modules/@keystatic/core/dist/keystatic-core-ui.js 的 CollectionTable：
//   [{ name: 'Slug', key: SLUG }, ...collection.columns.map(...)]，SLUG = '@@slug'）。
// 这里注入一段脚本：监听 DOM 变化，找到表头文本为 "Slug" 的列并整列隐藏，
// 列表只保留 标题 / 发布日期 / 草稿 等字段列。
// 实现按"行内索引"隐藏，不依赖具体标签（th/div 均兼容 react-aria 的表格结构）。
const hideSlugColumnScript = `(function () {
  var pending = null
  function schedule() {
    if (pending) return
    pending = requestAnimationFrame(function () {
      pending = null
      run()
    })
  }
  function run() {
    // 找到表头文本为 "Slug" 的单元格（去掉排序箭头等符号后精确匹配）
    var head = null
    var candidates = document.querySelectorAll('th, [role="columnheader"]')
    for (var i = 0; i < candidates.length; i++) {
      var t = (candidates[i].textContent || '').replace(/[^A-Za-z]/g, '')
      if (t === 'Slug') {
        head = candidates[i]
        break
      }
    }
    if (!head) return
    // 该表头在所在行内的列序号
    var row = head.parentElement
    if (!row) return
    var idx = Array.prototype.indexOf.call(row.children, head)
    if (idx < 0) return
    // 定位整个表格/网格容器，按同一序号隐藏整列
    var grid = head.closest('table') || head.closest('[role="grid"]')
    if (!grid) return
    if (head.style.display !== 'none') head.style.display = 'none'
    var rows = grid.querySelectorAll('tr, [role="row"]')
    for (var r = 0; r < rows.length; r++) {
      var cell = rows[r].children[idx]
      if (cell && cell !== head && cell.style.display !== 'none') {
        cell.style.display = 'none'
      }
    }
  }
  if (window.__ksHideSlugObserver) return
  window.__ksHideSlugObserver = new MutationObserver(schedule)
  window.__ksHideSlugObserver.observe(document.documentElement, {
    childList: true,
    subtree: true,
  })
  schedule()
})()`

// 编辑器的下拉弹层（标题级别/字体样式、链接弹窗等）通过 React Portal 挂在
// document.body 下，与本布局的全屏容器（z-index:50）不在同一层级；
// 弹层默认 z-index 低于 50 时会被容器盖住，表现为"点击下拉没反应"。
// 这里强制抬高层级，保证弹层始终显示在后台界面之上。
const popupLayerStyle = `
  [data-radix-popper-content-wrapper] { z-index: 999 !important; }
  .mdxeditor-popup,
  .mdxeditor [data-radix-popper-content-wrapper] { z-index: 999 !important; }
`

// Keystatic 后台布局：全屏容器盖住博客的页头页脚，后台独立呈现
export default function KeystaticLayout() {
  return (
    <div
      className="fixed inset-0 z-50 overflow-auto bg-white"
      style={{ position: 'fixed', inset: 0, zIndex: 50, overflow: 'auto', background: '#fff' }}
    >
      <script dangerouslySetInnerHTML={{ __html: hideSlugColumnScript }} />
      <style dangerouslySetInnerHTML={{ __html: popupLayerStyle }} />
      <KeystaticApp />
    </div>
  )
}
