export interface TabInfo {
  id: number;
  url: string;
  title: string;
  favIconUrl?: string;
  pinned: boolean;
  domain: string;
  isDuplicate: boolean;
}

export interface DomainGroup {
  domain: string;
  tabs: TabInfo[];
  expanded: boolean;
}

export interface BookmarkFolder {
  id: string;
  title: string;
  children?: BookmarkFolder[];
  parentId?: string;
}

export interface SaveResult {
  success: boolean;
  tabId: number;
  url: string;
  title: string;
  error?: string;
}

export interface SaveSummary {
  total: number;
  succeeded: number;
  failed: number;
  results: SaveResult[];
  folderId: string;
  folderName: string;
}

export type AppView = "save" | "close" | "restore";

export interface AppState {
  view: AppView;
  saveSummary: SaveSummary | null;
  selectedTabIds: Set<number>;
}
