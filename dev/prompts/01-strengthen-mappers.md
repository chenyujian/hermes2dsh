# 切片：加强 memory / skill 映射

## 允许修改
- src/plan.js
- src/apply.js
- src/util.js（仅当需要纯函数辅助时）

## 禁止
- bin/、mappings/、package.json、README.md
- 引入 npm 依赖

## 目标
1. memory：按 `##` 或 `§` 分段合并；已存在同名段则跳过该段（记入 report conflicts 或 skipped note）。
2. skill：嵌套目录 `skills/cat/name/SKILL.md` 展平为 `skills/hermes-imports/name/`；同名冲突遵循 `--skill-conflict`。
3. 保持 dry-run：preview 不写盘。

## 验收
```
node ./bin/hermes2dsh.js preview --hermes-home ./fixtures/sample-hermes --dsh-home ./fixtures/sample-dsh --workspace-target ./fixtures/sample-dsh/workspace
```
exit 0，Summary 行存在。
