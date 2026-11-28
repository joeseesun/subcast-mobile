import homeMark from "../../src-tauri/gen/apple/Assets.xcassets/BrandNavHome.imageset/glyph.svg";
import discoverMark from "../../src-tauri/gen/apple/Assets.xcassets/BrandNavDiscover.imageset/glyph.svg";
import libraryMark from "../../src-tauri/gen/apple/Assets.xcassets/BrandNavLibrary.imageset/glyph.svg";

const navigationMarks = { listen: homeMark, discover: discoverMark, library: libraryMark };

type Glyph = "listen" | "discover" | "library" | "search" | "saved" | "cache" | "history" | "stats" | "settings" | "play" | "pause" | "back" | "next" | "more" | "plus" | "filter" | "film" | "sound" | "quote";

export function BrandGlyph({ name, size = 24, interval }: { name: Glyph; size?: number; interval?: number }) {
  if (name === "listen" || name === "discover" || name === "library") {
    const mask = `url("${navigationMarks[name]}") center / contain no-repeat`;
    return <span className="navigation-mark" aria-hidden="true" style={{ width: size, height: size, mask, WebkitMask: mask }} />;
  }
  let drawing;
  switch (name) {
    case "search":
      drawing = <><circle cx="10.5" cy="10.5" r="5.8"/><path d="m14.8 14.8 4.4 4.4"/></>;
      break;
    case "saved":
      drawing = <path d="M7.4 4.2h9.2a1.4 1.4 0 0 1 1.4 1.4v14.1l-6-3.7-6 3.7V5.6a1.4 1.4 0 0 1 1.4-1.4Z"/>;
      break;
    case "cache":
      drawing = <path d="M12 3.2v10.9m-3.8-4.2 3.8 4.2 3.8-4.2M4 14.4v3.9a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3.9"/>;
      break;
    case "history":
      drawing = <path d="M4.1 7.7v4.5h4.5M4.4 11.6a7.8 7.8 0 1 1 1.8 5.8M12.4 7.8v4.7l3.1 1.8" />;
      break;
    case "stats":
      drawing = <path d="M3.5 13.5h2.8l2.1-5.9 3.1 10.4 3.1-12.8 2.4 8.3h3.5"/>;
      break;
    case "settings":
      drawing = <><path d="M4.3 6.9h4.2m4.5 0h6.7M4.3 17.1h7.1m4.6 0h3.7"/><circle cx="10.7" cy="6.9" r="2.2"/><circle cx="13.7" cy="17.1" r="2.2"/></>;
      break;
    case "play":
      drawing = <path fill="currentColor" stroke="none" d="M7.2 5.5c0-1 .9-1.5 1.8-1l10.3 6.4a1.3 1.3 0 0 1 0 2.2L9 19.5c-.9.5-1.8 0-1.8-1V5.5Z"/>;
      break;
    case "pause":
      drawing = <g fill="currentColor" stroke="none"><rect x="6.3" y="4.3" width="4" height="15.4" rx="1.4"/><rect x="13.7" y="4.3" width="4" height="15.4" rx="1.4"/></g>;
      break;
    case "back":
    case "next":
      // lucide Undo2 / Redo2, shrunk into the top of the box, with the interval written underneath.
      drawing = <>
        <g transform="translate(3.6 -1.4) scale(.7)" strokeWidth="2.5">
          {name === "back"
            ? <><path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5a5.5 5.5 0 0 1-5.5 5.5H11"/></>
            : <><path d="m15 14 5-5-5-5"/><path d="M20 9H9.5A5.5 5.5 0 0 0 4 14.5A5.5 5.5 0 0 0 9.5 20H13"/></>}
        </g>
        <text x="12" y="22.6" textAnchor="middle" fill="currentColor" stroke="none" fontSize="8.2" fontWeight="650" fontFamily="system-ui, sans-serif" style={{ fontVariantNumeric: "tabular-nums" }}>{interval}</text>
      </>;
      break;
    case "more":
      drawing = <g fill="currentColor" stroke="none"><circle cx="5.5" cy="12" r="1.45"/><circle cx="12" cy="12" r="1.45"/><circle cx="18.5" cy="12" r="1.45"/></g>;
      break;
    case "plus":
      drawing = <path d="M12 5.3v13.4M5.3 12h13.4"/>;
      break;
    case "filter":
      drawing = <path d="M4 7h16M7 12h10m-7 5h4"/>;
      break;
    case "film":
      drawing = <><rect x="3.4" y="5.5" width="17.2" height="13" rx="3"/><path d="m10 9 5 3-5 3V9Z"/></>;
      break;
    case "sound":
      drawing = <path d="M4 10v4m4-7v10m4-13v16m4-13v10m4-7v4"/>;
      break;
    case "quote":
      drawing = <path d="M5 10.5c0-2.6 1.8-4.5 4.4-5m-4.4 5h4.2a1.3 1.3 0 0 1 1.3 1.3v3.9a1.3 1.3 0 0 1-1.3 1.3H6.3A1.3 1.3 0 0 1 5 15.7v-5.2Zm9.5 0c0-2.6 1.8-4.5 4.4-5m-4.4 5h4.2a1.3 1.3 0 0 1 1.3 1.3v3.9a1.3 1.3 0 0 1-1.3 1.3h-2.9a1.3 1.3 0 0 1-1.3-1.3v-5.2Z"/>;
      break;
  }
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">{drawing}</svg>;
}
