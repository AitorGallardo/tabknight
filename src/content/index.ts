interface NavigatorTab {
  id: number;
  windowId: number;
  title: string;
  url: string;
  favIconUrl?: string;
  pinned: boolean;
  active: boolean;
  index: number;
  lastAccessed: number;
}

type NavigatorItem =
  | { type: "open"; id: "open"; title: string; subtitle: string }
  | { type: "tab"; id: string; tab: NavigatorTab; score: number };

interface QueryResponse {
  ok: boolean;
  tabs?: NavigatorTab[];
  currentWindowId?: number | null;
  error?: string;
}

interface RuntimeResult {
  ok: boolean;
  error?: string;
}

const HOST_ID = "tabknight-arc-navigator-host";
let host: HTMLDivElement | null = null;
let shadow: ShadowRoot | null = null;
let tabs: NavigatorTab[] = [];
let currentWindowId: number | null = null;
let query = "";
let activeIndex = 0;

function scoreTab(tab: NavigatorTab, search: string): number {
  const q = search.toLowerCase();
  if (!q) {
    return (tab.active ? 300 : 0) + (tab.pinned ? 25 : 0) + tab.lastAccessed / 1_000_000;
  }

  const title = tab.title.toLowerCase();
  const url = tab.url.toLowerCase();

  let score = 0;
  if (title === q) score += 600;
  if (title.startsWith(q)) score += 320;
  if (title.includes(q)) score += 220;
  if (url.includes(q)) score += 160;
  if (tab.active) score += 20;
  if (tab.pinned) score += 12;

  return score;
}

function buildItems(): NavigatorItem[] {
  const q = query.trim();

  const rankedTabs: NavigatorItem[] = tabs
    .map((tab) => ({ tab, score: scoreTab(tab, q) }))
    .filter(({ score }) => !q || score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (a.tab.windowId === currentWindowId && b.tab.windowId !== currentWindowId) return -1;
      if (b.tab.windowId === currentWindowId && a.tab.windowId !== currentWindowId) return 1;
      if (a.tab.windowId !== b.tab.windowId) return a.tab.windowId - b.tab.windowId;
      return a.tab.index - b.tab.index;
    })
    .map(({ tab, score }) => ({
      type: "tab" as const,
      id: `tab-${tab.id}`,
      tab,
      score,
    }));

  if (!q) return rankedTabs;

  return [
    {
      type: "open" as const,
      id: "open",
      title: `Open \"${q}\"`,
      subtitle: "Search or open URL in new tab",
    },
    ...rankedTabs,
  ];
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function closeNavigator(): void {
  host?.remove();
  host = null;
  shadow = null;
  query = "";
  activeIndex = 0;
}

async function runtimeMessage<T>(message: unknown): Promise<T> {
  return chrome.runtime.sendMessage(message) as Promise<T>;
}

async function executeItem(item: NavigatorItem | undefined): Promise<void> {
  if (!item) return;

  if (item.type === "open") {
    const response = await runtimeMessage<RuntimeResult>({
      type: "TAB_NAVIGATOR_OPEN_QUERY",
      query,
    });
    if (!response.ok) return;
    closeNavigator();
    return;
  }

  const response = await runtimeMessage<RuntimeResult>({
    type: "TAB_NAVIGATOR_ACTIVATE",
    tabId: item.tab.id,
    windowId: item.tab.windowId,
  });
  if (!response.ok) return;
  closeNavigator();
}

function styleText(): string {
  return `
    :host {
      all: initial;
    }

    .tk-backdrop {
      position: fixed;
      inset: 0;
      z-index: 2147483647;
      display: flex;
      align-items: center;
      justify-content: center;
      background: rgba(6, 7, 10, 0.34);
      backdrop-filter: blur(7px) saturate(105%);
      -webkit-backdrop-filter: blur(7px) saturate(105%);
      font-family: "Inter", "SF Pro Text", "Segoe UI", sans-serif;
      color: rgba(245, 245, 248, 0.95);
    }

    .tk-panel {
      width: min(760px, calc(100vw - 44px));
      max-height: min(430px, calc(100vh - 84px));
      border-radius: 16px;
      border: 1px solid rgba(255, 255, 255, 0.19);
      background:
        radial-gradient(70% 110% at 68% 90%, rgba(95, 41, 14, 0.19), transparent 68%),
        radial-gradient(62% 95% at 26% 95%, rgba(24, 39, 95, 0.18), transparent 70%),
        linear-gradient(180deg, rgba(21, 23, 30, 0.82), rgba(14, 16, 23, 0.78));
      backdrop-filter: blur(22px) saturate(145%);
      -webkit-backdrop-filter: blur(22px) saturate(145%);
      box-shadow: 0 30px 80px rgba(0, 0, 0, 0.5);
      overflow: hidden;
    }

    .tk-head {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 16px 18px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.1);
    }

    .tk-search-icon {
      width: 20px;
      height: 20px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      color: rgba(232, 232, 236, 0.88);
      flex: 0 0 auto;
    }

    .tk-input {
      width: 100%;
      border: 0;
      outline: none;
      background: transparent;
      color: rgba(245, 245, 248, 0.94);
      font-size: 28px;
      line-height: 1.14;
      letter-spacing: -0.02em;
      font-weight: 560;
      caret-color: #43a7ff;
      font-family: "Inter", "SF Pro Display", "Segoe UI", sans-serif;
    }

    .tk-input::placeholder {
      color: rgba(198, 199, 206, 0.32);
    }

    .tk-info {
      width: 26px;
      height: 26px;
      border-radius: 999px;
      border: 1px solid rgba(255, 255, 255, 0.16);
      background: rgba(7, 8, 12, 0.7);
      color: rgba(232, 233, 238, 0.88);
      display: inline-flex;
      align-items: center;
      justify-content: center;
      font-size: 13px;
      font-weight: 700;
      flex: 0 0 auto;
    }

    .tk-list {
      padding: 8px;
      max-height: min(310px, calc(100vh - 190px));
      overflow-y: auto;
      overflow-x: hidden;
      display: flex;
      flex-direction: column;
      gap: 4px;
      scrollbar-width: thin;
      scrollbar-color: rgba(255, 255, 255, 0.22) transparent;
    }

    .tk-list::-webkit-scrollbar {
      width: 8px;
    }

    .tk-list::-webkit-scrollbar-track {
      background: transparent;
    }

    .tk-list::-webkit-scrollbar-thumb {
      background: rgba(255, 255, 255, 0.18);
      border-radius: 999px;
    }

    .tk-list::-webkit-scrollbar-thumb:hover {
      background: rgba(255, 255, 255, 0.26);
    }

    .tk-item {
      border: 1px solid transparent;
      border-radius: 10px;
      background: transparent;
      color: rgba(241, 241, 244, 0.94);
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      align-items: center;
      gap: 16px;
      width: 100%;
      padding: 9px 12px;
      text-align: left;
      cursor: pointer;
      transition: background-color .12s ease, border-color .12s ease;
      font-family: "Inter", "SF Pro Text", "Segoe UI", sans-serif;
    }

    .tk-item:hover {
      background: rgba(255, 255, 255, 0.07);
    }

    .tk-item.active {
      background: rgba(255, 255, 255, 0.16);
      border-color: rgba(255, 255, 255, 0.12);
    }

    .tk-left {
      display: flex;
      align-items: center;
      min-width: 0;
      gap: 10px;
    }

    .tk-icon {
      width: 26px;
      height: 26px;
      border-radius: 7px;
      background: rgba(255, 255, 255, 0.09);
      display: inline-flex;
      align-items: center;
      justify-content: center;
      flex: 0 0 auto;
      font-size: 14px;
      overflow: hidden;
    }

    .tk-favicon {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }

    .tk-text {
      min-width: 0;
      display: grid;
      gap: 2px;
    }

    .tk-title {
      font-size: 17px;
      line-height: 1.22;
      letter-spacing: -0.01em;
      font-weight: 580;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .tk-subtitle {
      font-size: 11px;
      color: rgba(214, 214, 219, 0.5);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .tk-right {
      display: flex;
      align-items: center;
      gap: 9px;
      color: rgba(232, 232, 237, 0.74);
      font-size: 12px;
      font-weight: 600;
      letter-spacing: 0;
    }

    .tk-action {
      color: rgba(233, 233, 237, 0.68);
      white-space: nowrap;
    }

    .tk-arrow {
      width: 32px;
      height: 32px;
      border-radius: 8px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      font-size: 22px;
      line-height: 1;
      background: rgba(255, 255, 255, 0.12);
      color: rgba(232, 232, 237, 0.92);
    }

    .tk-empty {
      color: rgba(218, 218, 225, 0.7);
      padding: 14px 10px 16px;
      font-size: 12px;
    }

    @media (max-width: 900px) {
      .tk-panel {
        width: calc(100vw - 16px);
        max-height: calc(100vh - 24px);
        border-radius: 12px;
      }

      .tk-head {
        padding: 10px;
      }

      .tk-input {
        font-size: 20px;
      }

      .tk-list {
        max-height: calc(100vh - 132px);
        padding: 6px;
      }

      .tk-info {
        width: 22px;
        height: 22px;
        font-size: 11px;
      }

      .tk-item {
        padding: 8px;
      }

      .tk-title {
        font-size: 14px;
      }

      .tk-right {
        font-size: 11px;
        gap: 7px;
      }

      .tk-arrow {
        width: 28px;
        height: 28px;
        font-size: 20px;
      }

      .tk-action {
        display: none;
      }
    }
  `;
}

function render(): void {
  if (!shadow) return;

  const items = buildItems();
  activeIndex = Math.max(0, Math.min(activeIndex, Math.max(0, items.length - 1)));

  const listMarkup = items
    .map((item, index) => {
      const isActive = index === activeIndex;
      const activeClass = isActive ? " active" : "";

      if (item.type === "open") {
        return `
          <button class="tk-item${activeClass}" data-index="${index}" type="button">
            <div class="tk-left">
              <div class="tk-icon">+</div>
              <div class="tk-text">
                <div class="tk-title">${escapeHtml(item.title)}</div>
                <div class="tk-subtitle">${escapeHtml(item.subtitle)}</div>
              </div>
            </div>
            <div class="tk-right">
              <span class="tk-action">Open in New Tab</span>
              <span class="tk-arrow">→</span>
            </div>
          </button>
        `;
      }

      const icon = item.tab.favIconUrl
        ? `<img class="tk-favicon" src="${escapeHtml(item.tab.favIconUrl)}" alt="" />`
        : "•";

      return `
        <button class="tk-item${activeClass}" data-index="${index}" type="button">
          <div class="tk-left">
            <div class="tk-icon">${icon}</div>
            <div class="tk-text">
              <div class="tk-title">${escapeHtml(item.tab.title)}</div>
              <div class="tk-subtitle">${escapeHtml(item.tab.url)}</div>
            </div>
          </div>
          <div class="tk-right">
            <span class="tk-action">Switch to Tab</span>
            <span class="tk-arrow">→</span>
          </div>
        </button>
      `;
    })
    .join("");

  shadow.innerHTML = `
    <style>${styleText()}</style>
    <div class="tk-backdrop" data-role="backdrop">
      <div class="tk-panel" data-role="panel">
        <div class="tk-head">
          <span class="tk-search-icon" aria-hidden="true">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <circle cx="11" cy="11" r="7" stroke="currentColor" stroke-width="2"></circle>
              <path d="M16.5 16.5L21 21" stroke="currentColor" stroke-width="2" stroke-linecap="round"></path>
            </svg>
          </span>
          <input class="tk-input" type="text" placeholder="Search or Enter URL..." value="${escapeHtml(query)}" autofocus />
          <span class="tk-info" aria-hidden="true">i</span>
        </div>
        <div class="tk-list">
          ${items.length > 0 ? listMarkup : '<div class="tk-empty">No matching tabs</div>'}
        </div>
      </div>
    </div>
  `;

  const input = shadow.querySelector<HTMLInputElement>(".tk-input");
  const activeItem = shadow.querySelector<HTMLElement>(".tk-item.active");
  input?.focus();
  input?.setSelectionRange(query.length, query.length);
  activeItem?.scrollIntoView({
    block: "nearest",
    inline: "nearest",
  });

  input?.addEventListener("input", (event) => {
    query = (event.currentTarget as HTMLInputElement).value;
    activeIndex = 0;
    render();
  });

  input?.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      activeIndex = Math.min(activeIndex + 1, Math.max(0, buildItems().length - 1));
      render();
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      activeIndex = Math.max(0, activeIndex - 1);
      render();
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      void executeItem(buildItems()[activeIndex]);
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      closeNavigator();
    }
  });

  shadow.querySelector<HTMLElement>("[data-role='backdrop']")?.addEventListener("click", (event) => {
    if (event.target === event.currentTarget) {
      closeNavigator();
    }
  });

  for (const button of shadow.querySelectorAll<HTMLButtonElement>(".tk-item")) {
    button.addEventListener("mouseenter", () => {
      activeIndex = Number(button.dataset.index || 0);
      render();
    });

    button.addEventListener("click", () => {
      const index = Number(button.dataset.index || 0);
      void executeItem(buildItems()[index]);
    });
  }
}

async function openNavigator(): Promise<void> {
  if (host) {
    closeNavigator();
    return;
  }

  const response = await runtimeMessage<QueryResponse>({ type: "TAB_NAVIGATOR_QUERY" });
  if (!response.ok || !response.tabs) return;

  tabs = response.tabs;
  currentWindowId = response.currentWindowId ?? null;
  query = "";
  activeIndex = 0;

  host = document.createElement("div");
  host.id = HOST_ID;
  shadow = host.attachShadow({ mode: "open" });
  document.documentElement.appendChild(host);

  render();
}

document.addEventListener(
  "keydown",
  (event) => {
    const key = event.key.toLowerCase();
    const isCmdCtrlT =
      event.metaKey &&
      event.ctrlKey &&
      !event.altKey &&
      !event.shiftKey &&
      key === "t";

    if (!isCmdCtrlT) return;

    event.preventDefault();
    event.stopPropagation();
    void openNavigator();
  },
  true
);

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "TAB_NAVIGATOR_TOGGLE") {
    void openNavigator().then(() => sendResponse({ ok: true }));
    return true;
  }

  return false;
});
