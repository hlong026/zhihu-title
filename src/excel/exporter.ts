/** Excel 导出：在原表尾部追加结果列，保留原始列与格式。 */

import ExcelJS from "exceljs";
import {
  STATUS_LABELS,
  type CollectRecord,
  type ExportOptions,
  type ExportResult,
} from "../shared/types.js";

/** Excel 单元格文本长度上限 */
const EXCEL_CELL_LIMIT = 32_767;

/** 只有这些状态的链接会回填；review 等待人工处理，其余链接留空 */
const LINKED_STATUSES = new Set(["exact", "auto", "confirmed"]);

/**
 * 读取源表格 → 追加结果列：文章链接 | 采集状态 | 原文字数 | 内容标签 |（可选）正文。
 * 若源表已存在同名结果列（如导入的是之前导出过的文件），复用原列并逐行覆盖，
 * 避免重复导出不断追加同名表头。写入 outputPath，返回统计。
 */
export async function exportExcel(
  sourcePath: string,
  outputPath: string,
  records: Map<number, CollectRecord>,
  options: ExportOptions,
): Promise<ExportResult> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(sourcePath);
  const worksheet = workbook.worksheets[0];
  if (!worksheet) throw new Error("表格中没有可用的工作表");

  // 表头名 → 列号；已有同名列则复用，否则在尾部追加
  const existingHeaders = new Map<string, number>();
  worksheet.getRow(1).eachCell((cell, colNumber) => {
    const text = String(cell.value ?? "").trim();
    if (text && !existingHeaders.has(text))
      existingHeaders.set(text, colNumber);
  });
  let nextColumn = worksheet.columnCount + 1;
  const takeColumn = (header: string): number =>
    existingHeaders.get(header) ?? nextColumn++;

  const linkColumn = takeColumn("文章链接");
  const statusColumn = takeColumn("采集状态");
  const wordCountColumn = takeColumn("原文字数");
  const labelColumn = takeColumn("内容标签");
  const contentColumn = options.includeContent ? takeColumn("正文") : undefined;

  const headerRow = worksheet.getRow(1);
  headerRow.getCell(linkColumn).value = "文章链接";
  headerRow.getCell(statusColumn).value = "采集状态";
  headerRow.getCell(wordCountColumn).value = "原文字数";
  headerRow.getCell(labelColumn).value = "内容标签";
  if (contentColumn) headerRow.getCell(contentColumn).value = "正文";
  headerRow.commit();

  const stats = {
    total: 0,
    linked: 0,
    review: 0,
    notFound: 0,
    failed: 0,
    skipped: 0,
  };
  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const record = records.get(rowNumber);
    if (!record) return;
    stats.total += 1;

    const linked = LINKED_STATUSES.has(record.status) && Boolean(record.url);
    // 复用列时逐行覆盖：无链接/字数/标签/正文时显式清空，避免残留上次导出的陈旧值
    row.getCell(linkColumn).value = linked ? record.url : null;
    if (linked) stats.linked += 1;
    row.getCell(statusColumn).value = STATUS_LABELS[record.status];
    row.getCell(wordCountColumn).value =
      typeof record.wordCount === "number" ? record.wordCount : null;
    row.getCell(labelColumn).value = record.label ?? null;
    if (contentColumn) {
      row.getCell(contentColumn).value = record.content
        ? record.content.slice(0, EXCEL_CELL_LIMIT)
        : null;
    }
    row.commit();

    switch (record.status) {
      case "review":
        stats.review += 1;
        break;
      case "not_found":
        stats.notFound += 1;
        break;
      case "failed":
        stats.failed += 1;
        break;
      case "skipped":
        stats.skipped += 1;
        break;
      default:
        break;
    }
  });

  await workbook.xlsx.writeFile(outputPath);
  return { outputPath, ...stats };
}
