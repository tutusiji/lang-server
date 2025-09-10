# i18n 服务端架构设计文档

> 适用于 `vue3-i18n-api`（Fastify）。描述语言资源生命周期、接口协议、版本策略与未来扩展。

---
## 1. 设计目标
| 目标 | 说明 |
|------|------|
| 低门槛 | 纯 JSON 文件存储，易读易 diff |
| 安全可控 | 后续可接入鉴权、审计、回滚 |
| 一致性 | 前端一次聚合请求即可获得全部必要数据 |
| 可扩展 | 后续平滑迁移 DB / 对象存储 |
| 可追踪 | 版本号 + 时间戳 + 打包下载 |
| 自动化 | 新增/更新/删除自动 bump version |

---
## 2. 目录结构
```
vue3-i18n-api/
  data/
    language-list.json        # 语言配置 + 版本号 + 默认/回退语言
    language-template.json    # 新语言初始模板
    languages/*.json          # 每种语言的翻译文件
  downloads/                 # 生成的打包 zip / 临时语言包
  temp/                      # 旧接口生成的临时压缩包
  src/
    routes/i18n.js           # 全量路由（REST API）
    server.js                # Fastify 启动入口
```

---
## 3. 数据模型
### 3.1 language-list.json
```
{
  "version": "1.2.3",
  "lastUpdated": "2025-09-11T08:12:22.123Z",
  "defaultLanguage": "zh-CN",
  "fallbackLanguage": "zh-CN",
  "languages": [
    {"code":"zh-CN","name":"简体中文","nativeName":"中文","enabled":true,"file":"zh-CN.json"},
    {"code":"en-US","name":"English","nativeName":"English","enabled":true,"file":"en-US.json"}
  ]
}
```
### 3.2 单语言文件
- 纯对象结构 `{ section: { key: "value" } }`，无额外包裹。

---
## 4. 版本策略
| 行为 | 触发 version 递增 | 说明 |
|------|------------------|------|
| 新增语言 | 是 | 自动写入模板文件并修改列表 |
| 更新整文件 | 是 | `/language/:code/update` 覆盖写入 |
| 批量 key 更新 | 成功≥1语言时 | `/languages/update-key-batch` 至少一项成功才 bump |
| 删除语言 | 是 | 列表移除 + 文件删除 |
| 仅读取 | 否 | GET 请求不影响版本 |

递增方式：当前实现为内部 `incrementVersion()`（语义：主版本保持，补丁位 +1 或按策略自定义）。可后续替换为符合 SemVer 的多段控制或 git tag 驱动。

---
## 5. 核心接口
| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /api/i18n/health | 健康检查 |
| GET | /api/i18n/data/complete | 聚合：版本 + 配置 + messages |
| GET | /api/i18n/language/:code | 获取某语言翻译文件 |
| POST| /api/i18n/language/:code/update | 全量更新某语言 |
| POST| /api/i18n/language/:code/update-key | 更新单 key |
| POST| /api/i18n/languages/update-key-batch | 批量更新多个语言的同一 key |
| POST| /api/i18n/language | 新增或覆盖（overwrite=true）语言 |
| POST| /api/i18n/language/:code/delete | 删除语言（保护核心语言） |
| GET | /api/i18n/download/latest | 获取最新打包包下载信息 |
| POST| /api/i18n/download/create-package | 立即打包当前版本 |
| GET | /api/i18n/download/all | 生成临时全量包（旧接口兼容） |
| GET | /api/i18n/manifest | 生成增量/校验清单 |

---
## 6. 聚合接口 /data/complete
一次性返回：
```
{
  success: true,
  version: "1.2.3",
  lastUpdated: "2025-09-11T08:12:22.123Z",
  languages: [...],
  messages: { "zh-CN": { ... }, "en-US": { ... } },
  defaultLanguage: "zh-CN",
  fallbackLanguage: "zh-CN"
}
```
前端逻辑：比较本地缓存版本 vs 返回版本，决定是否覆盖。减少多请求竞态。

---
## 7. 删除语言流程
```
POST /language/:code/delete
  → 校验存在性
  → 校验是否受保护 (zh-CN / en-US / zh-TW)
  → 列表移除 & 文件删除
  → bump version & 更新 lastUpdated
```
前端需：
1. 禁止删除当前 locale；
2. 删除成功后强制刷新 store；
3. 若当前 locale 被后台手动移除（非常规操作），前端 fallbackLanguage 兜底。

---
## 8. 打包与下载
| 接口 | 说明 |
|------|------|
| /download/create-package | 生成版本化 zip (language-${version}.zip) 放入 downloads/ |
| /download/latest | 若包不存在，自动生成后返回下载链接 |
| /download/all | 临时压缩所有文件（含版本信息），30 分钟后清理 |

包内容（最新版）：
```
language-list.json
languages/<code>.json * n
version.json (冗余: version + lastUpdated)
```

---
## 9. 容错与日志
| 场景 | 处理 |
|------|------|
| 语言文件不存在 | 返回 404 JSON（不会抛栈） |
| JSON 读写错误 | 500 + error.message 日志落地 |
| 删除受保护语言 | 400 业务错误 |
| 部分批量 key 更新失败 | 返回 errors 数组 + 成功部分仍 bump |

fastify 日志：包含 level、时间戳、错误栈；可接 ELK / Loki。

---
## 10. 安全与未来扩展
| 方向 | 说明 |
|------|------|
| 鉴权 | 增加 API Key / JWT / RBAC 鉴权中间件 |
| 审计 | 变更写操作记录 diff（文件级或 key 级） |
| 回滚 | 保存历史快照（Git / 历史目录） |
| 增量更新 | 基于 manifest diff 下发变化文件列表 |
| CDN 分发 | 打包 zip 推送到 OSS/CDN 缓存 |
| 冷热分层 | 高频语言与低频语言拆分目录 |

---
## 11. 推荐前端交互配合
| 行为 | 前端策略 |
|------|----------|
| 新增语言 | 添加成功后强制拉取 `/data/complete`（forceRefresh）|
| 删除语言 | 删除后刷新；若当前语言被删除，用 defaultLanguage 切换 |
| 批量翻译 | 用批量 key 接口；成功后刷新版本显示 |
| 大量修改 | 先批量更新 key，再一次打包生成下载 | 

---
## 12. Roadmap 增强
| 优先 | 项目 | 描述 |
|------|------|------|
| ★★★ | 权限控制 | API 分级：只读 / 维护 / 管理员 |
| ★★★ | 差量接口 | 返回自指定版本后的变更列表 |
| ★★☆ | Webhook | 版本更新回调触发 CI/CD / 缓存刷新 |
| ★★☆ | 回滚接口 | 指定 version 还原 language-list + files |
| ★☆☆ | 多租户隔离 | 增加 tenantId 分组语言目录 |

---
## 13. FAQ
| 问题 | 解答 |
|------|------|
| 为什么不用 DB? | 当前阶段 JSON 足够 + 低维护；后续可抽象存储层迁移 |
| version 规则? | 内部自增（补丁位）；可改为 SemVer 分段策略 |
| 删除后包旧版本仍含该语言? | 是，历史包不改；新打包才反映变更 |
| 怎么做灰度? | 通过并行维护 beta 分支 language-list 或增加 flag 字段 |

---
## 14. 总结
该服务端实现以最少依赖与透明文件结构提供稳定的多语言后端，配合前端的本地优先与聚合拉取，已满足动态扩展、离线分发及快速新增语言需求。下一阶段重点应放在鉴权、审计、增量与回滚，以支撑规模化运营。
