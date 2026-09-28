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
        title: fields.slug({
          name: { label: '标题', validation: { isRequired: true } },
          slug: { label: 'URL 路径（自动生成，可改）' },
        }),
        summary: fields.text({ label: '摘要', multiline: true }),
        date: fields.date({ label: '发布日期' }),
        tags: fields.array(fields.text({ label: '标签名' }), {
          label: '标签',
          itemLabel: (props) => props.value || '新标签',
        }),
        authors: fields.array(fields.text({ label: '作者 slug（对应 data/authors 下的文件名）' }), {
          label: '作者',
          itemLabel: (props) => props.value || '作者',
        }),
        images: fields.array(
          fields.image({
            label: '配图',
            directory: 'public/static/images',
            publicPath: '/static/images',
          }),
          {
            label: '文章封面/配图',
            itemLabel: (props) => props.value?.filename || '图片',
          }
        ),
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
    // 每个条目 = 一份素材：图片存 public/static/images，视频等文件存
    // public/static/media。点进条目可预览图片、查看/下载视频文件；
    // 正文里引用时用编辑器图片按钮或粘贴对应 /static/... 路径。
    media: collection({
      label: '素材库',
      slugField: 'name',
      path: 'data/media/*',
      format: { data: 'yaml' },
      schema: {
        name: fields.slug({
          name: { label: '素材名称', validation: { isRequired: true } },
          slug: { label: '文件标识（自动生成，可改）' },
        }),
        image: fields.image({
          label: '图片素材',
          directory: 'public/static/images',
          publicPath: '/static/images',
        }),
        video: fields.file({
          label: '视频/文件素材',
          directory: 'public/static/media',
          publicPath: '/static/media',
        }),
        note: fields.text({ label: '备注（用途说明）', multiline: true }),
      },
    }),
    // ── 发表记录 ──────────────────────────────────────────────
    // 已发布的文章（data/blog/），即博客前台实际渲染的内容。
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
        title: fields.slug({
          name: { label: '标题', validation: { isRequired: true } },
          slug: { label: 'URL 路径（自动生成，可改）' },
        }),
        summary: fields.text({ label: '摘要', multiline: true }),
        date: fields.date({ label: '发布日期', validation: { isRequired: true } }),
        lastmod: fields.date({ label: '最后修改日期' }),
        tags: fields.array(fields.text({ label: '标签名' }), {
          label: '标签',
          itemLabel: (props) => props.value || '新标签',
        }),
        authors: fields.array(fields.text({ label: '作者 slug（对应 data/authors 下的文件名）' }), {
          label: '作者',
          itemLabel: (props) => props.value || '作者',
        }),
        draft: fields.checkbox({ label: '草稿（勾选后不显示在站点上）', defaultValue: false }),
        layout: fields.text({ label: '布局（横幅文章用 PostBanner）' }),
        images: fields.array(
          fields.image({
            label: '配图',
            directory: 'public/static/images',
            publicPath: '/static/images',
          }),
          {
            label: '文章封面/配图',
            itemLabel: (props) => props.value?.filename || '图片',
          }
        ),
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
