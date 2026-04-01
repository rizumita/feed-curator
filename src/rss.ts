import { XMLParser } from "fast-xml-parser";
import type { RssItem } from "./types";

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  processEntities: false,
});

export function parseFeed(xml: string): { title: string | null; items: RssItem[] } {
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
      title: decodeEntities(channel.title ?? ""),
      items: rawItems.map((item: any) => ({
        title: decodeEntities(item.title ?? ""),
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
      title: decodeEntities(feed.title ?? ""),
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
          title: decodeEntities(entry.title ?? ""),
          url: link,
          content: stripHtml(
            typeof entry.content === "string"
              ? entry.content
              : entry.content?.["#text"] ?? entry.summary ?? ""
          ),
          publishedAt: entry.published ?? entry.updated ?? null,
        };
      }),
    };
  }

  return { title: null, items: [] };
}

function stripHtml(html: string): string {
  return decodeEntities(html.replace(/<[^>]*>/g, "")).trim();
}

function decodeEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => String.fromCharCode(parseInt(n, 16)));
}
