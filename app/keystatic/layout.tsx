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
    // 定位整个表格/网格容器
    var grid = head.closest('table') || head.closest('[role="grid"]')
    if (!grid) return
    // 单元格宽度由虚拟定位器以内联 left/width 绝对定位（普通 flex 行兜底）。
    // 只把 Slug 单元格 display:none 的话，右侧列仍停在原 left 坐标，
    // Slug 位置会留一块空白；因此隐藏的同时把右侧单元格整体左移一个列宽。
    var headLeft = parseFloat(head.style.left)
    var headW = parseFloat(head.style.width)
    if (isNaN(headW) || headW <= 0) headW = head.getBoundingClientRect().width
    if (isNaN(headLeft)) headLeft = 0
    if (head.style.display !== 'none') head.style.display = 'none'
    var rows = grid.querySelectorAll('tr, [role="row"]')
    for (var r = 0; r < rows.length; r++) {
      var rowEl = rows[r]
      if (rowEl.__ksShifted) continue
      rowEl.__ksShifted = true
      var kids = rowEl.children
      for (var c = 0; c < kids.length; c++) {
        var k = kids[c]
        if (k === head) continue
        var l = parseFloat(k.style.left)
        if (!isNaN(l)) {
          // 绝对定位行：Slug 列本体隐藏，右侧列左移 headW
          if (l >= headLeft - 1 && l <= headLeft + headW - 1) {
            if (k.style.display !== 'none') k.style.display = 'none'
          } else if (l > headLeft + headW - 1) {
            k.style.left = l - headW + 'px'
          }
        } else if (c === idx && k.style.display !== 'none') {
          // 普通文档流行（flex 布局）：直接隐藏本列单元格即可
          k.style.display = 'none'
        }
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

// Keystatic 的下拉弹层（Paragraph 切标题/字号、链接弹窗）和对话框（删除确认等）
// 由 React Aria 传送到 document.body 下渲染，内联 z-index 只有 1~2，
// 会被本布局的全屏容器（z-index:50）盖住 —— 表现为"下拉无法使用"、
// "点删除后整个页面卡死"（其实是确认框被藏住 + 模态锁死了交互）。
// 这里注入脚本：监测 body 直接子级里带低内联 z-index 的浮层容器，
// 统一抬到 999，保证任何弹层都显示在全屏容器之上。
// （之前用 [data-radix-popper-content-wrapper] 的 CSS 方案无效——Keystatic 不用 Radix。）
const raiseOverlayScript = `(function () {
  var ROOT_ID = 'ks-fullscreen-root'
  var THRESHOLD = 50
  // 判断一个元素是否是"低层级浮层"：fixed/absolute 且 z-index 在 0~49
  function isLowOverlay(el) {
    var cs = window.getComputedStyle(el)
    var pos = cs.position
    if (pos !== 'fixed' && pos !== 'absolute') return false
    var z = parseInt(cs.zIndex, 10)
    return !isNaN(z) && z >= 0 && z < THRESHOLD
  }
  // 传送门根节点（body 直接子级、static、内部带低层级浮层）：
  // Keystatic 弹层的传送门根有 isolation:isolate（独立堆叠上下文）且 z-index auto，
  // 内部弹层再高也会被本布局 z-50 容器整体盖住，必须把根节点本身抬上去。
  // 设 position:relative + z-index:999（body 无滚动、无 margin，不影响弹层坐标）。
  function raisePortalRoot(root) {
    if (!root || root.nodeType !== 1 || !root.closest) return
    if (root.closest('#' + ROOT_ID)) return
    if (root.parentElement !== document.body) return
    if (window.getComputedStyle(root).position !== 'static') return
    var divs = root.querySelectorAll('div')
    for (var i = 0; i < divs.length; i++) {
      if (isLowOverlay(divs[i])) {
        root.style.position = 'relative'
        root.style.zIndex = '999'
        return
      }
    }
  }
  // 兜底：浮层内部 z-index 写死在 class 里的（遮罩 1、弹层 2），逐个抬到 999
  function bumpDescendants(root) {
    if (!root || root.nodeType !== 1 || !root.closest) return
    if (root.closest('#' + ROOT_ID)) return
    var list = [root]
    if (root.querySelectorAll) {
      var subs = root.querySelectorAll('div')
      for (var i = 0; i < subs.length; i++) list.push(subs[i])
    }
    for (var j = 0; j < list.length; j++) {
      if (isLowOverlay(list[j])) list[j].style.zIndex = '999'
    }
  }
  function handle(root) {
    raisePortalRoot(root)
    bumpDescendants(root)
  }
  if (window.__ksRaiseOverlayObserver) return
  window.__ksRaiseOverlayObserver = new MutationObserver(function (records) {
    for (var i = 0; i < records.length; i++) {
      var added = records[i].addedNodes
      for (var j = 0; j < added.length; j++) handle(added[j])
    }
  })
  window.__ksRaiseOverlayObserver.observe(document.body, { childList: true, subtree: true })
  var init = document.body.children
  for (var k = 0; k < init.length; k++) handle(init[k])
})()`

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
    var stamp = timestamp()
    // 标题和 slug 各自独立补缺：标题可能已被 syncTitleScript 填成正文第一行，
    // 不能因此跳过 slug（否则 Create 时 slug 必填校验失败且报错被面板挡住，看似没反应）
    var ti = title && title.querySelector('input')
    if (ti && !ti.value) setVal(ti, stamp)
    var si = slug && slug.querySelector('input')
    if (si && !si.value) setVal(si, stamp)
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

// 逐段字号（公众号式）：工具栏原「Paragraph」块类型下拉替换为「字号」下拉
// （正文 + 8-20px，菜单按公众号格式显示如「12px」）。光标所在段落选择字号后：
//   1. 编辑区该段落立即应用字号（所见即所得）
//   2. 写入隐藏的「段落字号」字段（JSON：{"段落序号":字号}），随 Save 保存
// 博客前台由 layouts 里 data-para-sizes 脚本按同序号应用到正文段落；
// 发布时 /api/publish 会把序号整体前移一位（正文第一行作标题被移除）。
const paragraphSizeScript = `(function () {
  var PREFIX = '段落字号'
  var BASE = 17 // 公众号正文字号
  function fieldInput() {
    var labels = document.querySelectorAll('label')
    for (var i = 0; i < labels.length; i++) {
      if ((labels[i].textContent || '').trim().indexOf(PREFIX) === 0) {
        var box = labels[i].closest('div')
        while (box && !box.querySelector('input')) box = box.parentElement
        return box ? box.querySelector('input') : null
      }
    }
    return null
  }
  function onArticlePage() {
    return /\\/collection\\/(drafts|posts)\\/(item\\/[^/]+|create)\\/?$/.test(location.pathname)
  }
  function editorEl() {
    // Keystatic 0.6.9 编辑器是 Slate 内核：可编辑根节点带 data-slate-editor="true"
    var ed =
      document.querySelector('[data-slate-editor="true"]') ||
      document.querySelector('[contenteditable="true"]')
    // 打标记 id 供 CSS 规则定位（Slate 重渲染会重建 DOM，id 丢失时由轮询补回）
    if (ed && ed.id !== 'ks-slate-editor') ed.id = 'ks-slate-editor'
    return ed
  }
  function blocks() {
    var ed = editorEl()
    if (!ed) return []
    // 取全部元素子节点，保证序号与 CSS nth-child 一一对应
    return Array.prototype.slice.call(ed.children)
  }
  // 字号用 CSS 规则应用而非内联样式：Slate/React 重渲染会抹掉内联样式，
  // CSS 规则在浏览器层面持续生效，不受重渲染影响
  function applyCss() {
    var style = document.getElementById('ks-size-style')
    if (!style) {
      style = document.createElement('style')
      style.id = 'ks-size-style'
      document.head.appendChild(style)
    }
    var rules = []
    var keys = Object.keys(map)
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i]
      rules.push(
        '#ks-slate-editor > :nth-child(' + (+k + 1) + '){font-size:' + map[k] + 'px !important}'
      )
    }
    style.textContent = rules.join('\n')
  }
  function setVal(input, value) {
    var setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    setter.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  }
  var map = {}
  var loaded = false
  function loadMap() {
    if (loaded) return
    var input = fieldInput()
    if (!input) return
    try {
      map = input.value ? JSON.parse(input.value) : {}
    } catch (e) {
      map = {}
    }
    loaded = true
    applyCss() // 进入页面时应用已保存的段落字号
  }
  function saveMap() {
    var input = fieldInput()
    var keys = Object.keys(map)
    keys.sort(function (a, b) { return a - b })
    var parts = []
    for (var i = 0; i < keys.length; i++) parts.push('"' + keys[i] + '":' + map[keys[i]])
    var s = '{' + parts.join(',') + '}'
    if (input && input.value !== s) setVal(input, s)
  }
  // ── 菜单 ──
  var menu = null
  function closeMenu() {
    if (menu) { menu.remove(); menu = null }
  }
  function buildMenu() {
    closeMenu()
    menu = document.createElement('div')
    menu.id = 'ks-size-menu'
    menu.style.cssText =
      'position:fixed;z-index:10000;background:#fff;border:1px solid #e5e7eb;border-radius:10px;' +
      'box-shadow:0 8px 24px rgba(0,0,0,.12);padding:6px 0;max-height:320px;overflow-y:auto;min-width:110px'
    function item(label, px, isBase) {
      var it = document.createElement('div')
      it.textContent = label
      // 与公众号一致：菜单项按自身字号大小显示
      it.style.cssText =
        'padding:7px 18px;cursor:pointer;font-size:' + (isBase ? 14 : px) + 'px;' +
        'line-height:1.4;white-space:nowrap'
      it.onmouseenter = function () { it.style.background = '#f3f4f6' }
      it.onmouseleave = function () { it.style.background = '' }
      // mousedown 阻止默认行为，避免点击菜单时编辑器选区丢失
      it.onmousedown = function (e) { e.preventDefault() }
      it.onclick = function () { choose(isBase ? null : px) }
      menu.appendChild(it)
    }
    item('正文', BASE, true)
    for (var n = 8; n <= 20; n++) item(n + 'px', n, false)
    document.body.appendChild(menu)
    positionMenu()
  }
  function positionMenu() {
    var btn = document.getElementById('ks-size-btn')
    if (!btn || !menu) return
    var r = btn.getBoundingClientRect()
    menu.style.top = r.bottom + 6 + 'px'
    menu.style.left = Math.max(8, r.left - 20) + 'px'
  }
  function curBlockIndex() {
    var bs = blocks()
    var sel = window.getSelection()
    if (!sel || !sel.anchorNode) return -1
    var node = sel.anchorNode
    while (node && bs.indexOf(node) === -1) node = node.parentElement
    return node ? bs.indexOf(node) : -1
  }
  // 光标最后所在的段落：点击字号菜单会让编辑器选区丢失，
  // 记住最后位置，选择字号时回退使用
  var lastIdx = -1
  function choose(px) {
    var idx = curBlockIndex()
    if (idx < 0) idx = lastIdx
    if (idx < 0) { closeMenu(); return }
    var el = blocks()[idx]
    if (!el) { closeMenu(); return }
    if (px === null) delete map[idx]
    else map[idx] = px
    applyCss()
    saveMap()
    updateLabel()
    closeMenu()
  }
  function updateLabel() {
    var btn = document.getElementById('ks-size-btn')
    if (!btn || !btn.childNodes.length) return
    // 公众号式：按钮始终显示当前段落的实际字号（未设置时为正文默认 17px）
    var idx = curBlockIndex()
    if (idx >= 0) lastIdx = idx
    else idx = lastIdx
    var n = (idx >= 0 && map[idx]) ? map[idx] : BASE
    btn.childNodes[0].nodeValue = n + 'px'
  }
  // ── 工具栏按钮 ──
  function ensureButton() {
    // Keystatic 的块类型下拉是 @keystar/ui Picker：触发按钮 aria-label="Text block"
    // （显示当前值 Paragraph / Heading 1-6），直接按该特征定位并替换
    var target =
      document.querySelector('button[aria-label="Text block"]') ||
      document.querySelector('button[aria-label*="block" i]')
    if (!target) return
    if (target.style.display !== 'none') target.style.display = 'none'
    var mine = document.getElementById('ks-size-btn')
    if (!mine) {
      mine = document.createElement('button')
      mine.id = 'ks-size-btn'
      mine.type = 'button'
      mine.textContent = BASE + 'px'
      mine.style.cssText =
        'border:none;background:transparent;cursor:pointer;color:#374151;font-size:14px;' +
        'padding:4px 10px;border-radius:6px;display:inline-flex;align-items:center;gap:2px'
      mine.onmouseenter = function () { mine.style.background = '#f3f4f6' }
      mine.onmouseleave = function () { mine.style.background = 'transparent' }
      mine.onclick = function (e) {
        e.stopPropagation()
        if (menu) closeMenu()
        else buildMenu()
      }
      target.parentElement.insertBefore(mine, target)
    }
  }
  document.addEventListener('click', function (e) {
    if (menu && !menu.contains(e.target) && e.target.id !== 'ks-size-btn') closeMenu()
  })
  document.addEventListener('selectionchange', updateLabel)
  // ── 轮询：应用已存字号 + 校验段落映射 ──
  setInterval(function () {
    var btn = document.getElementById('ks-size-btn')
    if (!onArticlePage()) {
      if (btn) btn.remove()
      closeMenu()
      loaded = false
      map = {}
      return
    }
    loadMap()
    ensureButton()
    editorEl() // Slate 重渲染重建 DOM 后补回 id，CSS 规则持续有效
    var bs = blocks()
    var changed = false
    for (var k in map) {
      if (+k >= bs.length) { delete map[k]; changed = true }
    }
    if (changed) { saveMap(); applyCss() }
  }, 700)
})()`

// 素材库：「所在文件夹」字段自动回填。图片素材存 /static/images，视频等文件存
// /static/media——根据哪个字段有值自动写入，素材库列表的「所在文件夹」列
// 直接展示每个素材的文件所在路径。
const mediaFolderScript = `(function () {
  var MAPS = [
    ['图片素材', '/static/images'],
    ['视频/文件素材', '/static/media'],
  ]
  function fieldInput(prefix) {
    var labels = document.querySelectorAll('label')
    for (var i = 0; i < labels.length; i++) {
      if ((labels[i].textContent || '').trim().indexOf(prefix) === 0) {
        var el = labels[i]
        while (el.parentElement && el.parentElement.querySelectorAll('label').length === 1) {
          el = el.parentElement
        }
        return el.querySelector('input')
      }
    }
    return null
  }
  function onMediaPage() {
    return /\\/collection\\/media\\/(item\\/[^/]+|create)\\/?$/.test(location.pathname)
  }
  setInterval(function () {
    if (!onMediaPage()) return
    var folder = fieldInput('所在文件夹')
    if (!folder) return
    var parts = []
    for (var i = 0; i < MAPS.length; i++) {
      var inp = fieldInput(MAPS[i][0])
      if (inp && inp.value) parts.push(MAPS[i][1])
    }
    var val = parts.join(' + ')
    if (val && folder.value !== val) {
      var setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
      setter.call(folder, val)
      folder.dispatchEvent(new Event('input', { bubbles: true }))
    }
  }, 800)
})()`

// Keystatic 后台布局：全屏容器盖住博客的页头页脚，后台独立呈现
export default function KeystaticLayout() {
  return (
    <div
      id="ks-fullscreen-root"
      className="fixed inset-0 z-50 overflow-auto bg-white"
      style={{ position: 'fixed', inset: 0, zIndex: 50, overflow: 'auto', background: '#fff' }}
    >
      <script dangerouslySetInnerHTML={{ __html: hideSlugColumnScript }} />
      <script dangerouslySetInnerHTML={{ __html: hideFieldsScript }} />
      <script dangerouslySetInnerHTML={{ __html: syncTitleScript }} />
      <script dangerouslySetInnerHTML={{ __html: publishButtonScript }} />
      <script dangerouslySetInnerHTML={{ __html: draftToggleScript }} />
      <script dangerouslySetInnerHTML={{ __html: paragraphSizeScript }} />
      <script dangerouslySetInnerHTML={{ __html: mediaFolderScript }} />
      <script dangerouslySetInnerHTML={{ __html: raiseOverlayScript }} />
      <KeystaticApp />
    </div>
  )
}
