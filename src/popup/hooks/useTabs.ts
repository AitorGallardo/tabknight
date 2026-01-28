import { useState, useEffect, useMemo } from "react";
import type { TabInfo, DomainGroup } from "../types";
import { getCurrentWindowTabs, processTabs } from "../lib/chrome-api";
import { groupBy } from "../lib/utils";

interface UseTabsReturn {
  tabs: TabInfo[];
  domainGroups: DomainGroup[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

export function useTabs(): UseTabsReturn {
  const [tabs, setTabs] = useState<TabInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedDomains, setExpandedDomains] = useState<Set<string>>(new Set());

  const fetchTabs = async () => {
    setLoading(true);
    setError(null);
    try {
      const chromeTabs = await getCurrentWindowTabs();
      const processedTabs = processTabs(chromeTabs);
      setTabs(processedTabs);

      // Expand all domains by default
      const domains = new Set(processedTabs.map((t) => t.domain));
      setExpandedDomains(domains);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load tabs");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTabs();
  }, []);

  const domainGroups = useMemo((): DomainGroup[] => {
    const grouped = groupBy(tabs, (tab) => tab.domain);
    return Object.entries(grouped)
      .map(([domain, domainTabs]) => ({
        domain,
        tabs: domainTabs,
        expanded: expandedDomains.has(domain),
      }))
      .sort((a, b) => b.tabs.length - a.tabs.length); // Sort by tab count descending
  }, [tabs, expandedDomains]);

  return {
    tabs,
    domainGroups,
    loading,
    error,
    refresh: fetchTabs,
  };
}
