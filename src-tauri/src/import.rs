//! Bringing subscriptions in and out.
//!
//! Files (OPML, Google Takeout CSV, NewPipe and FreeTube exports)
//! are parsed in the front end; OPML export is written here.


fn xml_escape(s: &str) -> String { s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;") }

/// An OPML file of the subscriptions (title, feed address), the format every podcast app imports.
pub fn opml(shows: &[(String, String)]) -> String {
    let mut out = String::from("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<opml version=\"2.0\">\n  <head><title>SubCast</title></head>\n  <body>\n");
    for (title, url) in shows {
        out.push_str(&format!("    <outline type=\"rss\" text=\"{0}\" title=\"{0}\" xmlUrl=\"{1}\"/>\n", xml_escape(title), xml_escape(url)));
    }
    out.push_str("  </body>\n</opml>\n");
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn opml_escapes() {
        let o = opml(&[("A & B <1>".into(), "https://x.com/feed?a=1&b=2".into())]);
        assert!(o.contains("text=\"A &amp; B &lt;1&gt;\"") && o.contains("xmlUrl=\"https://x.com/feed?a=1&amp;b=2\""));
    }
}
