import { allBlogs } from 'contentlayer/generated'
import AdminDashboard from './AdminDashboard'

export const metadata = {
  title: '内容管理',
  robots: { index: false, follow: false },
}

// 公众号式内容管理页：构建时读取全部文章（含草稿），按 draft 字段分成
// 「草稿箱」「发表记录」两个视图。每次在 Keystatic 后台保存都会提交到
// GitHub 并触发 Vercel 重新构建，本页数据随之自动更新。
// 点击「编辑」直接跳进 Keystatic 中该文章的编辑页，写作流程不变。
export default function AdminPage() {
  // 生产环境是 GitHub 存储模式，Keystatic 路由带 branch 段；本地 dev 是 local 模式
  const isProd = process.env.NODE_ENV === 'production'
  const editBase = isProd
    ? '/keystatic/branch/main/collection/posts/item'
    : '/keystatic/collection/posts/item'
  const createUrl = isProd
    ? '/keystatic/branch/main/collection/posts/create'
    : '/keystatic/collection/posts/create'

  const posts = allBlogs
    .map((p) => ({
      slug: p.slug,
      title: p.title,
      date: p.date,
      draft: p.draft ?? false,
      summary: p.summary ?? '',
      tags: p.tags ?? [],
    }))
    .sort((a, b) => (a.date < b.date ? 1 : -1))

  return <AdminDashboard posts={posts} editBase={editBase} createUrl={createUrl} />
}
