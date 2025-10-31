# Open Anki：项目分析与发展蓝图

## 1. 当前已实现的核心功能与技术栈

Open Anki 已成功构建了一个基于 Monorepo 的全栈应用，实现了**用户认证**和**核心卡片组同步**的基础功能。

| 模块 | 核心功能 | 已实现的关键技术点 |
| :--- | :--- | :--- |
| **整体架构** | **Monorepo** | 使用 **Bun/Node.js** 和 **Turborepo** 管理 `backend`、`frontend` 和 `shared` 三个包的构建、开发与测试。 |
| **后端 (Sync Service)** | **认证与授权** | 基于 **Fastify** 和 **JWT** 实现请求鉴权，要求提供匹配 `SUPABASE_JWT_SECRET` 的 Supabase JWT。 |
| | **数据存储** | **PostgreSQL** 作为主数据库，使用 `node-pg-migrate` 管理 schema (`01_core_schema.sql` 等)。 |
| | **同步 API** | 实现了 `/session`、`/push`、`/pull` 三个端点。 |
| | **Deck Push** | 实现了 `deck` 实体的 `create/update/delete` 操作的事务性持久化，并包含**版本冲突检测（409 Conflict）**和**事务回滚**逻辑。 |
| | **Deck Pull** | 实现了**基于版本号 (`version`) 和元数据 ID (`metaId`) 的分页机制**，支持 continuation token 和设备进度跟踪 (`device_sync_progress`)。 |
| **前端 (Web Client)** | **本地数据层** | 基于 **Dexie (IndexedDB)** 的本地数据库，定义了完整的 Anki 实体模型。 |
| | **用户体验 (UX)** | 实现了完整的**认证流程** (`LoginPage.tsx`, `useAuth`)、**响应式布局** (`Layout.tsx`, `Sidebar.tsx`) 和一套基于 ShadCN/Radix 的 **UI 组件库**。 |
| | **核心学习逻辑** | 实现了基于 **SM-2 算法**的简化版卡片调度逻辑 (`reviewActions.ts`)，支持卡片新增、待复习卡片队列获取和评分处理 (`gradeCard`)。 |
| | **视图与数据** | 实现了仪表盘、卡片组列表、卡片组详情和复习页面，以及关键数据 Hooks (`useDashboardStats`, `useDeckSummaries`, `useDeckDetail`)。 |
| | **Sync 引擎** | 实现了 **`useSyncEngine`** 及其背后的 `syncClient.ts`，能够执行 `Deck` 的 **Push/Pull 完整同步工作流**，并处理网络或冲突错误。 |

---

## 2. 宏观架构展望（远期目标与架构思路）

未来的工作将围绕**提升数据同步的完整性、鲁棒性、可扩展性**和**抽象核心学习逻辑**展开。

### 2.1 完整的双向同步闭环 (Full Loop Synchronization)

**现状问题：** 虽然 `deck` 的同步已完成，但 `note`、`card`、`review_log` 等核心实体的同步逻辑（在 `syncRoutes.ts` 和 `syncClient.ts` 中）仍需补全。

**架构思路：**
*   **后端：** 为所有核心实体 (`note`, `card`, `review_log`) 完善 CRUD 数据库操作，并确保每次操作都正确地写入 `sync_meta` 表。
*   **前端：** 扩展 `syncClient.ts` 中的 `applyServerOp` 函数，实现对所有实体类型（`note`, `card`, `review_log`）的本地应用逻辑。
*   **鲁棒性：** 引入更精细的冲突解决策略，例如对于 `card` 和 `review_log` 这种时间敏感的实体，优先使用**时间戳更晚**的操作（Last-Write-Wins），而不是简单地全局回滚。

### 2.2 调度器和学习算法抽象 (Scheduler Abstraction)

**现状问题：** 当前的卡片调度逻辑直接硬编码在 `packages/frontend/src/core/db/reviewActions.ts` 的 `calculateSM2` 函数中，难以更换或配置。

**架构思路：**
*   **共享包 (`@open-anki/shared`)：** 定义**调度器接口**（Scheduler Interface），如 `calculateNextSchedule(card: Card, rating: number): NextSchedule`。
*   **前端：** 允许用户在 `DeckConfig` 中选择不同的算法（例如 SM-2, FSRS），并在运行时动态加载相应的调度器实现。
*   **后端：** 同步时仅存储卡片更新后的状态（`due`, `ivl`, `ease`, `state`），将复杂的**算法计算保持在客户端**，以确保离线学习的独立性和高性能。

### 2.3 媒体文件和附件同步 (Media Sync Capability)

**现状问题：** 目前的项目架构完全没有涉及媒体文件（图片、音频）的存储和同步。

**架构思路：**
*   **云存储集成：** 将媒体文件从 PostgreSQL/Dexie 中分离，集成**对象存储服务**（如 Supabase Storage/AWS S3）。
*   **内容寻址：** 在 `note` 的 `fields` 中，不直接存储媒体 URL，而是存储其内容的 **哈希值**（Content Hash），以确保同步的幂等性和高效去重。
*   **同步协议扩展：** 客户端在 Push 时，检测到新的媒体文件时，先上传到对象存储，再在 `sync_meta` 中记录一个特殊的 `media_reference` 实体操作。Pull 时，客户端根据引用的哈希值下载所需媒体。

---

## 3. TODO

接下来，项目应立即聚焦于**完成核心实体的双向同步闭环**和**关键 UX/质量提升**。

| 优先级 | 任务描述 | 涉及文件/技术栈 |
| :--- | :--- | :--- |
| 🟥 **高** | **后端：实现 Notes、Cards 和 Logs 的 Push 逻辑**。在 `packages/backend/src/routes/syncRoutes.ts` 中，为 `handleNoteOperation`、`handleCardOperation` 和 `handleReviewLogOperation` 编写完整的 `create`/`update`/`delete` SQL 逻辑。 | `syncRoutes.ts` (PostgreSQL CRUD) |
| 🟥 **高** | **后端：实现 Notes、Cards 和 Logs 的 Pull 逻辑**。在 `packages/backend/src/routes/syncRoutes.ts` 中，为 `fetchEntityData` 编写查询逻辑，并确保 `mapMetaRowToOp` 能正确返回所有实体的 `SyncOp`。 | `syncRoutes.ts` (PostgreSQL Select/Zod Mapping) |
| 🟥 **高** | **前端：实现 Notes、Cards 和 Logs 的 Pull 应用**。在 `packages/frontend/src/core/sync/syncClient.ts` 中，扩展 `applyServerOp`，实现 `applyNoteOp`、`applyCardOp`、`applyReviewLogOp` 函数，将同步到的远程数据写入 **Dexie** 数据库。 | `syncClient.ts` (Dexie CRUD) |
| 🟧 **中** | **前端：复习页添加键盘快捷键**。在 `packages/frontend/src/pages/ReviewPage.tsx` 中，添加 `useEffect` 钩子来监听 `1`, `2`, `3`, `4` 键，并调用 `handleGrade` 函数，提升复习速度。 | `ReviewPage.tsx` (React Hooks/DOM Events) |
| 🟧 **中** | **前端：复习页显示下次间隔**。修改 `packages/frontend/src/pages/ReviewPage.tsx`，在显示答案后，利用 SM-2 算法或新的调度器抽象，为每个评分按钮**预计算并显示**下次复习的间隔（例如：`良好 (1天)`）。 | `ReviewPage.tsx`, `reviewActions.ts` (前端调度器逻辑) |
| 🟧 **中** | **测试：E2E 集成测试**。使用 **Bun Test** 或 **Playwright** 配置端到端测试，覆盖一个完整的 `登录 -> Push (Deck/Note/Card/Log) -> Pull -> 本地数据验证` 流程，确保整个同步闭环的可靠性。 | E2E 框架 (Playwright/Bun Test API) |
| 🟩 **低** | **后端：增加详细的结构化日志**。在 `packages/backend/src/index.ts` 中，为 `pino` 配置添加更多有用的字段（如 `userId`, `deviceId`, `route`），以便在生产环境中进行更好的**可观测性**。 | `src/index.ts` (Pino Logging) |