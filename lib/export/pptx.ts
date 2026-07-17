/**
 * PPTX — the same intelligence as a deck: a title slide, the TL;DR, then one slide per
 * category with its deals. For the reader who has to *present* the digest in a Monday
 * review rather than forward it.
 *
 * Like the other exports this is layout over the snapshot's newsletter — the model wrote
 * the prose, stages 4–7 chose and grouped the deals, and this file only places them.
 */

import PptxGenJS from 'pptxgenjs';
import type { Newsletter, NewsletterItem } from '../types';

const INK = '18181B'; // zinc-900
const MUTED = '71717A'; // zinc-500
const ACCENT = '1D4ED8'; // blue-700
const BADGE_COLOR: Record<string, string> = {
  High: '047857',
  Med: 'B45309',
  Low: '52525B',
};

/** A deal rendered as a titled block of rich-text runs on the category slide. */
function itemRuns(item: NewsletterItem): PptxGenJS.TextProps[] {
  const runs: PptxGenJS.TextProps[] = [
    { text: item.headline, options: { bold: true, fontSize: 15, color: INK, breakLine: false } },
    {
      text: `  [${item.badge}]`,
      options: { bold: true, fontSize: 11, color: BADGE_COLOR[item.badge] ?? MUTED, breakLine: true },
    },
    { text: item.summary, options: { fontSize: 12, color: INK, breakLine: true } },
  ];
  if (item.whyItMatters) {
    runs.push({
      text: `Why it matters: ${item.whyItMatters}`,
      options: { fontSize: 11, italic: true, color: MUTED, breakLine: true },
    });
  }
  // Trailing spacer so consecutive deals don't collide.
  runs.push({ text: '', options: { fontSize: 6, breakLine: true } });
  return runs;
}

export async function renderPptx(newsletter: Newsletter): Promise<Buffer> {
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE'; // 13.3 x 7.5 in
  pptx.author = 'FMCG Deal Radar';
  pptx.title = newsletter.title;

  // Title slide.
  const title = pptx.addSlide();
  title.background = { color: 'FFFFFF' };
  title.addText(newsletter.title, {
    x: 0.6,
    y: 2.4,
    w: 12.1,
    h: 1.0,
    fontSize: 40,
    bold: true,
    color: INK,
  });
  title.addText(newsletter.period, {
    x: 0.6,
    y: 3.5,
    w: 12.1,
    h: 0.5,
    fontSize: 18,
    color: MUTED,
  });

  // TL;DR slide — the "if you read nothing else" layer.
  if (newsletter.tldr.length > 0) {
    const tldr = pptx.addSlide();
    tldr.addText('TL;DR', { x: 0.6, y: 0.4, w: 12.1, h: 0.7, fontSize: 26, bold: true, color: INK });
    tldr.addText(
      newsletter.tldr.map((t) => ({
        text: t,
        options: { fontSize: 16, color: INK, bullet: { characterCode: '2022' }, breakLine: true },
      })),
      { x: 0.7, y: 1.3, w: 11.9, h: 5.6, valign: 'top', paraSpaceAfter: 10 },
    );
  }

  // One slide per non-empty category, in snapshot (ranked) order.
  for (const section of newsletter.sections) {
    if (section.items.length === 0) continue;
    const slide = pptx.addSlide();
    slide.addText(section.category, {
      x: 0.6,
      y: 0.4,
      w: 12.1,
      h: 0.7,
      fontSize: 24,
      bold: true,
      color: ACCENT,
    });
    slide.addText(
      section.items.flatMap(itemRuns),
      { x: 0.6, y: 1.25, w: 12.1, h: 5.9, valign: 'top' },
    );
  }

  // Methodology on its own closing slide — the deck must explain itself too.
  const method = pptx.addSlide();
  method.addText('Methodology', {
    x: 0.6,
    y: 0.4,
    w: 12.1,
    h: 0.7,
    fontSize: 22,
    bold: true,
    color: INK,
  });
  method.addText(newsletter.methodology, {
    x: 0.6,
    y: 1.3,
    w: 12.1,
    h: 5.6,
    fontSize: 14,
    color: MUTED,
    valign: 'top',
  });

  // 'nodebuffer' yields a Node Buffer we can hand straight to a Response.
  const out = (await pptx.write({ outputType: 'nodebuffer' })) as Buffer;
  return out;
}
