/** Excel 读取：从导入表格中提取标题列。 */

import ExcelJS from "exceljs";
import type { ImportedRow } from "../shared/types.js";

/** 标题列表头名（兼容大小写与首列回退） */
const TITLE_HEADER = "标题";

export interface ExcelReadResult {
  rows: ImportedRow[];
  /** 标题所在列号（1-based），仅用于提示 */
  titleColumn: number;
}

/**
 * 读取 xlsx 第一个工作表的标题列：
 * - 表头为第 1 行，数据从第 2 行开始（与 titles_1000.jsonl 的 row 约定一致）
 * - 优先找表头名为"标题"的列，找不到则回退第一列
 * - 跳过空标题行
 */
export async function readTitlesFromExcel(
  filePath: string,
): Promise<ExcelReadResult> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);
  const worksheet = workbook.worksheets[0];
  if (!worksheet) throw new Error("表格中没有可用的工作表");

  const titleColumn = findTitleColumn(worksheet);
  const rows: ImportedRow[] = [];
  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const cellValue = row.getCell(titleColumn).value;
    const title = cellToText(cellValue).trim();
    if (title) rows.push({ row: rowNumber, title });
  });
  if (rows.length === 0)
    throw new Error(
      "未在表格中读取到任何标题，请确认第一行为表头且包含“标题”列",
    );
  return { rows, titleColumn };
}

function findTitleColumn(worksheet: ExcelJS.Worksheet): number {
  const headerRow = worksheet.getRow(1);
  for (let column = 1; column <= worksheet.columnCount; column += 1) {
    const text = cellToText(headerRow.getCell(column).value).trim();
    if (text.replace(/[\s▲▼]+/g, "") === TITLE_HEADER) return column;
  }
  return 1;
}

/** 单元格值转纯文本（兼容富文本/公式结果对象） */
export function cellToText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean")
    return String(value);
  if (value instanceof Date) return value.toISOString();
  const richText = (value as { richText?: Array<{ text: string }> }).richText;
  if (richText) return richText.map((part) => part.text).join("");
  const result = (value as { result?: unknown }).result;
  if (result !== undefined) return cellToText(result as ExcelJS.CellValue);
  const text = (value as { text?: unknown }).text;
  if (text !== undefined) return cellToText(text as ExcelJS.CellValue);
  return String(value);
}
