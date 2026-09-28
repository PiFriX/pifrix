'use client'

import Link from 'next/link'
import { useState } from 'react'

type AdminPost = {
  slug: string
  title: string
  date: string
  draft: boolean
  summary: string
  tags: string[]
}

// 公众号绿，用于高亮当前标签、已发表状态和新建按钮
const GREEN = '#07c160'

function formatDate(d: string) {
  const dt = new Date(d)
  if (Number.isNaN(dt.getTime())) return d
  const y = dt.getFullYear()
  const m = String(dt.getMonth() + 1).padStart(2, '0')
  const day = String(dt.getDate()).padStart(2, '0')
  return `${y}年${m}月${day}日`
}

// 公众号风格的内容管理视图：草稿箱 / 发表记录 双标签
export default function AdminDashboard({
  posts,
  editBase,
  createUrl,
}: {
  posts: AdminPost[]
  editBase: string
  createUrl: string
}) {
  const [tab, setTab] = useState<'drafts' | 'published'>('published')
  const published = posts.filter((p) => !p.draft)
  const drafts = posts.filter((p) => p.draft)
  const list = tab === 'published' ? published : drafts

  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      {/* 顶部：标题 + 写新文章 */}
      <div className="mb-2 flex items-center justify-between">
        <h1 className="text-2xl font-bold">内容管理</h1>
        <a
          href={createUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="rounded-full px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90"
          style={{ background: GREEN }}
        >
          + 写新文章
        </a>
      </div>
      <p className="mb-6 text-sm text-gray-500 dark:text-gray-400">
        {tab === 'published'
          ? `共发表了 ${published.length} 次`
          : `草稿箱里有 ${drafts.length} 篇未发表`}
      </p>

      {/* 标签页：草稿箱 / 发表记录 */}
      <div className="mb-2 flex gap-8 border-b border-gray-200 dark:border-gray-700">
        {(['drafts', 'published'] as const).map((t) => {
          const active = tab === t
          return (
            <button
              key={t}
              onClick={() => setTab(t)}
              className="relative pb-2 text-sm font-medium transition-colors"
              style={{ color: active ? GREEN : undefined }}
            >
              {t === 'drafts' ? `草稿箱 (${drafts.length})` : `发表记录 (${published.length})`}
              {active && (
                <span
                  className="absolute inset-x-0 -bottom-px h-0.5 rounded"
                  style={{ background: GREEN }}
                />
              )}
            </button>
          )
        })}
      </div>

      {/* 列表 */}
      {list.length === 0 ? (
        <p className="py-16 text-center text-sm text-gray-400">
          {tab === 'drafts' ? '草稿箱是空的，点右上角「写新文章」动笔吧' : '还没有发表过文章'}
        </p>
      ) : (
        <ul className="divide-y divide-gray-100 dark:divide-gray-800">
          {list.map((p) => (
            <li key={p.slug} className="flex items-start gap-4 py-4">
              {/* 左：日期与状态（公众号样式） */}
              <div className="w-28 shrink-0 text-xs leading-5">
                <div className="text-gray-500 dark:text-gray-400">{formatDate(p.date)}</div>
                <div style={{ color: p.draft ? undefined : GREEN }}>
                  {p.draft ? <span className="text-gray-400">未发表</span> : <span>已发表</span>}
                </div>
              </div>

              {/* 中：标题、摘要、标签 */}
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{p.title || p.slug}</div>
                {p.summary && (
                  <p className="mt-1 line-clamp-2 text-sm text-gray-500 dark:text-gray-400">
                    {p.summary}
                  </p>
                )}
                {p.tags.length > 0 && (
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {p.tags.map((t) => (
                      <span
                        key={t}
                        className="rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-500 dark:bg-gray-800 dark:text-gray-400"
                      >
                        {t}
                      </span>
                    ))}
                  </div>
                )}
              </div>

              {/* 右：操作按钮 */}
              <div className="flex shrink-0 items-center gap-2 pt-1">
                <a
                  href={`${editBase}/${p.slug}/`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded border border-gray-200 px-2.5 py-1 text-xs text-gray-600 transition-colors hover:border-[#07c160] hover:text-[#07c160] dark:border-gray-700 dark:text-gray-300"
                >
                  编辑
                </a>
                {!p.draft && (
                  <Link
                    href={`/blog/${p.slug}`}
                    className="rounded border border-gray-200 px-2.5 py-1 text-xs text-gray-600 transition-colors hover:border-gray-400 dark:border-gray-700 dark:text-gray-300"
                  >
                    预览
                  </Link>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      <p className="mt-10 text-center text-xs text-gray-400">
        保存文章后本页会随 Vercel 重新构建自动更新（约 1~2 分钟）
      </p>
    </div>
  )
}
