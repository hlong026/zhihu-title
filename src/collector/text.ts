/** 文本处理：HTML 剥离、实体解码、标题归一化、字数统计。 */

const ENTITY_MAP: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: "\u00a0",
  hellip: "…",
  mdash: "—",
  ndash: "–",
  ldquo: "\u201c",
  rdquo: "\u201d",
  lsquo: "\u2018",
  rsquo: "\u2019",
};

/** 解码常见 HTML 实体（含数字实体），不引入额外依赖 */
export function decodeHtmlEntities(text: string): string {
  return text.replace(
    /&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g,
    (match, entity: string) => {
      if (entity.startsWith("#")) {
        const code =
          entity[1] === "x" || entity[1] === "X"
            ? Number.parseInt(entity.slice(2), 16)
            : Number.parseInt(entity.slice(1), 10);
        if (Number.isFinite(code) && code > 0 && code <= 0x10ffff) {
          return String.fromCodePoint(code);
        }
        return match;
      }
      return ENTITY_MAP[entity.toLowerCase()] ?? match;
    },
  );
}

/** 去掉全部 HTML 标签（知乎搜索结果标题带 <em> 高亮标签，必须先剥离） */
export function stripHtmlTags(html: string): string {
  return html.replace(/<[^>]+>/g, "");
}

/** HTML → 纯文本：去标签、解码实体、折叠空白 */
export function htmlToPlainText(html: string): string {
  const withoutTags = stripHtmlTags(String(html ?? ""));
  const decoded = decodeHtmlEntities(withoutTags);
  return decoded.replace(/\s+/g, " ").trim();
}

/**
 * 字数口径：去 HTML 标签、解码实体、去所有空白后的纯文本字符数。
 * 例：2857 字符的 HTML 正文 → 约 2016 字。
 */
export function countWords(html: string): number {
  const plain = stripHtmlTags(String(html ?? ""));
  const decoded = decodeHtmlEntities(plain);
  return decoded.replace(/[\s\u00a0\u200b\ufeff]+/g, "").length;
}

/** HTML → 导出用纯文本：去标签、解码实体、保留换行结构、去掉行内多余空白 */
export function htmlToExportText(html: string): string {
  const normalized = String(html ?? "")
    .replace(/<\s*(p|div|br|li|h[1-6]|blockquote|figure)[^>]*\/?\s*>/gi, "\n")
    .replace(/<\/\s*(p|div|li|h[1-6]|blockquote|figure)\s*>/gi, "\n");
  const decoded = decodeHtmlEntities(stripHtmlTags(normalized));
  return decoded
    .split("\n")
    .map((line) => line.replace(/[ \t\u00a0]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * 标题归一化：去 HTML 标签 → 解码实体 → NFKC → 去标点与空白 → 小写。
 * 标点表覆盖全/半角常见中英文标点；`-` 必须放在字符类末尾避免范围歧义。
 */
export function normalizeTitle(input: string): string {
  return decodeHtmlEntities(String(input ?? "").replace(/<[^>]+>/g, ""))
    .normalize("NFKC")
    .replace(/[\s\u00a0\u200b\ufeff]+/g, "")
    .replace(
      /[？?！!，,。.、\u201c\u201d\u2018\u2019"'：:；;…~～—–\-·•《》〈〉「」『』【】〔〕()\[\]{}<>]+/g,
      "",
    )
    .toLowerCase();
}
