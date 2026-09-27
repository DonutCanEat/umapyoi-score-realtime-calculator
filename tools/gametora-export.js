/**
 * GameTora 技能目錄 → CSV（貼落 Chrome DevTools Console 用；唔會改任何嘢）。
 *
 * 用法：GameTora 技能目錄分頁 → F12 → Console → 貼呢個檔全部內容 → Enter → 等 prompt 彈。
 *
 * ⚠️ 設計要點（第一版踩過）：
 *   ① 唔可以 `document.querySelectorAll('div,span,a')` 掃葉節點 —— 會夾到側欄
 *      （「無聲鈴鹿」「機伶金花」等支援卡名同 UI 字串）。
 *   ② 先試「顯示全部」把 1595 行放入 DOM（`a[href*="/skills/"]`），得就直接抽 CSV。
 *   ③ 唔得就退返「搜尋框逐個字」分批（`input` → 等 → 抽），但**問完先剝葉節點**。
 */
(async () => {
  const S = (ms) => new Promise((r) => setTimeout(r, ms));
  const Q = (s) => [...document.querySelectorAll(s)];
  const txt = (e) => (e?.textContent ?? '').replace(/\s+/g, ' ').trim();

  const clickShowAll = async () => {
    for (let i = 0; i < 30; i += 1) {
      const b = Q('a,button,span').find((e) => txt(e) === '顯示全部');
      if (!b) break;
      b.click();
      await S(1000);
    }
  };

  // SkillTora 技能連結會係 /umamusume/skills/xxxx（語言前綴可選）
  const csv = () => {
    const rows = [];
    for (const a of Q('a[href*="/skills/"]')) {
      const name = txt(a);
      if (!name || name.length > 24) continue;
      const row = a.closest('tr,li,div[class*="row"],div[class*="Row"]') ?? a.parentElement;
      const rt = txt(row);
      const id = (a.getAttribute('href') || '').match(/(\d{4,6})(?:$|[/?#])/)?.[1] ?? '';
      const pt = rt.match(/(\d{2,4})\s*(?:Pt|pt|技能點|SP)/)?.[1] ?? '';
      rows.push([name, id, pt].join(','));
    }
    return [...new Set(rows)];
  };

  await clickShowAll();
  let out = csv();
  if (out.length < 20) {
    const input = Q('input').find((e) => /技能名稱|skill/i.test(e.placeholder || '')) ?? Q('input[type="text"]')[0];
    const keys = ['的', '力', '速', '線', '賽', '馬', '娘', '距', '彎', '直', '技', '能', '中', '長',
      '前', '後', '追', '位', '草', '沙', '天', '場', '技', '心', '氣', '走', '逃', '先', '差',
      '◎', '○', '×', '鬼', '迴', '轉', '上', '下', '地', '風', '雪', '晴', '雨'];
    const set = new Set();
    for (const k of ['', ...new Set(keys)]) {
      if (input) {
        input.value = k;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        await S(700);
      }
      for (const line of csv()) set.add(line);
    }
    out = [...set];
  }
  console.log(`GameTora：抽到 ${out.length} 行（技能名,ID,Pt）`);
  prompt(`抽到 ${out.length} 行，複製下面全部內容貼返去`, out.join('\n'));
})();
