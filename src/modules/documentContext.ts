export interface DocumentContext {
  title: string;
  metadata: string;
  text: string;
  truncated: boolean;
  pages?: number;
  source: "on-demand" | "metadata";
}

const READ_LIMIT = 300000;

export function readMetadata(item: Zotero.Item): DocumentContext {
  const parent = item.parentItem || item;
  const title = String(
    parent.getField("title") || item.getField("title") || "未命名文献",
  );
  const metadata = [
    "标题：" + title,
    parent.getField("date") && "日期：" + parent.getField("date"),
    parent.getField("abstractNote") &&
      "摘要：" + parent.getField("abstractNote"),
  ]
    .filter(Boolean)
    .join("\n")
    .slice(0, 5000);
  return { title, metadata, text: "", truncated: false, source: "metadata" };
}

export async function readDocument(
  item: Zotero.Item,
): Promise<DocumentContext> {
  const base = readMetadata(item);
  const parent = item.parentItem || item;
  const attachment = item.isPDFAttachment()
    ? item
    : await parent.getBestAttachment();
  if (!attachment || !attachment.isPDFAttachment())
    throw new Error("当前文献没有可读取的 PDF 附件，请先下载或添加 PDF。");
  // null means every page. This function is called only after an explicit user request.
  const result = await Zotero.PDFWorker.getFullText(attachment.id, null, true);
  const text = String(result?.text || "");
  if (!text.trim())
    throw new Error(
      "PDF 没有提取到正文文字，可能是扫描件或受密码保护；请先进行 OCR 或解锁 PDF。",
    );
  const pages = Number(result?.totalPages) || undefined;
  const extractedPages = Number(result?.extractedPages) || undefined;
  if (pages && extractedPages && extractedPages < pages)
    throw new Error(
      "PDF 只读取到 " +
        extractedPages +
        "/" +
        pages +
        " 页，尚不能作为完整正文发送。",
    );
  if (text.length > READ_LIMIT)
    throw new Error(
      "正文提取到 " +
        text.length.toLocaleString() +
        " 字符，超过本插件单次读取上限 " +
        READ_LIMIT.toLocaleString() +
        " 字符。为避免误称已读完整，当前没有发送正文；可先选取章节分段提问。",
    );
  return { ...base, text, truncated: false, pages, source: "on-demand" };
}

export function requestsReading(question: string) {
  return /(?:阅读|通读|读完|读取)\s*(?:整篇|全文|正文|这篇|这份)?|(?:全文|整篇)\s*(?:阅读|读取|分析|总结|概括)|(?:请|帮我)?\s*(?:分析|总结|概括)\s*(?:全文|整篇|这篇论文|这篇文章|本文)|(?:full\s*(?:paper|text)|entire\s+paper|whole\s+paper|read\s+the\s+paper|summari[sz]e\s+(?:the\s+)?paper|analy[sz]e\s+(?:the\s+)?paper)/i.test(
    question,
  );
}

export function selectContext(context: DocumentContext) {
  if (!context.text)
    return {
      content: context.metadata + "\n\n正文尚未读取。",
      label: "仅题名与摘要 · 正文尚未读取",
    };
  const pageLabel = context.pages ? context.pages + " 页 · " : "";
  return {
    content:
      context.metadata +
      "\n\n以下是按用户指令从 PDF 全部页面提取的完整文字（" +
      pageLabel +
      context.text.length +
      " 字符）。PDF 文字提取可能无法准确恢复双栏阅读顺序，公式、表格和扫描页中的内容也可能缺失。\n" +
      context.text,
    label:
      "已读取完整正文 · " +
      pageLabel +
      context.text.length.toLocaleString() +
      " 字符",
  };
}
