export type ActivityItemType = "commit" | "task" | "grouped_change";

export interface ActivityItem {
  type: ActivityItemType;
  source: string;
  project: "motus" | "thestayed" | "bdhe" | "other";
  title: string;
  summary: string;
  url?: string;
  timestamp: string;
  tags?: string[];
}

export interface WeeklyActivity {
  lookbackDays: number;
  weekStartIso: string;
  weekEndIso: string;
  items: ActivityItem[];
  stats: {
    commitCount: number;
    taskCount: number;
    groupedChanges: number;
  };
}

export interface BlogPost {
  title: string;
  slug: string;
  markdown: string;
  teaser: string;
  metaDescription: string;
  tags: string[];
}

export interface StylePattern {
  pattern: string;
  confidence: number;
  reinforcedCount: number;
  lastSeenAt: string;
}
