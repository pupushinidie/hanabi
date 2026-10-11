# 花火

2–5 人的**合作**卡牌游戏，网页联机（一个人也能和人机一起打）。全队一起把红、黄、绿、蓝、白五色烟火各按 1→5 的顺序放上天，满分 25。难点是：**每个人都看不到自己的手牌，只看得到队友的**，只能靠有限的「提示」互相告诉对方手里有什么。

线上地址：<https://gulugagame.com/hanabi/>（待上线）

## 本地运行

```bash
npm install
npm run dev          # 服务端 :3024，网页 :5295（端口可用 SERVER_PORT / WEB_PORT 改）
npm test             # 规则引擎 + 服务器测试
npm run typecheck
BASE_PATH=/hanabi/ npm run build
```

改了 `packages/game` 先 `npm run build:game`，服务器和测试读的是 `packages/game/dist`。

## 规则（自己的话）

- **配件**：50 张烟火牌（5 色 × 10 张：每色 1 有三张、2/3/4 各两张、5 只有一张），8 个提示标记，3 个失误标记。
- **开局**：洗牌，2–3 人每人 5 张、4–5 人每人 4 张，牌背对自己拿着。8 个提示标记都在。随机一个人先手，之后按座位轮流。
- **轮到你**，三件事选一件：
  1. **给提示**（要有提示标记，花 1 个）：选一位队友 + 一种颜色或一个数字，系统把他手里所有符合的牌都标出来，其余的牌记上「不是红」「不是 3」。不能提示对方一张都没有的颜色/数字。
  2. **弃牌**（提示标记不满 8 个才能弃）：弃掉自己一张牌（大家都看得到），拿回 1 个提示标记，摸 1 张。
  3. **出牌**：打出自己一张牌。能接上那种颜色当前的最大数字（+1）就放上去；接不上算**打错**，牌进弃牌堆，用掉 1 个失误标记。打出 5（完成一种颜色）再拿回 1 个提示标记（满 8 个就不拿）。然后摸 1 张。
- **结束**：
  - 打错第 3 次：立即失败，**全队 0 分**（结算页另外显示失败前的进度）。
  - 五色都打到 5：立即结束，25 分。
  - 牌堆摸完：从摸走最后一张的人的下家开始，每人再行动一次，**摸最后一张的人最后行动**；这期间不再摸牌。然后按五色各自的最大数字相加计分。
- **评价**：0–5 糟糕、6–10 平庸、11–15 还行、16–20 精彩、21–24 惊艳、25 传奇。

## 默认规则表（规则书没写死 / 开工拍板 / 全站约定）

| 项目 | 这里的做法 | 来源 |
|---|---|---|
| 打错 3 次 | 记 0 分，结算页另外显示失败前进度 | 他拍板 |
| 空提示（「你没有红色」） | 不允许，提示必须标中至少一张 | 开工拍板 |
| 提示标在牌上 | 标：正提示（已知颜色/数字）+ 排除信息（不是红、不是 3） | 开工拍板 |
| 对局中文字聊天 | 只能发预设短语：好、抱歉、想一下、好球！、谢谢、加油（观战的人也一样）；等候房间和结算时自由聊天；语音照常，开局提醒一句别在语音里提牌 | 开工拍板 |
| 大师模式（可选，默认关） | 房主建房时勾选（等候时也能改）。牌堆摸完不进最后一轮，一直打到 25 分才算赢；打错 3 次或某张还需要的牌已经全部进了弃牌堆就失败，失败都记 0 分 | 开工拍板 / 规则书第 8 节 |
| 大师模式里手里没牌又没提示标记 | 自动跳过这个人的回合（日志写「跳过」） | 实现补漏 |
| 整理手牌 | 任何时候都能拖动整理自己的手牌，不算一回合、不重置倒计时；提示跟着牌走。引擎另记摸牌顺序，人机和超时规则按摸牌顺序算「最新/最早」 | 补充 3.3 |
| 先手 | 随机 | 规则书第 3 节 |
| 本房间最高分 | 只存在房间内存里，同一房间「再来一局」时显示（普通模式最高分、大师模式打满次数） | 补充 3.6 |
| 观战 | 默认可观战；观战默认**看不到任何人的手牌**（只看提示，防止有人开小号看自己的牌），房主可以开「观战看手牌」；牌堆顺序始终看不到 | 全站约定 + 本游戏防作弊 |
| 人机 | 一个人也能开局：1 真人 + 1–4 个人机（咕噜一号…四号，带「人机」标签，只有「普通」难度） | 全站约定 |

## 超时规则

- 每回合 90 秒（`config.stepTimeoutSec`，测试可用环境变量 `TURN_MS` 缩短）。
- 超时自动行动**绝不出牌**：提示标记不满 8 个 → 弃掉最早摸到、没被提示过的那张（都被提示过就弃最早摸到的）；8 个全在 → 给第一个手里有牌的队友（从下家起）提示他最新那张牌的颜色；都做不了就跳过。
- 连续 2 次超时转托管（人机代打），自己动一下或点「取消托管」就交还；离线的人轮到时等 3 秒由人机代打，用原昵称加房间码回来接着打。

## 隐藏信息

- 引擎状态里手牌（`HandCard`）**从来不带牌面**，牌面只在 `GameState.cards` 表里；卡牌 id 是 0–49 的随机排列。
- `redactGameForViewer(state, viewerId, { seeAll? })` 删掉牌堆、种子、随机数状态、动作序列，`cards` 表只留弃牌堆、已打出的、别人手里的。观战（viewerId 不是座位）默认看不到任何手牌，`seeAll` 时看得到所有手牌。对局结束后亮出所有人的手牌（牌堆仍然不给）。
- 摸牌事件 `Drew` 只有 cardId。
- 测试：`packages/game/test/engine.test.ts`（每个视角）、`apps/server/test/hanabi.test.ts`（真实 socket 抓包对照服务器状态）、`apps/server/test/spectate.test.ts`；手动抓包 `node scripts/spy.mjs`（连真实服务器，两个 socket 打完一局，检查发给每人的每一条更新）。

## 对外接口（packages/game）

- `createGame(players, seed, { masterMode?, firstPlayer?, stack? })`：开局。`stack` 指定发牌顺序（先发每人的手牌，第 1 位玩家先拿），教程用。
- `apply(state, playerId, command)` / `applyCommand(...)`：纯函数，不改输入。命令：`CLUE {target, kind: "color"|"rank", value}`、`DISCARD {cardId}`、`PLAY {cardId}`、`REORDER {order}`。
- `legalActions`、`timeoutCommand` / `timeoutTurn`、`redactGameForViewer`、`scoreOf`、`isPlayable`、`clueTouches`、`chopCard`、`byDrawOrder`、`lostCard`。
- **预览局面工厂**（`src/scenes.ts`）：
  - `buildGame(options)` 按参数造任意精确局面：`players`（人数或玩家）、`hands`（每人手牌从左到右，`"R1"` 或 `{ face: "R2", color: true, rank: true, notColors, notRanks }`）、`deck`（接下来摸到的牌）、`deckSize`（多出来的牌放进弃牌堆）、`fireworks`、`discard`、`clueTokens`、`misfires`、`current`、`turn`、`masterMode`、`finalRound: { endsAfter, turnsLeft }`。配件守恒，牌不够会报错。
  - `scene(name)` 按名字造常见局面（自己是 p1 甲），名字见 `SCENE_NAMES`：start / start3 / start5 / myTurn / clued / theirTurn / tokens8 / tokens0 / misfire2 / finalRound / late / endScore（14 分）/ endPerfect / endMisfire（0 分，进度 14）/ masterLost / master。对手离线、超时这种房间级的状态由预览页改 `members` 和 `turnRemainingMs`。
- 房间：`CHAT_PRESETS`（对局中可发的短语）、`room:options {masterMode}`、快照里的 `options`、`best`。

## 网页和教程

- 牌桌 `apps/web/src/GameBoard.tsx`：按牌桌区域实测宽高挑牌的整数倍（`hanabi/layout.ts`），1× 时牌左上角叠 24px 数字；手机竖着排，第一屏是状态、烟火、自己的手牌和操作。
- 预览页 `apps/web/preview.html?s=<场景>`（场景见 `src/preview.tsx` 的 SCENES，`&mode=practice` 看「提示」）。
- 新手教程：`packages/game/src/tutorial.ts`（剧本、固定发牌）+ `apps/web/src/TutorialMode.tsx` + 共用教练层 `apps/web/src/tutorial/`（从欲罢不能复制）。首页、等候房间有入口，地址带 `?tutorial` 直接打开；学完接着和咕噜一号打完这局，练习局和「一个人 + 人机」的房间有「提示」按钮（键盘 H）。
- 截图、走查脚本：`~/projects/qa-reports/tools/hanabi-play.mjs`（真打一局）、`hanabi-fit.mjs`（牌桌裁切）、`tut-hanabi.mjs`（教程走查）。

## 一个人怎么测

```bash
npm run dev
node scripts/test-bot.mjs host 3 2          # 建 3 人房、拉 1 个机器人，等你从网页加入凑满后开局
node scripts/test-bot.mjs host 2 1 master   # 大师模式
node scripts/test-bot.mjs join <房间码>      # 机器人加入你建的房间
node scripts/spy.mjs                        # 抓包检查隐藏信息
```

环境变量：`BOT_DELAY_MS`（思考时间）、`BOT_IDLE=1`（挂机等超时）、`BOT_ONCE=1`（打完一局退出，默认自动同意再来一局）。

## 目录

| 路径 | 内容 |
|---|---|
| `packages/game` | 规则引擎、删减、预览局面工厂、人机、房间协议类型 |
| `apps/server` | Socket.IO 房间服务器（建房、重连、观战、人机托管、预设短语聊天、本房最高分） |
| `apps/web` | 网页（Vite + React） |
| `art/` | 美术规格 `spec.md`、出图脚本、定稿 `out/final/`（复制到 `apps/web/public/art/`） |
| `scripts/` | 陪玩机器人、抓包脚本 |

## 声音

这款还没有背景音乐（`useBgm(NO_BGM)`），进了房间和教程里顶栏有 ♪ 面板调音效、语音；手机牌桌上 ♪ 在顶栏「切换白天版」旁边（「服务已连接」只留绿点腾地方）。共用的 `gm-sound.tsx` 不要改（各仓库一模一样）。

动作音效在 `apps/web/src/game-sfx.ts`（自己的动作响亮，别人的减半，观战都算别人的；进房间 / 重连第一次拿到状态不响，版本一下跳好几步不补放）：

- 点选自己的牌 / 队友的牌 `select`（再点取消），选「颜色 / 数字」也是 `select`；不是自己的回合点队友的牌 `deny`。
- 给提示：招牌的**风铃**（颜色提示高、数字提示低）；提示到自己头上再加 `reveal`；提示标记用完再响两声往下走的低音。
- 打出接上：`card` + 招牌的**烟花**（哨声上天、炸开、噼啪）+ `score`；打出 5 放满一种颜色是大烟花 + 第二发 + `sparkle`，拿回标记「叮」。
- 打错：`card` + 招牌的**哑炮**（引信嘶嘶、闷响）+ `bust`；第 2 次打错多两下心跳警报；第 3 次打错直接 `boom`。
- 弃牌：`pass` + 拿回提示标记的「叮」；摸牌轻轻一擦 `draw`；整理自己的手牌一下很轻的擦牌声；大师模式被跳过 `pass`。
- 牌堆摸完进最后一轮：引信点着的嘶声 + `roundStart`。
- 轮到你 `yourTurn`（等动作声响完），最后 5 秒倒计时，自己超时 `timeout`；再来一局 / 教程重开 `shuffle` + `deal`。
- 终局全队一起赢或输：普通模式没炸且 **≥16 分**（评价「精彩」起）算赢、大师模式打满 25 分算赢，其余（含打错 3 次 0 分）响输的 `gameOver`；25 分再放一串礼花。门槛是 `game-sfx.ts` 的 `WIN_SCORE`。
- 房间：进出、开局、聊天由 `useRoomSfx`（App.tsx），服务器拒绝操作 `error`。
- 开发模式下每个音效名字记到 `window.__sfxLog`（别人的动作带「·他」），自测脚本 `~/projects/qa-reports/tools/hanabi-sfx.mjs`（`PART=online / tutorial / panel`）。

## 部署

服务器上 `~/hanabi`，pm2 进程 `hanabi`（端口 3024），网页在 `/var/www/hanabi`，Caddy `handle_path /hanabi/*`（在付费网关 `@games` 里）。由制作人部署。
