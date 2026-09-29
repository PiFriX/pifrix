import KeystaticApp from './keystatic'

// Keystatic 条目列表第一列固定渲染文件名 Slug —— 源码硬编码，无配置可关
// （node_modules/@keystatic/core/dist/keystatic-core-ui.js 的 CollectionTable：
//   [{ name: 'Slug', key: SLUG }, ...collection.columns.map(...)]，SLUG = '@@slug'）。
// 这里注入一段脚本：监听 DOM 变化，找到表头文本为 "Slug" 的列并整列删除，
// 列表只保留 标题 / 发布日期 / 草稿 等字段列。
// 除隐藏单元格外，还要同步收起列宽（colgroup 的 <col> 或 grid-template-columns），
// 否则单元格隐藏了但列宽仍占位，表头左侧会留下大片空白。
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
    // 定位整个表格/网格容器，按同一序号删除整列
    var grid = head.closest('table') || head.closest('[role="grid"]')
    if (!grid) return
    // 列宽只收一次（run 会被 MutationObserver 反复触发）
    if (!grid.__ksSlugFixed) {
      grid.__ksSlugFixed = true
      var cols = grid.querySelectorAll('colgroup col')
      if (cols.length > idx) cols[idx].style.display = 'none'
      var gt = grid.style ? grid.style.gridTemplateColumns : ''
      if (gt) {
        var parts = gt.split(' ')
        if (parts.length > idx) {
          parts.splice(idx, 1)
          grid.style.gridTemplateColumns = parts.join(' ')
        }
      }
    }
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

// 草稿箱/发表记录的新建页与编辑页，把右侧整个表单面板隐藏（不是逐个隐藏字段——
// 那样面板还占着位置，右侧留一大条空白）。正文编辑区随之占满全宽。
// 新建页（/create）同时由脚本自动填入时间戳作为文件名（Keystatic 创建条目
// 必须有 slug，绕不开）；真正的标题以正文第一行为准（见下方 syncTitleScript
// 与 app/api/publish/route.ts）。
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
  function isEntryPage() {
    return /\\/collection\\/(drafts|posts)\\/(item\\/[^/]+|create)\\/?$/.test(location.pathname)
  }
  // React 受控输入必须用原生 setter + input 事件才能正确赋值
  function setVal(input, value) {
    var setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    setter.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  }
  function findField(prefix) {
    var labels = document.querySelectorAll('label')
    for (var i = 0; i < labels.length; i++) {
      if ((labels[i].textContent || '').trim().indexOf(prefix) === 0) {
        // 向上找"只包含这一个字段"的最外层容器
        var el = labels[i]
        while (el.parentElement && el.parentElement.querySelectorAll('label').length === 1) {
          el = el.parentElement
        }
        return el
      }
    }
    return null
  }
  function timestamp() {
    var d = new Date()
    function p(n) {
      return (n < 10 ? '0' : '') + n
    }
    return (
      '' + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) +
      '-' + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds())
    )
  }
  function autofillCreate() {
    if (location.pathname.indexOf('/create') === -1) return
    var title = findField('标题')
    var slug = findField('URL 路径')
    if (!title || !slug) return
    var ti = title.querySelector('input')
    var si = slug.querySelector('input')
    if (!ti || !si || ti.value) return
    var stamp = timestamp()
    setVal(ti, stamp)
    setVal(si, stamp)
  }
  // 多个字段容器的最近公共祖先 = 侧栏面板
  function commonAncestor(els) {
    var a = els[0]
    for (var i = 1; i < els.length; i++) {
      while (a && !a.contains(els[i])) a = a.parentElement
      if (!a) return null
    }
    return a
  }
  function run() {
    if (!isEntryPage()) return
    var els = []
    for (var j = 0; j < PREFIXES.length; j++) {
      var el = findField(PREFIXES[j])
      if (el) els.push(el)
    }
    if (!els.length) return
    // 从公共祖先继续向外找到"侧栏面板"：父级包含同样的 label 集合、
    // 且父级还不包含正文编辑器时才继续上移（编辑器无 label，用 contenteditable 判断）
    var panel = commonAncestor(els)
    while (panel && panel.parentElement) {
      var pn = panel.parentElement
      if (
        pn.querySelectorAll('label').length === panel.querySelectorAll('label').length &&
        !pn.querySelector('[contenteditable="true"]')
      ) {
        panel = pn
      } else break
    }
    if (panel && panel.style.display !== 'none') panel.style.display = 'none'
    autofillCreate()
  }
  if (window.__ksHideFieldsObserver) return
  window.__ksHideFieldsObserver = new MutationObserver(schedule)
  window.__ksHideFieldsObserver.observe(document.documentElement, {
    childList: true,
    subtree: true,
  })
  schedule()
})()`

// 标题实时同步：正文第一个非空段落/标题行的文字 = 文章标题。
// 打字时实时写进隐藏的「标题」字段，保存后草稿箱/发表记录列表显示的就是真标题；
// 同时把页面上显示为文件名（时间戳）的位置（如面包屑）替换成真标题。
// 发布逻辑不变：/api/publish 仍以正文第一行为准并从正文移除该行。
const syncTitleScript = `(function () {
  var pending = null
  function schedule() {
    if (pending) return
    pending = requestAnimationFrame(function () {
      pending = null
      run()
    })
  }
  function isEntryPage() {
    return /\\/collection\\/(drafts|posts)\\/(item\\/[^/]+|create)\\/?$/.test(location.pathname)
  }
  function setVal(input, value) {
    var setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    setter.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  }
  function findField(prefix) {
    var labels = document.querySelectorAll('label')
    for (var i = 0; i < labels.length; i++) {
      if ((labels[i].textContent || '').trim().indexOf(prefix) === 0) {
        var el = labels[i]
        while (el.parentElement && el.parentElement.querySelectorAll('label').length === 1) {
          el = el.parentElement
        }
        return el
      }
    }
    return null
  }
  function firstLine() {
    var ed =
      document.querySelector('.mdxeditor [contenteditable="true"]') ||
      document.querySelector('[contenteditable="true"]')
    if (!ed) return ''
    var blocks = ed.querySelectorAll('p, h1, h2, h3, h4, h5, h6')
    for (var i = 0; i < blocks.length; i++) {
      var t = (blocks[i].textContent || '').replace(/^#+\\s*/, '').trim()
      if (t) return t
    }
    return ''
  }
  function run() {
    if (!isEntryPage()) return
    var line = firstLine()
    if (!line) return
    // 1) 同步进隐藏的标题字段（值相同则跳过，避免和 MutationObserver 死循环）
    var f = findField('标题')
    var input = f && f.querySelector('input')
    if (input && input.value !== line) setVal(input, line)
    // 2) 页面上显示文件名的地方（面包屑等）替换成标题（仅显示层面，不改文件名）
    var slug = decodeURIComponent(location.pathname.split('/').filter(Boolean).pop() || '')
    if (slug && slug !== line && !/^\\d{8}-\\d{6}$/.test(line)) {
      var all = document.querySelectorAll('body *')
      for (var i = 0; i < all.length; i++) {
        var el = all[i]
        if (el.closest && el.closest('[contenteditable="true"]')) continue
        if (el.children.length > 0) continue
        if ((el.textContent || '').trim() === slug) {
          el.textContent = line
          break
        }
      }
    }
  }
  if (window.__ksSyncTitleObserver) return
  window.__ksSyncTitleObserver = new MutationObserver(schedule)
  window.__ksSyncTitleObserver.observe(document.documentElement, {
    childList: true,
    subtree: true,
    characterData: true,
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

// 发表记录编辑页左下角「转为草稿 / 恢复发布」：右侧表单面板整体隐藏后，
// 原来面板里的「草稿」开关看不到了，用它代替（点击后仍需点右上角 Save 保存）。
const draftToggleScript = `(function () {
  var pending = null
  function schedule() {
    if (pending) return
    pending = requestAnimationFrame(function () {
      pending = null
      run()
    })
  }
  function run() {
    var onPostItem = /\\/collection\\/posts\\/item\\/[^/]+\\/?$/.test(location.pathname)
    var btn = document.getElementById('ks-draft-toggle')
    if (!onPostItem) {
      if (btn) btn.remove()
      return
    }
    var box = document.querySelector('input[type="checkbox"]')
    if (!box) {
      if (btn) btn.remove()
      return
    }
    if (!btn) {
      btn = document.createElement('button')
      btn.id = 'ks-draft-toggle'
      btn.type = 'button'
      btn.style.cssText =
        'position:fixed;left:28px;bottom:28px;z-index:9999;padding:8px 18px;' +
        'border-radius:999px;border:1px solid #d1d5db;background:#fff;color:#374151;' +
        'font-size:13px;cursor:pointer'
      btn.onclick = function () {
        var b = document.getElementById('ks-draft-toggle')
        if (b && b.__ksBox) {
          b.__ksBox.click()
          alert(b.__ksBox.checked ? '已转为草稿，请点右上角 Save 保存' : '已恢复发布，请点右上角 Save 保存')
        }
      }
      document.body.appendChild(btn)
    }
    btn.__ksBox = box
    var label = box.checked ? '↩ 恢复发布' : '↓ 转为草稿'
    if (btn.textContent !== label) btn.textContent = label
  }
  if (window.__ksDraftToggleObserver) return
  window.__ksDraftToggleObserver = new MutationObserver(schedule)
  window.__ksDraftToggleObserver.observe(document.documentElement, {
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
      <script dangerouslySetInnerHTML={{ __html: syncTitleScript }} />
      <script dangerouslySetInnerHTML={{ __html: publishButtonScript }} />
      <script dangerouslySetInnerHTML={{ __html: draftToggleScript }} />
      <style dangerouslySetInnerHTML={{ __html: popupLayerStyle }} />
      <KeystaticApp />
    </div>
  )
}
