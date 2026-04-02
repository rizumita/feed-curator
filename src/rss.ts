import { XMLParser } from "fast-xml-parser";
import type { RssItem } from "./types";

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  processEntities: false,
});

export function parseFeed(xml: string): { title: string | null; items: RssItem[] } {
  try {
    const parsed = parser.parse(xml);

    // RSS 2.0
    if (parsed.rss?.channel) {
      const channel = parsed.rss.channel;
      const rawItems = Array.isArray(channel.item)
        ? channel.item
        : channel.item
          ? [channel.item]
          : [];

      return {
        title: decodeEntities(textOf(channel.title)),
        items: rawItems.map((item: any) => ({
          title: decodeEntities(textOf(item.title)),
          url: item.link ?? "",
          content: stripHtml(item.description ?? item["content:encoded"] ?? ""),
          publishedAt: item.pubDate ?? null,
        })),
      };
    }

    // Atom
    if (parsed.feed) {
      const feed = parsed.feed;
      const rawEntries = Array.isArray(feed.entry)
        ? feed.entry
        : feed.entry
          ? [feed.entry]
          : [];

      return {
        title: decodeEntities(textOf(feed.title)),
        items: rawEntries.map((entry: any) => {
          const link =
            typeof entry.link === "string"
              ? entry.link
              : entry.link?.["@_href"] ??
                (Array.isArray(entry.link)
                  ? entry.link.find((l: any) => l["@_rel"] === "alternate")?.["@_href"] ??
                    entry.link[0]?.["@_href"]
                  : "") ??
                "";

          return {
            title: decodeEntities(textOf(entry.title)),
            url: link,
            content: stripHtml(textOf(entry.content) || textOf(entry.summary)),
            publishedAt: entry.published ?? entry.updated ?? null,
          };
        }),
      };
    }

    return { title: null, items: [] };
  } catch {
    return { title: null, items: [] };
  }
}

export function textOf(val: unknown): string {
  if (typeof val === "string") return val;
  if (typeof val === "number" || typeof val === "boolean") return String(val);
  if (val && typeof val === "object") {
    const text = (val as any)["#text"] ?? (val as any)["_"];
    return typeof text === "string" ? text : typeof text === "number" ? String(text) : "";
  }
  return "";
}

export function stripHtml(html: string): string {
  const noScripts = String(html)
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "");
  return decodeEntities(noScripts.replace(/<[^>]*>/g, "")).trim();
}

export function decodeEntities(text: string): string {
  const entityMap: Record<string, string> = {
    "&amp;": "&",
    "&lt;": "<",
    "&gt;": ">",
    "&quot;": '"',
    "&#x27;": "'",
    "&apos;": "'",
  };
  return text
    .replace(/&(?:amp|lt|gt|quot|apos|#x27);/g, (m) => entityMap[m] ?? m)
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => String.fromCharCode(parseInt(n, 16)));
}
