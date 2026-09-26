import { makeRouteHandler } from '@keystatic/next/route-handler'
import keystaticConfig from '../../../../keystatic.config'

// Keystatic 的 API 路由：处理 GitHub OAuth 登录与内容提交
export const { GET, POST } = makeRouteHandler({
  config: keystaticConfig,
})
