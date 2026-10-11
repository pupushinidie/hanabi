import { useState } from "react";

/** 规则说明：用自己的话写，短。 */
function GameRules({ masterMode = false }: { masterMode?: boolean }) {
  const [open, setOpen] = useState(false);

  return (
    <section className={open ? "game-rules open" : "game-rules"}>
      <button
        className="game-rules-toggle"
        type="button"
        aria-expanded={open}
        aria-controls="game-rules-panel"
        onClick={() => setOpen((current) => !current)}
      >
        <span aria-hidden="true">✦</span> 规则
        <i aria-hidden="true">{open ? "收起 ▴" : "展开 ▾"}</i>
      </button>

      {open && (
        <div className="game-rules-panel" id="game-rules-panel">
          <div className="game-rules-block">
            <h3>目标</h3>
            <p>大家是一队。把红、黄、绿、蓝、白五色烟火各按 <b>1→2→3→4→5</b> 打出来，五色各自打到的最大数字加起来就是全队得分，满分 25。</p>
            <p><b>你看不到自己的手牌</b>，只看得到队友的。</p>
          </div>
          <div className="game-rules-block">
            <h3>轮到你时，三选一</h3>
            <ul>
              <li><b>给提示</b>（花 1 个提示标记）：选一位队友和一种颜色或一个数字，他手里所有这种牌都会标出来，其余的牌记上「不是这种」。不能提示他没有的。</li>
              <li><b>弃牌</b>（标记不满 8 个时）：弃掉自己一张，拿回 1 个提示标记，再摸 1 张。</li>
              <li><b>出牌</b>：接得上同色当前数字 +1 就放上去；接不上算打错，用掉 1 个失误标记。打出 5 再拿回 1 个提示标记。</li>
            </ul>
          </div>
          <div className="game-rules-block">
            <h3>结束</h3>
            <ul>
              <li>打错第 3 次：立即失败，全队 0 分。</li>
              <li>五色都打到 5：立即结束，25 分。</li>
              <li>牌堆摸完：从下家起每人再行动一次，摸到最后一张的人最后行动，然后算分。</li>
              {masterMode && <li><b>大师模式</b>：牌堆摸完不停，一直打到 25 分才算赢；打错 3 次或某张还要用的牌全被弃光就输。</li>}
            </ul>
          </div>
          <div className="game-rules-block">
            <h3>其他</h3>
            <ul>
              <li>对局中只能用「提示」交流，聊天只能发几句预设短语；语音里也别说牌。</li>
              <li>每回合 90 秒，超时会自动弃牌或给提示（不会替你出牌）；连续超时 2 次由人机托管。</li>
              <li>人机队友的约定：你提示它一张能出的牌，它会出<b>新标中的最左边那张</b>；提示它最右边没提示过的 5 或最后一张，它会留着不弃。</li>
            </ul>
          </div>
        </div>
      )}
    </section>
  );
}

export default GameRules;
