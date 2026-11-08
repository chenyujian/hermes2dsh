# hermes2dsh

**Migrate Hermes Agent (`~/.hermes`) → DeepSeek Harness / DSH (`~/.dsh`).**

开源 CLI：把 Hermes 的人格、记忆、skills 等用户数据迁到 DSH。灵感来自 Hermes 自带的 `hermes import-agent openclaw`（OpenClaw → Hermes 导入器）；本工具做反向/平行方向：**Hermes → DSH**。

---

## Why / 背景

Hermes Agent 把 SOUL、memories、skills、cron、微信 token 等放在 `~/.hermes`。  
DSH（DeepSeek Harness）使用 `~/.dsh` 与 skills 目录约定。手动拷贝容易漏文件、撞名、误带密钥。

`hermes2dsh` 提供：

1. **`preview`** — dry-run 报告（迁入 / 跳过 / 冲突）
2. **`apply`** — 先预览，确认后再写入（可用 `--yes` 跳过确认）

---

## Install / 安装

Node.js **>= 18**。

```bash
cd hermes2dsh
npm i -g .
# or without global install:
npx --yes . preview
node ./bin/hermes2dsh.js preview
```

---

## Usage / 用法

```bash
hermes2dsh preview
hermes2dsh apply
hermes2dsh apply --yes
```

### Flags

| Flag | Default | Meaning |
| --- | --- | --- |
| `--hermes-home <path>` | `~/.hermes` | Hermes 数据根目录 |
| `--dsh-home <path>` | `~/.dsh` | DSH 数据根目录 |
| `--workspace-target <path>` | _(unset)_ | 若设置，则把 `AGENTS.md` 写入该工作区 |
| `--skill-conflict skip\|overwrite\|rename` | `skip` | skill 目录冲突策略 |
| `--secrets` | off | 才拷贝 `.env` / `auth.json` / `weixin/` |
| `--yes` / `-y` | off | `apply` 时跳过确认 |
| `--preset mvp\|full` | `mvp` | `mvp` 跳过 cron；`full` 把 cron 原样拷到导入目录供人工处理 |

---

## What MVP migrates / v0.1 迁什么

| Hermes | → DSH (v0.1) |
| --- | --- |
| `SOUL.md` | `~/.dsh/agent-presets/hermes-soul.md`（需自行挂到活跃 agent；见报告说明） |
| `memories/MEMORY.md` + `USER.md` | `~/.dsh/hermes-imports/memory/`（单文件拷贝 + `MERGED.md` 按 `##` / `§` 段落去重合并） |
| `skills/**/SKILL.md` | `~/.dsh/skills/hermes-imports/<skill-name>/`（嵌套分类目录压平为 skill 名） |
| `AGENTS.md` | 仅当提供 `--workspace-target` |
| `config.yaml` 非密钥字段 | 生成 `~/.dsh/hermes-imports/config-mapped.yaml`（**不会**覆盖 `settings.yaml`） |
| `.env` / `auth.json` / `weixin/` | 默认跳过；`--secrets` 才拷到 `hermes-imports/secrets/` |
| `cron/` | `mvp` 跳过并注明；`full` 原样拷到 `hermes-imports/cron/`（保留嵌套）并写 `README-hermes-import.md`；目标已存在时遵循 `--skill-conflict` |

### 明确不自动做的事

- **不会**改写 DSH 的 `settings.yaml`
- **不会**自动映射 cron → DSH schedule（full 仅原样备份 + 导入说明；需在 DSH 里按 `schedule`/`task` 手工重建）
- **微信 / iLink**：即便 `--secrets` 拷了 token，也**强烈建议在 DSH 插件里重新扫码**（token 可能绑定 Hermes 客户端）

---

## Analogy: Hermes OpenClaw importer

Hermes documents something like:

```text
hermes import-agent openclaw   # preview / apply style import
```

`hermes2dsh` mirrors that UX for the other direction into DSH:

```text
hermes2dsh preview
hermes2dsh apply --yes
```

映射表在 `mappings/paths.yaml` 与 `mappings/models.yaml`，方便社区 PR 补模型名与路径。

---

## Example / 示例

```bash
# Dry-run against fixtures (no ~/.hermes required)
node ./bin/hermes2dsh.js preview \
  --hermes-home ./fixtures/sample-hermes \
  --dsh-home ./fixtures/sample-dsh \
  --workspace-target ./fixtures/sample-dsh/workspace

# Apply for real
node ./bin/hermes2dsh.js apply \
  --hermes-home ./fixtures/sample-hermes \
  --dsh-home ./fixtures/sample-dsh \
  --workspace-target ./fixtures/sample-dsh/workspace \
  --yes --preset full
```

若 `~/.hermes` 不存在，`preview` / `apply` 会**优雅退出**并提示，而不是崩溃。

---

## Layout / 仓库结构

```text
hermes2dsh/
  bin/hermes2dsh.js
  src/cli.js scan.js plan.js apply.js report.js util.js
  mappings/paths.yaml models.yaml
  fixtures/sample-hermes/   # demo data
  LICENSE                   # MIT
  README.md
  package.json
```

---

## Roadmap (post v0.1)

- [ ] 更完整的 model / channel 映射
- [ ] cron → DSH schedule 自动转换（v0.1 full 仅 raw copy + README）
- [ ] 可选封装为 `dsh plugin` 设置页「从 Hermes 导入」
- [ ] 会话历史导入（体积大，默认仍跳过）

---

## License

MIT
