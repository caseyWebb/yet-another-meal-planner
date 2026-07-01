// The text helpers moved to the runtime-agnostic @grocery-agent/contract package
// (shared with the scraper). Re-exported here so existing `./text.js` importers
// (feeds.ts, discovery.ts, …) are unchanged.

export { cleanText, truncate, decodeEntities } from "@grocery-agent/contract";
