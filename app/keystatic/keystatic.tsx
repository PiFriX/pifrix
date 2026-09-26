'use client'

// Keystatic 后台客户端入口。
// 必须放在 'use client' 文件中：keystatic.config 含函数（字段校验器等），
// 只有作为客户端模块打包才能完整保留；若经服务端组件 props 传递会被序列化丢弃，
// 导致后台页面空白。
import { makePage } from '@keystatic/next/ui/app'
import keystaticConfig from '../../keystatic.config'

export default makePage(keystaticConfig)
