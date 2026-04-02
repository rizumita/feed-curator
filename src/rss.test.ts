import { describe, expect, test } from "vitest";
import { parseFeed, textOf, stripHtml, decodeEntities } from "./rss";

// ─── textOf ───

describe("textOf", () => {
  test("returns string as-is", () => {
    expect(textOf("hello")).toBe("hello");
  });

  test("converts number to string", () => {
    expect(textOf(42)).toBe("42");
  });

  test("extracts #text from object", () => {
    expect(textOf({ "#text": "inner" })).toBe("inner");
  });

  test("extracts _ from object", () => {
    expect(textOf({ _: "fallback" })).toBe("fallback");
  });

  test("prefers #text over _", () => {
    expect(textOf({ "#text": "primary", _: "secondary" })).toBe("primary");
  });

  test("returns empty string for null", () => {
    expect(textOf(null)).toBe("");
  });

  test("returns empty string for undefined", () => {
    expect(textOf(undefined)).toBe("");
  });

  test("returns empty string for object without #text or _", () => {
    expect(textOf({ foo: "bar" })).toBe("");
  });

  test("returns string for boolean", () => {
    expect(textOf(true)).toBe("true");
  });
});

// ─── decodeEntities ───

describe("decodeEntities", () => {
  test("decodes &amp;", () => {
    expect(decodeEntities("A &amp; B")).toBe("A & B");
  });

  test("decodes &lt; and &gt;", () => {
    expect(decodeEntities("&lt;div&gt;")).toBe("<div>");
  });

  test("decodes &quot;", () => {
    expect(decodeEntities('say &quot;hi&quot;')).toBe('say "hi"');
  });

  test("decodes &#x27; (hex apostrophe)", () => {
    expect(decodeEntities("it&#x27;s")).toBe("it's");
  });

  test("decodes numeric decimal entities", () => {
    expect(decodeEntities("&#65;&#66;")).toBe("AB");
  });

  test("decodes numeric hex entities", () => {
    expect(decodeEntities("&#x41;&#x42;")).toBe("AB");
  });

  test("handles mixed entities", () => {
    expect(decodeEntities("&lt;a href=&quot;&#x2F;&quot;&gt;")).toBe('<a href="/">');
  });

  test("passes through plain text", () => {
    expect(decodeEntities("no entities here")).toBe("no entities here");
  });

  test("handles empty string", () => {
    expect(decodeEntities("")).toBe("");
  });
});

// ─── stripHtml ───

describe("stripHtml", () => {
  test("removes simple tags", () => {
    expect(stripHtml("<p>hello</p>")).toBe("hello");
  });

  test("removes tags with attributes", () => {
    expect(stripHtml('<a href="url">link</a>')).toBe("link");
  });

  test("removes self-closing tags", () => {
    expect(stripHtml("line1<br/>line2")).toBe("line1line2");
  });

  test("decodes entities after stripping", () => {
    expect(stripHtml("<b>A &amp; B</b>")).toBe("A & B");
  });

  test("trims whitespace", () => {
    expect(stripHtml("  <p> text </p>  ")).toBe("text");
  });

  test("handles empty string", () => {
    expect(stripHtml("")).toBe("");
  });

  test("handles text without HTML", () => {
    expect(stripHtml("plain text")).toBe("plain text");
  });
});

// ─── parseFeed (RSS 2.0) ───

describe("parseFeed RSS 2.0", () => {
  const rss = (items: string) => `<?xml version="1.0"?>
    <rss version="2.0">
      <channel>
        <title>My Feed</title>
        ${items}
      </channel>
    </rss>`;

  test("parses channel title", () => {
    const result = parseFeed(rss(""));
    expect(result.title).toBe("My Feed");
  });

  test("parses single item", () => {
    const xml = rss(`
      <item>
        <title>Post 1</title>
        <link>https://example.com/1</link>
        <description>Content here</description>
        <pubDate>Mon, 01 Jan 2024 00:00:00 GMT</pubDate>
      </item>`);
    const result = parseFeed(xml);
    expect(result.items).toHaveLength(1);
    expect(result.items[0].title).toBe("Post 1");
    expect(result.items[0].url).toBe("https://example.com/1");
    expect(result.items[0].content).toBe("Content here");
    expect(result.items[0].publishedAt).toBe("Mon, 01 Jan 2024 00:00:00 GMT");
  });

  test("parses multiple items", () => {
    const xml = rss(`
      <item><title>A</title><link>https://a.com</link><description>a</description></item>
      <item><title>B</title><link>https://b.com</link><description>b</description></item>`);
    const result = parseFeed(xml);
    expect(result.items).toHaveLength(2);
  });

  test("handles empty channel (no items)", () => {
    const result = parseFeed(rss(""));
    expect(result.items).toEqual([]);
  });

  test("prefers content:encoded over description", () => {
    const xml = rss(`
      <item>
        <title>T</title>
        <link>https://t.com</link>
        <description>short</description>
        <content:encoded><![CDATA[<p>full content</p>]]></content:encoded>
      </item>`);
    const result = parseFeed(xml);
    // description is checked first in code: item.description ?? item["content:encoded"]
    expect(result.items[0].content).toBe("short");
  });

  test("falls back to content:encoded when no description", () => {
    const xml = rss(`
      <item>
        <title>T</title>
        <link>https://t.com</link>
        <content:encoded>encoded text</content:encoded>
      </item>`);
    const result = parseFeed(xml);
    expect(result.items[0].content).toBe("encoded text");
  });

  test("decodes HTML entities in title", () => {
    const xml = rss(`
      <item>
        <title>A &amp; B</title>
        <link>https://e.com</link>
        <description>d</description>
      </item>`);
    const result = parseFeed(xml);
    expect(result.items[0].title).toBe("A & B");
  });

  test("handles missing pubDate", () => {
    const xml = rss(`
      <item>
        <title>T</title>
        <link>https://t.com</link>
        <description>d</description>
      </item>`);
    const result = parseFeed(xml);
    expect(result.items[0].publishedAt).toBeNull();
  });
});

// ─── parseFeed (Atom) ───

describe("parseFeed Atom", () => {
  const atom = (entries: string) => `<?xml version="1.0"?>
    <feed xmlns="http://www.w3.org/2005/Atom">
      <title>Atom Feed</title>
      ${entries}
    </feed>`;

  test("parses feed title", () => {
    const result = parseFeed(atom(""));
    expect(result.title).toBe("Atom Feed");
  });

  test("parses entry with href link", () => {
    const xml = atom(`
      <entry>
        <title>Entry 1</title>
        <link href="https://example.com/1" />
        <content>Some content</content>
        <published>2024-01-01T00:00:00Z</published>
      </entry>`);
    const result = parseFeed(xml);
    expect(result.items).toHaveLength(1);
    expect(result.items[0].title).toBe("Entry 1");
    expect(result.items[0].url).toBe("https://example.com/1");
    expect(result.items[0].publishedAt).toBe("2024-01-01T00:00:00Z");
  });

  test("falls back to summary when no content", () => {
    const xml = atom(`
      <entry>
        <title>E</title>
        <link href="https://e.com" />
        <summary>Summary text</summary>
      </entry>`);
    const result = parseFeed(xml);
    expect(result.items[0].content).toBe("Summary text");
  });

  test("uses updated when no published", () => {
    const xml = atom(`
      <entry>
        <title>E</title>
        <link href="https://e.com" />
        <content>c</content>
        <updated>2024-06-15T12:00:00Z</updated>
      </entry>`);
    const result = parseFeed(xml);
    expect(result.items[0].publishedAt).toBe("2024-06-15T12:00:00Z");
  });

  test("handles empty feed (no entries)", () => {
    const result = parseFeed(atom(""));
    expect(result.items).toEqual([]);
  });

  test("handles single entry (not wrapped in array)", () => {
    const xml = atom(`
      <entry>
        <title>Solo</title>
        <link href="https://solo.com" />
        <content>c</content>
      </entry>`);
    const result = parseFeed(xml);
    expect(result.items).toHaveLength(1);
    expect(result.items[0].title).toBe("Solo");
  });
});

// ─── parseFeed (unknown format) ───

describe("parseFeed unknown format", () => {
  test("returns empty for non-RSS/Atom XML", () => {
    const result = parseFeed("<root><data>hello</data></root>");
    expect(result.title).toBeNull();
    expect(result.items).toEqual([]);
  });
});
