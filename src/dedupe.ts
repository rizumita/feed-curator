/**
 * Cross-feed duplicate article detection via URL canonicalization.
 *
 * Strategy: normalize URLs by stripping tracking parameters, fragments,
 * and protocol/www differences. Articles with the same canonical URL
 * are considered duplicates.
 */

/** UTM and common tracking parameters to strip */
const TRACKING_PARAMS = new Set([
  "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content",
  "ref", "source", "fbclid", "gclid", "mc_cid", "mc_eid",
]);

/**
 * Normalize a URL for deduplication.
 * - Lowercase protocol and hostname
 * - Remove www. prefix
 * - Strip tracking/UTM parameters
 * - Remove fragment
 * - Remove trailing slash
 */
export function canonicalizeUrl(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);

    // Lowercase protocol and hostname
    url.protocol = url.protocol.toLowerCase();
    url.hostname = url.hostname.toLowerCase();

    // Remove www. prefix
    if (url.hostname.startsWith("www.")) {
      url.hostname = url.hostname.slice(4);
    }

    // Strip tracking parameters
    for (const param of [...url.searchParams.keys()]) {
      if (TRACKING_PARAMS.has(param.toLowerCase())) {
        url.searchParams.delete(param);
      }
    }

    // Sort remaining params for consistency
    url.searchParams.sort();

    // Remove fragment
    url.hash = "";

    // Collapse consecutive slashes in path (e.g. /// → /)
    url.pathname = url.pathname.replace(/\/{2,}/g, "/");

    // Build canonical URL and remove trailing slash (except for root path)
    let canonical = url.toString();
    if (canonical.endsWith("/") && url.pathname !== "/") {
      canonical = canonical.slice(0, -1);
    }

    return canonical;
  } catch {
    // If URL is invalid, return as-is
    return rawUrl;
  }
}
