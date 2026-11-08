# hermes2dsh 开发框架：Grok 定规 · DeepSeek 写码

目标：尽量少烧 Cursor/Grok 侧 token；架构、验收、联调由 Grok Bot 做；**模块实现主体由 DeepSeek API 生成与迭代**。

## 角色分工

| 角色 | 负责 | 不负责 |
| --- | --- | --- |
| **Architect（Grok Bot）** | 模块边界、接口签名、fixture、验收标准、code review、合并 | 大段业务实现 |
| **Coder（DeepSeek）** | 按 `dev/prompts/*.md` 实现/改写 `src/**` | 擅自改 CLI 对外 flags、mappings 契约 |
| **Runner（本机脚本）** | 调 DeepSeek API、落盘、跑 fixture preview | 擅自 `git push` |

## Token 流向

```
James  vault  →  DEEPSEEK_API_KEY（环境变量）
Grok   只写短 prompt + 接口草稿（小 token）
DeepSeek 读 prompt + 现有文件摘要 → 输出完整模块代码（大 token 花在 DS）
Grok   跑 preview/fixture，点名修 1–3 处（小 token）
```

## 模块切片（Coder 一次只做一个）

1. `scan.js` — 扫描 ~/.hermes 清单  
2. `plan.js` — 生成迁移动作列表  
3. `apply.js` — 真正写盘  
4. `report.js` — 报告格式  
5. `mappers/*` — soul / memory / skill / agents / config（v0.2 拆文件）  
6. `cron` / secrets / weixin 提示（v0.2）

每个切片对应 `dev/prompts/NN-*.md`。Architect 更新 prompt；Coder 只改该切片允许的路径。

## 工作循环（单切片）

1. Architect 写/改 `dev/prompts/NN-xxx.md`（含：目标、允许改的文件、禁止事项、验收命令）  
2. `node dev/scripts/ds-codegen.js --prompt NN-xxx` → DeepSeek 生成补丁/文件到 `src/`  
3. `npm run test:fixture`（或 preview）  
4. 失败则 Architect 写「修复说明」进同一 prompt 的 `## Repair`，再跑一遍 codegen  
5. 通过后 `git commit`（人工或 Grok）

## DeepSeek 调用约定

- Base URL：`https://api.deepseek.com`  
- 默认模型：`deepseek-chat`（可 `DS_MODEL=deepseek-reasoner`）  
- 温度：0.2  
- 系统提示固定为「只输出约定格式的文件块，不要散文」  
- 密钥：仅从环境变量 `DEEPSEEK_API_KEY` 读取，禁止写入仓库

## 验收底线（任何切片）

- `node ./bin/hermes2dsh.js preview` 在无 `~/.hermes` 时 exit 0 并提示 not found  
- fixture preview：`migrated`/`skipped`/`conflicts` 数字合理  
- 默认不写 secrets；不覆盖 `~/.dsh/settings.yaml`

## v0.1 已有骨架

CLI + scan/plan/apply/report 已可用。后续切片以 **加深 mapper、冲突策略、测试** 为主，而不是重写 CLI。

## Reviewer 门禁（R5）

```
npm run role:review -- --slice 03          # local checklist → dev/out/review-03.md
node dev/scripts/run-role.mjs --role reviewer --slice 03 --call   # optional CodePlan
```

角色系统提示在 `dev/prompts/roles/`。Verdict 为 `FAIL` 时 exit 2，切片不得 commit。
