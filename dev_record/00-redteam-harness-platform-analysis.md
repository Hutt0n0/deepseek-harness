# 红队双 Harness 平台分析 — 从算法本质到 dsh 改造路径（v1）

- 分支：`master`（2026-09-18 全新起点；此前 `dsh-audit-dev` 与 `dsh-pentest-dev` 两轮
  试作已废弃，tip 留档于标签 `archive/dsh-audit-dev-20260918` 与
  `archive/dsh-pentest-dev-20260918`，可考古不可续用）
- 日期：2026-09-18
- 性质：**起点纲领文档** — 本文从第一性原理（不依赖此前任何设计稿）推导两种 harness
  的算法本质与 dsh 改造路径；后续具体设计（数据模型、包结构、任务拆解）另立新档，
  以本文的结论为前提
- 关联前史（仅供考古）：archive 标签下的两轮试作分别是 pentest 工作模式
  （attack-graph/campaign/preset/DAG 卡片）与白盒审计模式（taint-graph/
  documentpreview mark）。其结论中"算法层判断"仍然有效并被本文吸收；
  "工程层落地"（包结构、事件名、UI 细节）不作为本轮约束

---

## 1. 问题定义

目标：在 deepseek-harness（下称 dsh）上构建面向红队专家的两个工作模式：

1. **渗透测试 harness** — 智能体在授权范围内对目标环境执行侦察、漏洞定向评估、
   初始访问、横向移动、证据收集，产出可提交的攻击链报告。
2. **代码审计（白盒漏洞挖掘）harness** — 智能体审计目标代码库，产出
   source→sink 污点链路（含攻击者可控性证据与存储型二阶链），供人工确认。

两者共享一个平台诉求：**智能体的每一步操作可回放、每一项断言可验证、
每一次产出可分诊**。这正是 harness 层（而非 prompt 层）要解决的问题。

---

## 2. 算法本质

### 2.1 渗透测试 = 预算约束下、部分可观测的攻击图搜索

形式化：budgeted best-first search over belief states。

- **状态**是信念状态：资产清单 + 已获凭据 + 当前立足点 + 对防御方行为的观察
  （WAF/EDR/告警）。部分可观测——一次扫描结果是观测，不是真值。
- **动作**是带前置条件/效果/代价的目录条目。每动作三分量代价：时间、
  **噪声**（OPSEC：触发检测概率）、风险（破坏目标可用性）。
- **目标**是到达 impact 状态（数据、权限）；路径即攻击图 entry→impact 子图。
- **循环**：frontier 选期望效用最高的分支 → 扇出 worker 执行 → 观测回写信念
  → 增量重规划。环境**非平稳**：一次成功利用改变拓扑（新立足点=新节点入图），
  故不可一次性规划。

三个决定 harness 生死的算法结论：

1. **图状态不进模型上下文**。长战役攻击图数百节点，灌历史必爆上下文且是
   同一状态的复制存储。正确结构：外部持久状态仓 + 按需查询工具
   （section 化：列表/单节点详情/计数与摘要），模型每轮只取决策所需切片。
2. **置信度合并必须区分证据独立性**。同一入口被并行 worker 反复指认不是
   独立证据；naive 合并公式 `c' = c + (1−c)·w` 会把重复劳动洗成高置信。
   独立路径（不同漏洞类型/入口收敛同一结论）才允许合并，相关 sighting
   只做记录。
3. **scope 违规是安全事故，不是 bug**。动作执行前必须有确定性策略层强制
   校验目标在授权范围内：deny-by-default、fail-loud、不可被模型说服。

### 2.2 代码审计 = 级联漏斗 + 证据接地的污点路径搜索

核心矛盾：候选 (source, sink) 对动辄数千，逐对完整数据流不可行。
正确形态是级联漏斗（cascade），逐级提精度：

```
Stage 0  枚举（确定性，高召回低成本）
         source 目录 × sink 目录模式扫描（ripgrep/semgrep）→ 候选对
Stage 1  排序（便宜过滤 + 先验打分）
         漏洞类型 × 框架 × 组件先验 → 预算内取 top-K
Stage 2  路径行走（LLM，高成本高精度）
         worker 逐跳产出语义跳变步骤（file:line + 污染符号），
         每步证据由工具宿主侧读文件固定（snippet + hash），不由模型转述；
         sanitizer 语义（污点断开/重引入）必须可标注——
         "断开后直达 sink"是头号误报形态，要可诊断
Stage 3  对抗验证（第二视角）
         独立 refuter worker 专职推翻：找上游清洗、框架自动转义、
         类型强转——直接攻击 LLM 的已知失败模式（编造貌似合理的流）
Stage 4  人工分诊
         confirm/dismiss；dismiss 回写项目记忆（已知 sanitizer、FP 模式）
         → 学习闭环
```

三个决定 harness 生死的算法结论：

1. **LLM-as-analyzer 与确定性分析是分工，不是二选一**。确定性层管召回与记账
   （可枚举的绝不靠模型记忆：路由表、sink 模式、已试组合），模型层管语义
   与判断（框架惯例、业务逻辑、可达性）。自建 AST/IR 基础设施仅在 benchmark
   证明纯工具组合召回不足后立项。
2. **证据接地是审计 harness 的分水岭**。模型说的每一跳都可能幻觉；断言由
   harness 在工具宿主侧固定到记录时刻（读原文+哈希），事后可对漂移。
3. **存储型漏洞是二阶数据流**。一条流写入存储介质、另一条读出触发；数据
   模型必须把存储通道（介质+定位+键）作为一等公民，否则无法回答"哪个参数
   毒化了哪个存储值、哪次读取渲染了它"。

### 2.3 共享内核：Propose → Ground → Persist → Triage

两问题并排，80% 的 harness 基础设施相同：

| 共享能力 | 渗透测试形态 | 代码审计形态 |
|---|---|---|
| 外部发现图 | 攻击图（资产/权限/动作） | 污点流图（source/propagate/sink） |
| 预算化 worker 编排 | 锁分组并行探测波次 | 按候选/漏洞类型分派的审计 worker |
| 证据接地 | 工具输出落盘固定 | snippet+hash 落盘固定 |
| 发现生命周期 | record→confirm/dismiss | record→confirm/dismiss |
| 人工分诊 UI | DAG 卡片+时间线 | 链路图+代码定位 |
| 长期记忆 | 目标档案（已试/被挡/凭据） | 项目档案（sanitizer 库/FP 模式） |

平台内核一句话：**Propose（模型提假设）→ Ground（工具固定证据）→
Persist（append-only 落盘）→ Triage（人确认）**。

---

## 3. dsh 改造可行性：逐项映射

对照 `docs/architecture.md` 声明的扩展点：

| 平台需求 | dsh 现有接缝 | 改造量 |
|---|---|---|
| 插件化、模式可组合 | Cordis 全插件 + profile/bundle/patch 组装 | 零（已是产品架构） |
| 操作可回放 | append-only session log；"模型可见⟺已记录"不变量 | 零——红队原生优势 |
| 发现图持久状态 | `SessionEventMap` 声明合并 + `session-projections` 增量 fold | 每模式一种子（事件+fold+投影） |
| 模型按需查图状态 | 工具宿主内 `sessionProjections.stateOf()` | 零（通路已在） |
| worker 扇出 | subagent spawn（outputSchema 捕获）、agent teams（roster/任务板/邮箱） | 调度/锁/预算语义为插件层工作 |
| 工具注册 | `ctx.tools` | 零 |
| 动作前策略拦截 | `tools/pre-execute`、`agent/pre-step`、`agent/request` 瀑布 | scope/OPSEC 策略插件（新建，安全关键） |
| 执行隔离 | `ctx.sandbox` + fs/subprocess 共享执行世界（指向远程沙箱即整体迁移 Bash/PTY/LSP） | "实验室执行世界"提供方（新建，关键缺口） |
| 跨会话长期记忆 | `storage` 接缝 | 目标/项目档案插件（新建） |
| 定时/后台 | `ctx.jobs`、`schedule` | 零（定期扫描、CI 回归即得） |
| 外部事件触发 | webhook ingress | 零（SIEM 告警→自动开会话） |
| 多模式交付 | preset + cordis.yml overlay + bundle | 每模式一个 preset（轻） |
| 自动化/批量评测 | headless / TS+Python SDK / ACP | 零（评测流水线驱动层即得） |
| 人工分诊 UI | ConversationNode + keyed renderer + 客户端包 + 投影推送 | 每模式 UI（主要税） |

**结论：可以改造，且是高杠杆改造。** dsh 已把"难而通用"的部分做完
（append-only 证据日志、投影机制、工具管线拦截点、执行世界可替换、
subagent 扇出、preset 组装、双 SDK 自动化面），缺的恰好是领域特定层、
本就该以插件形态存在的部分。改造不是在产品里凿洞，是在预留接缝上挂模式包。

---

## 4. 缺口清单（按风险排序）

1. **执行世界是最大缺口**。dsh 的 sandbox 隔离宿主机进程；红队需要网络层
   执行域：agent 全部动作从跳板机/VPN 命名空间发出、出口固定、流量可审计。
   fs+subprocess 执行世界 swap 机制使"执行指向远程实验室主机"架构上顺路，
   但提供方本身要新建。**此项不做，红队模式不具备生产安全性。**
2. **发现图是每模式都要付的税**。会话日志建模对话，不建模工作产品；发现图
   （事件+fold+查询工具+UI）每次都是一套定义工作。机制现成，工作量真实。
3. **无确定性程序分析服务**。LSP 接缝导航-only，无 AST/IR 服务。务实路径：
   不建 IR——bash 跑 semgrep/ripgrep 作 Stage 0 枚举器，语义判断交模型；
   benchmark 证明召回不足再立项。
4. **模型自评偏差**。发现由模型提出又由模型自评置信度，系统性偏乐观。必须
   独立 refuter worker（对抗验证）+ 人工 confirm 权威双保险；"谁有权 confirm"
   定为不可协商契约。

---

## 5. 构建顺序（算法团队视角）

```
0. 度量先行：标注 benchmark（DVWA/WebGoat/Juice-Shop + CVE 复现库）
   —— 没有 precision/recall 数字，一切调优是盲的
1. 共享内核：发现图数据模型 + 纯 fold + section 化查询工具 + 分诊 UI
   （一次建成两模式复用；置信度语义从一开始区分独立/相关证据）
2. pentest 模式包：scope 策略 + 实验室执行世界 + frontier 调度器
   （先做——它对调度与安全轨要求最苛刻，验证内核）
3. audit 模式包：级联漏斗 + 路径行走 worker + 对抗验证 worker
   （复用内核，成本集中在 Stage 2/3 编排）
4. 跨会话记忆：目标档案/项目档案（storage 接缝）
5. 评测流水线：headless 批跑 benchmark，每次改动有数字
```

团队分工建议——算法侧 owner：frontier 打分函数与预算策略、置信度合并语义、
benchmark 指标；安全侧 owner：scope 策略 deny-by-default 语义、执行世界隔离
边界；工程侧 owner：发现图内核与两模式包的插件化。

---

## 6. 对前史试作（archive 标签）的吸收与拒绝

| 前史结论 | 判定 | 理由 |
|---|---|---|
| 发现图走"会话事件+纯 fold+投影+section 查询工具"的机制形态 | **吸收** | 与 dsh 投影机制天然契合，archive 两轮均已验证工程可行 |
| "模型可见⟺已记录"、log-only 派生态、决策前必须先 query | **吸收** | 与仓库不变量一致 |
| 置信度不自动合并（审计场景） | **吸收** | 本文档 §2.2-2.3 将其推广为独立/相关证据的一般区分 |
| 具体包名（attack-graph/taint-graph/campaign）、事件名、UI 布局细节 | **不续用** | 本轮从共享内核重新推导；命名与拆分由新设计档决定 |
| "每模式一套独立图模型"（pentest 攻击图与审计污点图字段刻意分叉） | **待重议** | 前史因两分支并行开发而各自建模；本轮共享内核先行，统一模型下的两个视图可能更经济，设计档需给出结论 |
| scoped scope 策略 / 执行世界 / 记忆 / benchmark | **前史缺失，本轮新增** | 前两轮均未触及生产安全与科学性底座，是本轮最大增量 |

---

## 7. 下一步

1. 用户评审本文档，确认 §5 构建顺序与 §6 的"统一发现图模型 vs 每模式一图"取向
2. 共享内核专项设计（数据模型/事件/工具面/UI 第一刀）
3. benchmark 靶场清单与标注规范
4. TDD 任务拆解（延续先测试后开发的既定纪律）
