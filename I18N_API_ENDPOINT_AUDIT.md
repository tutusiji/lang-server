## i18n 接口使用审计与精简建议

更新时间: 2025-09-12

本文档审计 `src/routes/i18n.js` 中全部 HTTP 路由，标注当前前端（`vue3-ts-web`）实际调用情况、内部调用情况、冗余与精简建议，并给出后续治理计划。

---
## 1. 总览表

| 路由 | 方法 | 作用 | 前端是否使用 | 后端是否内部 HTTP 调用 | 建议状态 | 可直接删除? | 删除条件 |
|------|------|------|--------------|-------------------------|----------|--------------|------------|
| /health | GET | 健康检查 | 可选（未显式使用） | 否 | 保留（运维） | 否 | 需要时保留 |
| /data/complete | GET | 一次性获取全部配置+messages | 使用 | 否 | 核心保留 | 否 | — |
| /language/:code | GET | 获取单语言文件 | 使用 | 否 | 保留（懒加载/补充） | 否 | — |
| /language/:code/update | POST | 覆盖保存单语言文件 | 使用 | 否 | 保留 | 否 | — |
| /languages/update-key-batch | POST | 批量更新某个 key 在多语言的值 | 使用 | 否 | 保留（可重命名） | 否 | — |
| /language | POST | 新增语言 | 使用 | 否 | 保留 | 否 | — |
| /language/:code/delete | POST | 删除语言 | 使用 | 否 | 保留 | 否 | — |
| /download/latest | GET | 获取当前版本语言包下载信息 | 使用 | 否 | 保留 | 否 | — |
| /download/create-package | POST | 手动生成当前版本语言包 | 使用 | 否 | 保留（可转后台异步） | 否 | — |
| /download/file/:fileName | GET | 静态/临时 zip 文件下载 | 间接使用 | 否 | 保留 | 否 | — |
| /version/check | POST | 比较客户端与服务器版本 | 未使用 | 否 | 废弃 | 是 | 直接删（无引用） |
| /languages | GET | 仅获取语言列表配置 | 未使用 | 否 | 废弃（或保留轻量） | 是 | 确认无需轻量接口 |
| /languages/batch | POST | 批量获取多语言文件 | 未使用 | 否 | 废弃 | 是 | 直接删（被 /data/complete 超集） |
| /languages/enabled-messages | GET | 获取启用语言 + messages | 未使用 | 否 | 废弃 | 是 | 直接删（冗余） |
| /languages/update | POST | 整体覆盖语言列表配置 | 未使用 | 否 | 废弃 | 是 | 无整表覆盖需求 |
| /language/:code/update-key | POST | 单语言某 key 更新 | 未使用 | 否 | 废弃（兼容期可选） | 是 | 若无需单 key PATCH 直接删 |
| /manifest | GET | 提供文件清单（增量更新） | 未使用 | 否 | 废弃 | 是 | 不做增量同步 |
| /download/all | GET | 旧版一次性打包到临时目录 | 未使用 | 否 | 废弃 | 是 | 新打包方案稳定 |

说明：
1. “间接使用” 指前端通过 `downloadUrl` 打开的实际下载链接。
2. “后端是否内部 HTTP 调用” 一列均为“否”，当前后端没有在自身代码内以 HTTP 方式调用这些路由；内部复用是通过普通函数（`incrementVersion`, `createLanguagePackage`, `propagateKeyToAllLanguages`）完成。

---
## 2. 内部函数与路由关系

| 内部函数 | 被谁调用 | 触发点 | 说明 |
|----------|----------|--------|------|
| incrementVersion() | 多个更新/增删接口 & propagateKeyToAllLanguages | 写操作后 | 增量补丁号 + 更新时间 + 自动打包 zip |
| createLanguagePackage(version) | incrementVersion / 手动打包接口 | 版本变更或手动 | 压缩 language-list.json 与 languages 目录 |
| propagateKeyToAllLanguages(key, ...) | /language/:code/update-key, /languages/update-key-batch | key 级更新后 | 确保所有语言 & 模板含该 key，并 bump 版本 |
| setNestedKey(obj,key,val) | 以上更新逻辑 | 嵌套写入 | 支持 a.b.c 路径写入 |
| compareVersions | /version/check | 版本比对 | 仅此路由使用（路由计划废弃后可一并移除） |

无内部 HTTP“自调用”现象；优化或裁剪路由不会破坏内部函数链，仅需关注：`propagateKeyToAllLanguages` 已主动再调用 `incrementVersion`，避免重复 bump。

---
## 3. 冗余与冲突点说明

1. /languages/enabled-messages 与 /data/complete：语义重叠，后者更通用。
2. /language/:code/update-key 与 /languages/update-key-batch：功能交集；batch 已覆盖单语言场景。
3. /version/check：客户端可直接对比 /data/complete 返回的 `version`，路由价值有限。
4. /manifest：若不实施“差量拉取”/按文件校验策略，可移除。
5. /download/all：旧的临时 zip 方案已由版本化 `language-x.y.z.zip` 体系替换，留存增加维护噪音。
6. /languages/update：粗粒度覆盖式写入，易误删；目前前端无此操作流程。

---
## 4. 建议的“精简核心路由集”

保留（核心）：
- GET /health
- GET /data/complete
- GET /language/:code
- POST /language
- POST /language/:code/delete
- POST /language/:code/update
- POST /languages/update-key-batch （未来可重命名为 PATCH /translations/key/batch）
- GET /download/latest
- POST /download/create-package
- GET /download/file/:fileName

辅助（按需保留）：
- GET /languages （若确实需要一个轻量“仅配置”接口，可保留并在文档中声明与 /data/complete 区别）

拟废弃：
- POST /version/check
- POST /languages/batch
- GET /languages/enabled-messages
- POST /languages/update
- POST /language/:code/update-key
- GET /manifest（除非后续增量同步）
- GET /download/all

---
## 5. 废弃策略建议

若确认当前只有一个前端客户端且已验证未调用，可直接执行“立即删除”策略（见上一表“可直接删除?”列）。

两种模式：

1) 快速清理（推荐，单客户端场景）
   - 直接移除所有标记“是”的未使用路由。
   - 删除辅助函数 `compareVersions`（仅被 /version/check 使用）。
   - 更新文档并提交。

2) 渐进废弃（多客户端或不确定）
   - 添加响应头：`Deprecation: true`, `Sunset: <日期>`。
   - 日志记录访问次数，30 天后移除。

当前建议：若已确认没有其它依赖者，采用“快速清理”。

---
## 6. 进一步优化建议

| 主题 | 问题 | 建议 |
|------|------|------|
| 频繁打包 | 每次版本递增立即 ZIP | 增加防抖（例如 5s 聚合）或通过队列延迟；提供环境变量 `AUTO_BUILD_PACKAGE=false` 时跳过自动打包 |
| 响应一致性 | /language/:code 返回 data=translations 无 code | 改为 `{ data: { code, translations } }`，前端兼容老格式一段时间 |
| Key 校验 | 仅前端校验 | 后端新增正则 `^[A-Za-z0-9_-]+(\.[A-Za-z0-9_-]+)+$` 拒绝非法 key |
| 错误聚合 | 批量更新部分失败不显式 | 在 batch 响应中添加 `partial:true/false` 标志 |
| 命名规范 | update-key-batch 易冗长 | 统一命名：`/translations/key/batch` 或 `/keys/batch` (REST / PATCH) |
| 语言模板 | 模板 key 默认值永远空串 | 可配置：若更新语言是 fallback 语言，将其值同步为模板默认值 |
| 监控 | 缺少关键指标 | 增加：版本打包耗时、语言文件大小、批量更新失败率等日志/metrics |

---
## 7. 现状风险评估

| 风险 | 等级 | 说明 | 缓解措施 |
|------|------|------|----------|
| 不必要的接口面 | 中 | 增加维护/安全面 | 按计划废弃 |
| 高频打包 I/O | 中 | 频繁写 zip，性能浪费 | 防抖/异步 |
| 缺少后端 key 校验 | 低 | 可被绕过写入非法结构 | 增加正则与长度限制 |
| 响应结构不统一 | 低 | 易混淆类型 | 统一返回模型 |
| 模板与语言不一致 | 低 | 仅在手动编辑模板情况下 | 通过脚本同步或 UI 隐藏模板直接写入所有语言 |

---
## 8. 行动清单（建议执行顺序）

1. (Doc) 合并本文件到仓库（已完成）
2. (Code) 给“拟废弃”路由加 Deprecation 响应头与日志 tag
3. (Code) 后端增加 key 命名校验 & 统一 /language/:code 响应结构
4. (Infra) 引入打包防抖策略（简单 setTimeout 聚合）
5. (Refactor) rename `/languages/update-key-batch` -> `/translations/key/batch`（保留旧别名 30 天）
6. (Cleanup) 到期删路由 + 删除 compareVersions + 删除 manifest / download/all 逻辑
7. (Observability) 增加简单耗时日志（zip 打包、批量更新）

---
## 9. 结论

当前真正支撑业务的接口集中且清晰；未使用接口占比较高（>35%），清理后可降低维护成本与潜在攻击面。内部逻辑函数之间无 HTTP 自调用耦合，精简风险低。建议分两步（标记 → 移除）完成治理，并同步完善校验与性能小优化。

---
## 10. 附：判定方法说明

1. 通过前端源码 `src/utils/i18nApi.ts` 检索实际封装的调用路径。
2. 全局搜索端点字符串（包括 `update-key-batch`, `create-package`, `download/latest` 等）确认使用情况。
3. 审阅 `i18n.js` 确认是否存在内部发起的 HTTP 请求（无）。
4. 对比功能重叠度与前端已实现逻辑，给出保留与废弃分组。

---
若需我继续：可直接指示“添加 Deprecation 头”或“实现 key 校验”等下一步任务。
