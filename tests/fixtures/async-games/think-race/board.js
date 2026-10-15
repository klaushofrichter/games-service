// Think Race on the board: the count, the target, and who is thinking (info.aiThinking, D-112).
export function mount(root) {
  root.innerHTML = `<div class="think-race" style="position:absolute;inset:0;display:grid;place-items:center;font:600 64px system-ui;color:#f3eee2"><div><div data-count></div><div data-thinking style="font-size:28px;opacity:.8;text-align:center"></div></div></div>`;
  return {
    update(view, _events, info) {
      root.querySelector("[data-count]").textContent = `${view.count} / ${view.target}`;
      const names = (info.aiThinking ?? []).map((t) => info.players.find((p) => p.id === t.playerId)?.name ?? "AI");
      root.querySelector("[data-thinking]").textContent = names.length ? `${names.join(", ")} thinking…` : "";
    },
    destroy() {
      root.innerHTML = "";
    },
  };
}
