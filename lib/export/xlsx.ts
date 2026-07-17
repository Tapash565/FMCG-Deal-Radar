/**
 * XLSX — the deals as a workbook, one row per deal, built for an analyst who wants to
 * sort and filter rather than read prose.
 *
 * Columns come from lib/export/rows.ts, the same projection the CSV uses, so the two
 * tabular exports can never drift apart. The header row is frozen and auto-filtered; the
 * raw numeric value column carries the magnitude for sorting, while the display Value
 * column keeps "Undisclosed" honest for reading.
 */

import ExcelJS from 'exceljs';
import { DEAL_COLUMNS, dealRows } from './rows';
import type { Snapshot } from '../types';

// Column widths, index-aligned with DEAL_COLUMNS. Wide enough for the long fields
// (company names, source lists, URLs) without wrapping the whole sheet.
const WIDTHS: Record<(typeof DEAL_COLUMNS)[number], number> = {
  Acquirer: 26,
  Target: 26,
  Type: 10,
  Value: 14,
  'Value (raw)': 12,
  Currency: 14,
  'Stake %': 9,
  Category: 15,
  Region: 16,
  Announced: 13,
  Confidence: 12,
  Sources: 40,
  'Source count': 13,
  Credibility: 12,
  'Source URL': 60,
};

export async function renderXlsx(snapshot: Snapshot): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'FMCG Deal Radar';
  wb.created = new Date(snapshot.generatedAt);

  const ws = wb.addWorksheet('Deals', {
    views: [{ state: 'frozen', ySplit: 1 }],
  });

  ws.columns = DEAL_COLUMNS.map((name) => ({
    header: name,
    key: name,
    width: WIDTHS[name],
  }));

  for (const row of dealRows(snapshot)) ws.addRow(row);

  // Header styling — bold on a dark fill, so it reads as a header once frozen.
  const header = ws.getRow(1);
  header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  header.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF18181B' }, // zinc-900
  };
  header.alignment = { vertical: 'middle' };

  ws.getColumn('Credibility').numFmt = '0.00';
  ws.autoFilter = { from: 'A1', to: { row: 1, column: DEAL_COLUMNS.length } };

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}
