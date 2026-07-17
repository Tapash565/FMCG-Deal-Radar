/**
 * GET /api/export/{docx|xlsx|pptx|csv|json}
 *
 * Five renderers over one snapshot. Because every format reads the same loadSnapshot()
 * object the dashboard reads, no export can disagree with what's on screen — the whole
 * point of the snapshot-as-only-contract design (docs/architecture.md).
 *
 * Word is the hero (the deliverable is a newsletter); JSON is the raw self-describing
 * record; the rest are convenience surfaces over the same data.
 */

import { loadSnapshot } from '@/lib/snapshot';
import { renderDocx } from '@/lib/export/docx';
import { renderXlsx } from '@/lib/export/xlsx';
import { renderPptx } from '@/lib/export/pptx';
import { renderCsv } from '@/lib/export/csv';
import type { Snapshot } from '@/lib/types';

// These renderers use Node-native libraries (docx, exceljs, pptxgenjs) — keep them on the
// Node runtime, and never prerender: the body is a function of the live snapshot.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const OOXML = 'application/vnd.openxmlformats-officedocument';

interface Format {
  ext: string;
  contentType: string;
  /** Returns the response body: a byte buffer for binary formats, a string for text. */
  render: (snapshot: Snapshot) => Promise<Buffer> | Buffer | string;
}

const FORMATS: Record<string, Format> = {
  docx: {
    ext: 'docx',
    contentType: `${OOXML}.wordprocessingml.document`,
    render: (s) => renderDocx(s.newsletter),
  },
  xlsx: {
    ext: 'xlsx',
    contentType: `${OOXML}.spreadsheetml.sheet`,
    render: (s) => renderXlsx(s),
  },
  pptx: {
    ext: 'pptx',
    contentType: `${OOXML}.presentationml.presentation`,
    render: (s) => renderPptx(s.newsletter),
  },
  csv: {
    ext: 'csv',
    contentType: 'text/csv; charset=utf-8',
    render: (s) => renderCsv(s),
  },
  json: {
    ext: 'json',
    contentType: 'application/json; charset=utf-8',
    // The full snapshot — deals, clusters, funnel, newsletter — is the auditable record.
    render: (s) => JSON.stringify(s, null, 2),
  },
};

/** fmcg-deal-radar-2026-07-17.docx — dated by the snapshot, so the file names itself. */
function filename(snapshot: Snapshot, ext: string): string {
  const date = snapshot.generatedAt.slice(0, 10);
  return `fmcg-deal-radar-${date}.${ext}`;
}

export async function GET(_req: Request, ctx: { params: Promise<{ format: string }> }) {
  const { format } = await ctx.params;
  const spec = FORMATS[format.toLowerCase()];

  if (!spec) {
    return Response.json(
      { error: `Unknown export format "${format}". Try: ${Object.keys(FORMATS).join(', ')}.` },
      { status: 404 },
    );
  }

  try {
    // Inside the try on purpose: if loadSnapshot throws (seed unreadable, a Blob read that
    // slips past its own guard), the error must become a JSON 500 — not escape the handler
    // and let the platform render an HTML error page, which a JSON/download client can't use.
    const { snapshot } = await loadSnapshot();
    const body = await spec.render(snapshot);
    // A Node Buffer isn't a DOM BodyInit; a Uint8Array view over it is. Strings pass through.
    const responseBody: BodyInit = typeof body === 'string' ? body : new Uint8Array(body);
    return new Response(responseBody, {
      status: 200,
      headers: {
        'Content-Type': spec.contentType,
        'Content-Disposition': `attachment; filename="${filename(snapshot, spec.ext)}"`,
        // A snapshot is immutable once written; an export of it is safe to cache briefly.
        'Cache-Control': 'no-cache',
      },
    });
  } catch (err) {
    console.error(`Export failed for format "${format}":`, err);
    return Response.json({ error: 'Export generation failed.' }, { status: 500 });
  }
}
