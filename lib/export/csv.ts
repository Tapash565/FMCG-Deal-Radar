/**
 * CSV — the raw deal table, for a spreadsheet or a quick grep. Same rows as the XLSX
 * export (lib/export/rows.ts), so the two can't disagree; the difference is only the
 * container.
 *
 * Papaparse handles the quoting, so a company name with a comma or a source list with a
 * semicolon survives the round-trip intact.
 */

import Papa from 'papaparse';
import { DEAL_COLUMNS, dealRows } from './rows';
import type { Snapshot } from '../types';

export function renderCsv(snapshot: Snapshot): string {
  return Papa.unparse(dealRows(snapshot), { columns: DEAL_COLUMNS as unknown as string[] });
}
