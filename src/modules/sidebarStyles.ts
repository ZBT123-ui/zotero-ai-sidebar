const STYLE_ID = "zotero-ai-sidebar-styles";
const styledDocuments = new Set<Document>();

export function loadSidebarStyles(doc: Document) {
  if (doc.getElementById(STYLE_ID)) return;
  const link = doc.createElementNS(
    "http://www.w3.org/1999/xhtml",
    "link",
  ) as HTMLLinkElement;
  link.id = STYLE_ID;
  link.rel = "stylesheet";
  link.href = "chrome://zoteroAISidebar/content/zoteroPane.css";
  doc.documentElement?.append(link);
  const math = doc.createElementNS(
    "http://www.w3.org/1999/xhtml",
    "link",
  ) as HTMLLinkElement;
  math.id = `${STYLE_ID}-math`;
  math.rel = "stylesheet";
  math.href = "chrome://zoteroAISidebar/content/vendor/katex/katex.min.css";
  doc.documentElement?.append(math);
  styledDocuments.add(doc);
}
export function unloadSidebarStyles(doc?: Document) {
  for (const target of doc ? [doc] : styledDocuments) {
    target.getElementById(STYLE_ID)?.remove();
    target.getElementById(`${STYLE_ID}-math`)?.remove();
    styledDocuments.delete(target);
  }
}
