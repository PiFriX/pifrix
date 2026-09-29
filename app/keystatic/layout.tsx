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

// 编辑条目页（URL 含 /item/）隐藏侧栏表单字段：标题 / URL 路径 / 发布日期。
// 用户要求公众号式写作：正文第一行即标题，URL 和日期发布时自动生成。
// 创建页（/create）不隐藏——首次仍需填一次标题作为文件名。
// 隐藏不等于清空：字段值仍在，保存不受影响。
const hideFieldsScript = `(function () {
  var PREFIXES = ['标题', 'URL 路径', '发布日期']
  var pending = null
  function schedule() {
    if (pending) return
    pending = requestAnimationFrame(function () {
      pending = null
      run()
    })
  }
  function run() {
    if (location.pathname.indexOf('/item/') === -1) return
    var labels = document.querySelectorAll('label')
    for (var i = 0; i < labels.length; i++) {
      var text = (labels[i].textContent || '').trim()
      for (var j = 0; j < PREFIXES.length; j++) {
        if (text.indexOf(PREFIXES[j]) === 0) {
          // 向上找"只包含这一个字段"的最外层容器并隐藏
          var el = labels[i]
          while (el.parentElement && el.parentElement.querySelectorAll('label').length === 1) {
            el = el.parentElement
          }
          if (el.style.display !== 'none') el.style.display = 'none'
          break
        }
      }
    }
  }
  if (window.__ksHideFieldsObserver) return
  window.__ksHideFieldsObserver = new MutationObserver(schedule)
  window.__ksHideFieldsObserver.observe(document.documentElement, {
    childList: true,
    subtree: true,
  })
  schedule()
})()`

// 草稿箱编辑页右下角「发布」按钮：调用 /api/publish 一键完成
// （正文第一行作标题、自动日期、移入发表记录、删除草稿）。
const publishButtonScript = `(function () {
  var pending = null
  function schedule() {
    if (pending) return
    pending = requestAnimationFrame(function () {
      pending = null
      run()
    })
  }
  function run() {
    var onDraftItem = /\\/collection\\/drafts\\/item\\/[^/]+\\/?$/.test(location.pathname)
    var btn = document.getElementById('ks-publish-btn')
    if (!onDraftItem) {
      if (btn) btn.remove()
      return
    }
    if (btn) return
    btn = document.createElement('button')
    btn.id = 'ks-publish-btn'
    btn.type = 'button'
    btn.textContent = '🚀 发布'
    btn.style.cssText =
      'position:fixed;right:28px;bottom:28px;z-index:9999;padding:10px 24px;' +
      'border-radius:999px;border:none;background:#07c160;color:#fff;font-size:15px;' +
      'font-weight:600;cursor:pointer;box-shadow:0 4px 14px rgba(7,193,96,.4)'
    btn.onclick = function () {
      if (
        !confirm(
          '发布这篇文章？\\n\\n· 正文第一行将作为文章标题（并从正文中移除）\\n' +
            '· 发布日期自动设为今天\\n· 文章移入「发表记录」，草稿自动删除'
        )
      )
        return
      btn.disabled = true
      btn.textContent = '发布中…'
      var slug = decodeURIComponent(location.pathname.split('/').filter(Boolean).pop() || '')
      fetch('/api/publish?slug=' + encodeURIComponent(slug), { method: 'POST' })
        .then(function (r) {
          return r
            .json()
            .catch(function () {
              return { ok: false, error: '响应解析失败' }
            })
            .then(function (d) {
              return { status: r.status, data: d }
            })
        })
        .then(function (res) {
          if (res.data && res.data.ok) {
            alert('✅ 发布成功：' + (res.data.title || '') + (res.data.warning ? '\\n\\n' + res.data.warning : ''))
            location.href = location.pathname.replace(/\\/collection\\/drafts\\/item\\/[^/]+\\/?$/, '/collection/posts')
          } else {
            alert('❌ 发布失败：' + ((res.data && res.data.error) || 'HTTP ' + res.status))
            btn.disabled = false
            btn.textContent = '🚀 发布'
          }
        })
        .catch(function (e) {
          alert('❌ 发布失败：' + e)
          btn.disabled = false
          btn.textContent = '🚀 发布'
        })
    }
    document.body.appendChild(btn)
  }
  if (window.__ksPublishBtnObserver) return
  window.__ksPublishBtnObserver = new MutationObserver(schedule)
  window.__ksPublishBtnObserver.observe(document.documentElement, {
    childList: true,
    subtree: true,
  })
  schedule()
})()`

// Keystatic 后台布局：全屏容器盖住博客的页头页脚，后台独立呈现
export default function KeystaticLayout() {
  return (
    <div
      className="fixed inset-0 z-50 overflow-auto bg-white"
      style={{ position: 'fixed', inset: 0, zIndex: 50, overflow: 'auto', background: '#fff' }}
    >
      <script dangerouslySetInnerHTML={{ __html: hideSlugColumnScript }} />
      <script dangerouslySetInnerHTML={{ __html: hideFieldsScript }} />
      <script dangerouslySetInnerHTML={{ __html: publishButtonScript }} />
      <style dangerouslySetInnerHTML={{ __html: popupLayerStyle }} />
      <KeystaticApp />
    </div>
  )
}
