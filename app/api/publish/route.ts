import { NextRequest, NextResponse } from 'next/server'

// 一键发布接口：把 data/drafts/<slug>.mdx 移入 data/blog/，自动完成：
//   1. 取正文第一行（去掉 markdown # 前缀）作为文章标题，并从正文中移除该行
//   2. 发布日期自动生成为当天（东八区）
//   3. 重写 frontmatter（title/date），同名博客文章已存在时拒绝覆盖
//   4. 删除草稿文件
// 鉴权：复用 Keystatic 的登录态（keystatic-gh-access-token cookie，明文令牌；
// 过期时用 keystatic-gh-refresh-token cookie 刷新并回写 cookie，加密方式与
// @keystatic/core 内部实现完全一致：HKDF(SHA-256) 派生密钥 + AES-GCM）。

export const runtime = 'nodejs'

const OWNER = 'PiFriX'
const REPO = 'pifrix'
const BRANCH = 'main'
const GH_API = 'https://api.github.com'

// ── 会话加解密（与 @keystatic/core keystatic-core-api-generic.node.js 一致）──
const SALT_LENGTH = 16
const IV_LENGTH = 12
const encoder = new TextEncoder()
const decoder = new TextDecoder()

function base64UrlDecode(b64: string) {
  const bin = atob(b64.replace(/-/g, '+').replace(/_/g, '/'))
  return Uint8Array.from(bin, (m) => m.codePointAt(0)!)
}

function base64UrlEncode(bytes: Uint8Array) {
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function deriveKey(secret: string, salt: Uint8Array) {
  if (secret.length < 32) {
    throw new Error('KEYSTATIC_SECRET must be at least 32 characters long')
  }
  // new Uint8Array(x) 拷贝一份，保证底层 buffer 是 ArrayBuffer（满足 BufferSource 类型）
  const saltBuf = new Uint8Array(salt)
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), 'HKDF', false, [
    'deriveKey',
  ])
  return crypto.subtle.deriveKey(
    { name: 'HKDF', salt: saltBuf, hash: 'SHA-256', info: new Uint8Array(0) },
    key,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  )
}

async function decryptValue(encrypted: string, secret: string) {
  const decoded = base64UrlDecode(encrypted)
  const salt = new Uint8Array(decoded.slice(0, SALT_LENGTH))
  const key = await deriveKey(secret, salt)
  const iv = new Uint8Array(decoded.slice(SALT_LENGTH, SALT_LENGTH + IV_LENGTH))
  const value = new Uint8Array(decoded.slice(SALT_LENGTH + IV_LENGTH))
  const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, value)
  return decoder.decode(decrypted)
}

async function encryptValue(value: string, secret: string) {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH))
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH))
  const key = await deriveKey(secret, salt)
  const encrypted = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoder.encode(value))
  )
  const out = new Uint8Array(SALT_LENGTH + IV_LENGTH + encrypted.length)
  out.set(salt, 0)
  out.set(iv, SALT_LENGTH)
  out.set(encrypted, SALT_LENGTH + IV_LENGTH)
  return base64UrlEncode(out)
}

// ── 刷新令牌 ──────────────────────────────────────────────────────────────
type RefreshedTokens = {
  access: string
  refreshEnc: string
  accessMaxAge: number
  refreshMaxAge: number
}

async function refreshAccessToken(req: NextRequest): Promise<RefreshedTokens | null> {
  const secret = process.env.KEYSTATIC_SECRET
  const clientId = process.env.KEYSTATIC_GITHUB_CLIENT_ID
  const clientSecret = process.env.KEYSTATIC_GITHUB_CLIENT_SECRET
  const refreshCookie = req.cookies.get('keystatic-gh-refresh-token')?.value
  if (!secret || !clientId || !clientSecret || !refreshCookie) return null

  let refreshToken: string
  try {
    refreshToken = await decryptValue(refreshCookie, secret)
  } catch {
    return null
  }

  const url = new URL('https://github.com/login/oauth/access_token')
  url.searchParams.set('client_id', clientId)
  url.searchParams.set('client_secret', clientSecret)
  url.searchParams.set('grant_type', 'refresh_token')
  url.searchParams.set('refresh_token', refreshToken)
  const res = await fetch(url, { method: 'POST', headers: { Accept: 'application/json' } })
  if (!res.ok) return null
  const data = await res.json()
  if (!data?.access_token || !data?.refresh_token) return null

  try {
    return {
      access: data.access_token,
      refreshEnc: await encryptValue(data.refresh_token, secret),
      accessMaxAge: typeof data.expires_in === 'number' ? data.expires_in : 28800,
      refreshMaxAge:
        typeof data.refresh_token_expires_in === 'number' ? data.refresh_token_expires_in : 5184000,
    }
  } catch {
    return null
  }
}

function tokenCookieHeaders(t: RefreshedTokens): string[] {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : ''
  return [
    `keystatic-gh-access-token=${t.access}; Path=/; Max-Age=${t.accessMaxAge}; SameSite=Lax${secure}`,
    `keystatic-gh-refresh-token=${t.refreshEnc}; Path=/; Max-Age=${t.refreshMaxAge}; HttpOnly; SameSite=Lax${secure}`,
  ]
}

// ── 工具 ──────────────────────────────────────────────────────────────────
function beijingToday() {
  return new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10)
}

function yamlQuote(s: string) {
  return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

// ── 主逻辑 ────────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const slug = req.nextUrl.searchParams.get('slug') || ''
  if (!slug || /[\\/]/.test(slug)) {
    return NextResponse.json({ ok: false, error: '无效的文章标识' }, { status: 400 })
  }

  let token = req.cookies.get('keystatic-gh-access-token')?.value ?? ''
  if (!token) {
    return NextResponse.json(
      { ok: false, error: '尚未登录后台，请刷新页面重新进入后再发布' },
      { status: 401 }
    )
  }

  const gh = (path: string, init: RequestInit = {}, t: string = token) =>
    fetch(`${GH_API}/repos/${OWNER}/${REPO}/contents/${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${t}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(init.headers || {}),
      },
    })

  const draftPath = `data/drafts/${slug}.mdx`
  const blogPath = `data/blog/${slug}.mdx`

  // 1. 读草稿（令牌过期则刷新重试一次）
  let draftRes = await gh(draftPath)
  let refreshed: RefreshedTokens | null = null
  if ((draftRes.status === 401 || draftRes.status === 403) && !refreshed) {
    refreshed = await refreshAccessToken(req)
    if (refreshed) {
      token = refreshed.access
      draftRes = await gh(draftPath, {}, token)
    }
  }
  if (draftRes.status === 404) {
    return withRefresh(
      NextResponse.json(
        { ok: false, error: '草稿不存在（可能已发布过，或文件名已变化）' },
        { status: 404 }
      ),
      refreshed
    )
  }
  if (!draftRes.ok) {
    const detail = await draftRes.text().catch(() => '')
    return withRefresh(
      NextResponse.json(
        { ok: false, error: `读取草稿失败（GitHub ${draftRes.status}）${detail.slice(0, 160)}` },
        { status: 502 }
      ),
      refreshed
    )
  }
  const draftJson = await draftRes.json()
  const draftSha: string = draftJson.sha
  const raw = Buffer.from(String(draftJson.content || '').replace(/\s/g, ''), 'base64').toString(
    'utf8'
  )

  // 2. 分离 frontmatter 与正文，取第一行作标题
  let body = raw
  if (raw.startsWith('---')) {
    const end = raw.indexOf('\n---', 3)
    if (end !== -1) body = raw.slice(end + 4).replace(/^\s*\n/, '')
  }
  const lines = body.split('\n')
  const titleIdx = lines.findIndex((l) => l.trim() !== '')
  let title = ''
  if (titleIdx !== -1) {
    title = lines[titleIdx].replace(/^\s*#+\s*/, '').trim()
    lines.splice(titleIdx, 1)
  }
  if (!title) title = '未命名文章'
  const newBody =
    lines
      .join('\n')
      .replace(/^\s*\n/, '')
      .trimEnd() + '\n'
  const newContent = `---\ntitle: ${yamlQuote(title)}\ndate: ${beijingToday()}\n---\n\n${newBody}`

  // 3. 防覆盖检查
  const existRes = await gh(blogPath, {}, token)
  if (existRes.ok) {
    return withRefresh(
      NextResponse.json(
        { ok: false, error: `发表记录里已存在同名文章（${slug}），请先把草稿改成其他标题再发布` },
        { status: 409 }
      ),
      refreshed
    )
  }

  // 4. 写入 data/blog/
  const putRes = await gh(blogPath, {
    method: 'PUT',
    body: JSON.stringify({
      message: `发布文章：${title}`,
      content: Buffer.from(newContent, 'utf8').toString('base64'),
      branch: BRANCH,
    }),
  })
  if (!putRes.ok) {
    const detail = await putRes.text().catch(() => '')
    return withRefresh(
      NextResponse.json(
        { ok: false, error: `写入博客失败（GitHub ${putRes.status}）${detail.slice(0, 160)}` },
        { status: 502 }
      ),
      refreshed
    )
  }

  // 5. 删除草稿（失败不算发布失败，提示手动删）
  const delRes = await gh(draftPath, {
    method: 'DELETE',
    body: JSON.stringify({
      message: `发布文章：${title}（移除草稿）`,
      sha: draftSha,
      branch: BRANCH,
    }),
  })
  const warning = delRes.ok ? undefined : '文章已发布，但草稿删除失败，请到草稿箱手动删除'

  return withRefresh(NextResponse.json({ ok: true, title, warning }), refreshed)
}

function withRefresh(res: NextResponse, refreshed: RefreshedTokens | null) {
  if (refreshed) {
    for (const c of tokenCookieHeaders(refreshed)) res.headers.append('Set-Cookie', c)
  }
  return res
}
