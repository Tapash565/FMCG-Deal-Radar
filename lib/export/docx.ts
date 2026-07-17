/**
 * DOCX — the hero deliverable.
 *
 * The artifact the assignment asks for is *a newsletter*, and a newsletter's native form
 * is a document someone forwards, not a table or a deck. So this renders the same
 * Newsletter object the dashboard previews, one-to-one: what you see in the preview is
 * what lands in the .docx. The methodology footer travels inside the document, because
 * the newsletter has to explain itself to a reader who never saw the repo.
 *
 * Prose is not invented here. Every string comes from the snapshot's newsletter, which
 * stage 8 wrote over facts stages 4–7 had already locked. This file is layout only.
 */

import {
  AlignmentType,
  Document,
  ExternalHyperlink,
  HeadingLevel,
  Packer,
  Paragraph,
  TextRun,
} from 'docx';
import type { Newsletter, NewsletterItem } from '../types';

const ACCENT = '1d4ed8'; // blue-700 — links and the "Why it matters" lead-in
const MUTED = '71717a'; // zinc-500 — period line, methodology footer
const BADGE_COLOR: Record<string, string> = {
  High: '047857', // emerald-700
  Med: 'b45309', // amber-700
  Low: '52525b', // zinc-600
};

function badgeRun(badge: string): TextRun {
  return new TextRun({
    text: `  [${badge}]`,
    bold: true,
    size: 16, // 8pt — smaller than the headline it trails
    color: BADGE_COLOR[badge] ?? MUTED,
  });
}

function itemParagraphs(item: NewsletterItem): Paragraph[] {
  const out: Paragraph[] = [
    new Paragraph({
      spacing: { before: 200, after: 40 },
      children: [
        new TextRun({ text: item.headline, bold: true, size: 24 }), // 12pt
        badgeRun(item.badge),
      ],
    }),
    new Paragraph({
      spacing: { after: 40 },
      children: [new TextRun({ text: item.summary, size: 22 })], // 11pt
    }),
  ];

  if (item.whyItMatters) {
    out.push(
      new Paragraph({
        spacing: { after: 40 },
        children: [
          new TextRun({ text: 'Why it matters: ', bold: true, size: 22, color: ACCENT }),
          new TextRun({ text: item.whyItMatters, size: 22 }),
        ],
      }),
    );
  }

  if (item.primarySourceUrl) {
    out.push(
      new Paragraph({
        spacing: { after: 120 },
        children: [
          new ExternalHyperlink({
            link: item.primarySourceUrl,
            children: [
              new TextRun({ text: 'Source', style: 'Hyperlink', size: 18, color: ACCENT }),
            ],
          }),
        ],
      }),
    );
  }

  return out;
}

function newsletterParagraphs(nl: Newsletter): Paragraph[] {
  const body: Paragraph[] = [
    new Paragraph({ text: nl.title, heading: HeadingLevel.TITLE }),
    new Paragraph({
      spacing: { after: 240 },
      children: [new TextRun({ text: nl.period, italics: true, size: 20, color: MUTED })],
    }),
  ];

  if (nl.tldr.length > 0) {
    body.push(new Paragraph({ text: 'TL;DR', heading: HeadingLevel.HEADING_2 }));
    for (const bullet of nl.tldr) {
      body.push(
        new Paragraph({
          bullet: { level: 0 },
          spacing: { after: 40 },
          children: [new TextRun({ text: bullet, size: 22 })],
        }),
      );
    }
  }

  // Sections in snapshot order — stages 4–7 grouped and ranked; we only lay out.
  for (const section of nl.sections) {
    if (section.items.length === 0) continue;
    body.push(
      new Paragraph({
        text: section.category,
        heading: HeadingLevel.HEADING_2,
        spacing: { before: 320 },
      }),
    );
    for (const item of section.items) body.push(...itemParagraphs(item));
  }

  // The methodology footer ships inside the document, set apart by a rule.
  body.push(
    new Paragraph({
      thematicBreak: true,
      spacing: { before: 400, after: 80 },
      children: [],
    }),
    new Paragraph({
      alignment: AlignmentType.LEFT,
      children: [new TextRun({ text: nl.methodology, size: 16, color: MUTED, italics: true })],
    }),
  );

  return body;
}

/** Render the newsletter to a .docx byte buffer. */
export function renderDocx(newsletter: Newsletter): Promise<Buffer> {
  const doc = new Document({
    creator: 'FMCG Deal Radar',
    title: newsletter.title,
    description: newsletter.period,
    sections: [{ children: newsletterParagraphs(newsletter) }],
  });
  return Packer.toBuffer(doc);
}
