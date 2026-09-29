import { config, collection, fields } from '@keystatic/core'

export default config({
  // 生产构建（服务器与客户端一致求值）使用 GitHub 模式（在线提交）；
  // 本地开发自动降级为 local 模式，直接读写本地文件。
  // 注意：不能用 KEYSTATIC_GITHUB_CLIENT_ID 判断——该变量在客户端包中不存在，
  // 会导致客户端和服务端的 storage 模式不一致。
  storage:
    process.env.NODE_ENV === 'production'
      ? { kind: 'github', repo: 'PiFriX/pifrix' }
      : { kind: 'local' },
  ui: {
    brand: { name: 'PiFriX 内容后台' },
    // 侧栏模仿公众号「内容管理」：草稿箱 / 素材库 / 发表记录
    navigation: {
      内容: ['drafts', 'media', 'posts'],
      其他: ['authors'],
    },
  },
  collections: {
    // ── 草稿箱 ────────────────────────────────────────────────
    // 写新文章从这里开始，文件存到 data/drafts/（contentlayer 不扫描该目录，
    // 草稿不会出现在博客前台）。发布方式：在「发表记录」里新建同名文章，
    // 把正文复制过去（Keystatic 不支持跨集合移动条目），再回草稿箱删除草稿。
    drafts: collection({
      label: '草稿箱',
      slugField: 'title',
      path: 'data/drafts/*',
      columns: ['title'],
      format: { contentField: 'content' },
      entryLayout: 'content',
      schema: {
        // 标题（含 URL 路径）是条目的文件名和唯一标识，Keystatic 必需，无法移除；
        // 但编辑页会通过 layout 注入脚本隐藏显示，创建时填一次即可（发布时
        // 正文第一行会作为真正的文章标题，这里的标题只是文件名）。
        // 发布日期默认今天，隐藏显示，自动生成。
        title: fields.slug({
          name: { label: '标题', validation: { isRequired: true } },
          slug: { label: 'URL 路径（自动生成，可改）' },
        }),
        date: fields.date({ label: '发布日期', defaultValue: { kind: 'today' } }),
        // 正文字号（1-20，博客前台真实生效）：面板隐藏后由右下角「字号」浮动按钮设置
        fontSize: fields.integer({ label: '正文字号（1-20）', defaultValue: 16 }),
        content: fields.mdx({
          label: '正文',
          options: {
            image: {
              directory: 'public/static/images',
              publicPath: '/static/images/',
            },
          },
        }),
      },
    }),
    // ── 素材库 ────────────────────────────────────────────────
    // 每个条目 = 一个素材文件夹：图片存 public/static/images，视频等文件存
    // public/static/media。「所在文件夹」字段由注入脚本根据已上传的素材自动回填，
    // 列表里直接展示每个素材的图片/视频所在路径；点进条目可预览图片、查看/下载视频。
    media: collection({
      label: '素材库',
      slugField: 'name',
      path: 'data/media/*',
      format: { data: 'yaml' },
      columns: ['name', 'folder'],
      schema: {
        name: fields.slug({
          name: { label: '素材名称', validation: { isRequired: true } },
          slug: { label: '文件夹（自动生成，可改）' },
        }),
        folder: fields.text({ label: '所在文件夹（自动）' }),
        image: fields.image({
          label: '图片素材（保存在 /static/images 文件夹）',
          directory: 'public/static/images',
          publicPath: '/static/images',
        }),
        video: fields.file({
          label: '视频/文件素材（保存在 /static/media 文件夹）',
          directory: 'public/static/media',
          publicPath: '/static/media',
        }),
        note: fields.text({ label: '备注（用途说明）', multiline: true }),
      },
    }),
    // ── 发表记录 ──────────────────────────────────────────────
    // 已发布的文章（data/blog/），即博客前台实际渲染的内容。
    // 草稿通过 /api/publish 接口一键移入此集合（自动取正文第一行为标题、
    // 自动生成日期），见 app/api/publish/route.ts。
    posts: collection({
      label: '发表记录',
      slugField: 'title',
      path: 'data/blog/*',
      // 列表默认只显示文件名(slug)，追加这些列后可直接看到文章标题，
      // 与博客前台显示保持一致（列名取字段的 label）。
      columns: ['title', 'date', 'draft'],
      format: { contentField: 'content' },
      entryLayout: 'content',
      schema: {
        // 精简表单：仅保留博客构建必需的 标题/发布日期，以及下架开关 草稿。
        // 注意：Keystatic 保存时只写 schema 里的字段——从表单移除的 摘要/标签/
        // 作者/最后修改日期/配图/布局，在该文章下次保存时会从前言中一并抹除
        // （标签页、列表摘要等前台功能随之对这些文章失效，属预期取舍）。
        title: fields.slug({
          name: { label: '标题', validation: { isRequired: true } },
          slug: { label: 'URL 路径（自动生成，可改）' },
        }),
        date: fields.date({
          label: '发布日期',
          validation: { isRequired: true },
          defaultValue: { kind: 'today' },
        }),
        // 正文字号（1-20，博客前台真实生效）：面板隐藏后由右下角「字号」浮动按钮设置
        fontSize: fields.integer({ label: '正文字号（1-20）', defaultValue: 16 }),
        draft: fields.checkbox({ label: '草稿（勾选后前台不显示）', defaultValue: false }),
        // 正文图片统一存到 public/static/images（与博客其他图片一致）。
        // 注意：options.image 只管理"本地路径"图片；正文里若写 https:// 外链图片，
        // Keystatic 0.6.9 会误当作本地资源并生成错误删除路径，导致保存时报
        // "[GraphQL] A path was requested for deletion..."（见 Thinkmill/keystatic#1625）。
        content: fields.mdx({
          label: '正文',
          options: {
            image: {
              directory: 'public/static/images',
              publicPath: '/static/images/',
            },
          },
        }),
      },
    }),
    authors: collection({
      label: '作者',
      slugField: 'name',
      path: 'data/authors/*',
      format: { contentField: 'content' },
      entryLayout: 'content',
      schema: {
        name: fields.slug({ name: { label: '姓名', validation: { isRequired: true } } }),
        avatar: fields.image({
          label: '头像',
          directory: 'public/static/images',
          publicPath: '/static/images',
        }),
        occupation: fields.text({ label: '职业' }),
        company: fields.text({ label: '公司' }),
        email: fields.text({ label: '邮箱' }),
        twitter: fields.text({ label: 'Twitter' }),
        bluesky: fields.text({ label: 'Bluesky' }),
        linkedin: fields.text({ label: 'LinkedIn' }),
        github: fields.text({ label: 'GitHub' }),
        layout: fields.text({ label: '布局' }),
        content: fields.mdx({
          label: '个人简介',
          options: {
            image: {
              directory: 'public/static/images',
              publicPath: '/static/images/',
            },
          },
        }),
      },
    }),
  },
})
