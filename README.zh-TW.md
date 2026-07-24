# claude-pacer

Claude Code 用量 statusline＋額度警戒 hook＋配速判定，三件一組。

[English README → README.md](README.md)

```
Ctx 34% │ 5h 42%·剩2h13m·時58% │ 7d 71%·剩3d2h·時55%
Ctx ▓▓▓░░░░░ 34% │ 5h ▓▓▓┃░░░░ 42%·剩2h13m │ 7d ▓▓▓▓▓┃░░ 71%·剩3d2h
```

做 Claude Code statusline 的工具已經很多（ccusage、CCometixLine、
cc-statusline、claude-powerline⋯⋯），都很好用，挑你喜歡的就好。這套的
差異點在於：statusline 只給「人」看，擋不住半夜自主跑批次的 agent 把額度
燒光。claude-pacer 是共用同一份資料檔的三層：

1. **`statusline.cjs`** — 給你看的：5h／7d 用量、context window 滿度、
   （可選）對話主題。數字或長條兩種模式。
2. **`budget-guard.cjs`** — 給 Claude 看的：hook 在用量 85%／93% 時把
   「開始收尾」指令注入模型 context，長時間自主任務會優雅收尾而不是
   跑到一半斷頭。
3. **`usage_verdict.py`** — 給 agent 跑的：一行 GO／PACE／STOP 判定，
   內建 agent 最常算錯的視窗重置算術。

## 安裝

需要 Node.js（statusline＋guard）；usage_verdict 需要 Python 3（選用）。

```bash
git clone https://github.com/drpwchen/claude-pacer.git
```

在 `~/.claude/settings.json`：

```jsonc
{
  "statusLine": {
    "command": "node /path/to/claude-pacer/statusline.cjs"
  },
  "hooks": {
    "UserPromptSubmit": [{ "hooks": [{ "type": "command",
      "command": "node /path/to/claude-pacer/budget-guard.cjs" }] }],
    "PostToolUse": [{ "hooks": [{ "type": "command",
      "command": "node /path/to/claude-pacer/budget-guard.cjs" }] }]
  }
}
```

statusline 可以單獨用；想要警戒功能再加 hooks。用量百分比來自
Claude Code 的 `rate_limits` statusline 資料（Pro/Max 訂閱才有；API key
計費沒有這種視窗）。

不動設定就能預覽兩種顯示模式：

```bash
node statusline.cjs --demo
```

## 怎麼讀

| 欄位 | 意思 |
|---|---|
| `Ctx 34%` | context window 滿度（離 compact 還多遠） |
| `5h 42%` | 5 小時視窗已用百分比 |
| `剩2h13m` | 視窗重置倒數 |
| `時58%` | 視窗「時間」已流逝百分比——用量% > 時間% 表示燒得比時鐘快 |
| `7d ⋯` | 7 天視窗的同三項 |

長條模式的 `┃` 記號就是時間進度畫在用量條上：實心條超過記號＝燒得比
時鐘快。顏色：綠 < 70% ≤ 黃 < 90% ≤ 紅。

## 設定

設定檔在 `~/.claude/claude-pacer/config.json`（自己建；範例見
[config.example.json](config.example.json)）。CLI 參數會覆蓋設定檔。

| 鍵 | 預設 | 參數 | 意思 |
|---|---|---|---|
| `display` | `"number"` | `--bar`／`--number` | 數字或長條 |
| `topic` | `false` | `--topic`／`--no-topic` | 顯示對話主題 |
| `context` | `true` | `--context`／`--no-context` | 顯示 context 欄 |
| `labels` | `"en"` | — | `"zh"` 顯示 剩／時 標籤 |
| `topic_chars` | `24` | — | 主題截斷長度 |
| `bar_width` | `8` | — | 長條寬度（字元） |

state 目錄可用 `--dir <path>` 或 `$CLAUDE_PACER_DIR` 覆蓋（三支腳本通用）。

### 主題模式

預設關閉。開啟後依優先序解析：

1. **Session 標題** — Claude Code 自己生成（或 `/rename` 改過）的
   session name，最能代表這個對話在做什麼；
2. **Transcript summary** — compact 時寫入的摘要；
3. **第一句 user prompt** — 全新 session 的 fallback。

## budget-guard

掛在 `UserPromptSubmit`＋`PostToolUse`（所以長自主任務跑到一半也會觸發），
讀 statusline 寫的 `limits.json`。

- **soft（85%）**：叫 Claude 收尾進行中的工作、別再開大工程。
- **hard（93%）**：叫 Claude 立刻收尾、排一個視窗重置後幾分鐘的一次性
  resume、向使用者回報、結束回合。
- 警告**每個 session 各自觸發、每 10 分鐘重新武裝**——多個並行
  session/agent 都聽得到，不會只有第一個聽到。
- 視窗已重置時保持沉默（過期的高數字不會誤報）。
- **配速模式（選用）**：建 `<state-dir>/pace.json` 寫
  `{"on": true, "agents": 5}`，未達門檻也會定期注入用量狀態行——
  dispatcher 帶一群 subagent 跑批次時用。跑完刪掉。

門檻與間隔在 `config.json` 的 `guard` 區。

## usage_verdict.py

```
$ python usage_verdict.py
GO — 5h at 42%, 133 min left, projected ~61% at reset — headroom available, can dispatch more. [7d: 71% — not near cap, ignore] (...)
```

Exit code：0=GO、1=PACE、2=STOP、3=無資料。`--json` 給程式吃。

為什麼要腳本、不直接看數字？因為 agent（跟人）常犯三個錯：

1. **重置算術** — `limits.json` 只在 statusline 渲染時更新，重置後仍顯示
   舊的 90 幾 %。只要 `now > resets_at`，用量就是 ~0%，不必花 token 驗證。
2. **7d 假警報** — 7d 視窗若在目前 5h 視窗結束「之前」就重置，再高的
   7d % 都不構成限制。判定會幫你忽略。
3. **燒速外插** — 多 agent 突發派工下線性外插是「下限」，所以硬門檻
   永遠優先。

`--ratio` 從累積的歷史資料實測你方案的 7d/5h 額度比——排多天批次工作
時有用（兩個視窗官方是獨立的，沒有公開換算式）。

## 硬上限後自動續跑（extras）

`extras/windows/` 有一對 PowerShell 腳本可註冊一次性 Windows 排程：
hard 警戒觸發且終端必須關閉時，Claude 寫好 `handoff.md`，排程在視窗
重置後幾分鐘用 `claude -p` 繼續工作。使用前改一下工作目錄那行；
macOS／Linux 用 `at` 或 user cron 可以做到一樣的事。

## 會寫哪些檔案

全部都在 state 目錄（預設 `~/.claude/claude-pacer/`）：`limits.json`
（最新視窗快照）、`limits-history.jsonl`（燒速取樣，約 2 分鐘一筆，
256 KB 自動修剪）、`topics.json`（主題快取）、`guard-state.json`，加上
你自己的 `config.json`／`pace.json`。完全本機，任何地方都沒有網路呼叫。

## License

MIT
