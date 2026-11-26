// The App Store / TestFlight edition (VITE_STORE=1, cargo feature "store"): YouTube plays only in YouTube's own
// embedded player and is never downloaded or transcribed on the phone (App Review 5.2.3). Podcasts from RSS keep
// everything. Builds you compile yourself are the full edition.
export const STORE = import.meta.env.VITE_STORE === "1";

/** A YouTube video with no podcast audio beside it. */
export const youtubeOnly = (ep: { videoId?: string | null; audioUrl?: string | null }) => !!ep.videoId && !ep.audioUrl;
