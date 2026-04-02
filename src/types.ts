export interface Feed {
  id: number;
  url: string;
  title: string | null;
  last_fetched_at: string | null;
  category: string | null;
  created_at: string;
}

export interface Article {
  id: number;
  feed_id: number | null;
  url: string;
  title: string | null;
  content: string | null;
  published_at: string | null;
  fetched_at: string;
  score: number | null;
  summary: string | null;
  curated_at: string | null;
  read_at: string | null;
  tags: string | null;
  dismissed_at: string | null;
  archived_at: string | null;
}

export interface RssItem {
  title: string;
  url: string;
  content: string;
  publishedAt: string | null;
}
