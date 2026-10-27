import type { Resume } from "@jobbuddy/shared";
import { Document, Packer, Paragraph, TabStopType, TextRun } from "docx";
import { PDFDocument, StandardFonts, rgb, type PDFFont } from "pdf-lib";
import { cvBlocks } from "./layout";

// Renders the CV as PDF (pdf-lib, standard fonts, no files needed on the server) and Word
// (docx). Both behind these two functions so the renderer can be swapped.

// ---------------------------------------------------------------- PDF

// The standard PDF fonts only cover Western European letters. Others are spelled without
// accents ("ł" -> "l") in the PDF; the Word file keeps every character.
const EXTRA: Record<string, string> = {
  ł: "l", Ł: "L", đ: "d", Đ: "D", ø: "o", Ø: "O", ß: "ss", æ: "ae", Æ: "AE", œ: "oe", Œ: "OE",
  "\u2013": "-", "\u2014": "-", "\u2018": "'", "\u2019": "'", "\u201c": '"', "\u201d": '"',
  "\u2022": "-", "\u2026": "...", "\u00a0": " ",
}; // prettier-ignore

function pdfSafe(text: string, font: PDFFont): string {
  let out = "";
  for (const ch of text) {
    const candidates = [ch, EXTRA[ch], ch.normalize("NFD").replace(/[\u0300-\u036f]/g, "")];
    const ok = candidates.find((c) => {
      if (!c) return false;
      try {
        font.encodeText(c);
        return true;
      } catch {
        return false;
      }
    });
    out += ok ?? "?";
  }
  return out;
}

export async function renderPdf(resume: Resume): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`${resume.basics.name} CV`);
  doc.setAuthor(resume.basics.name);
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  const [W, H] = [595.28, 841.89]; // A4
  const margin = 50;
  const width = W - margin * 2;
  let page = doc.addPage([W, H]);
  let y = H - margin;
  const ink = rgb(0.1, 0.1, 0.1);
  const grey = rgb(0.35, 0.35, 0.35);

  const ensure = (needed: number) => {
    if (y - needed < margin) {
      page = doc.addPage([W, H]);
      y = H - margin;
    }
  };

  const wrap = (text: string, font: PDFFont, size: number, max: number) => {
    const lines: string[] = [];
    let line = "";
    for (const word of text.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(next, size) <= max || !line) line = next;
      else {
        lines.push(line);
        line = word;
      }
    }
    if (line) lines.push(line);
    return lines;
  };

  const write = (
    text: string,
    font: PDFFont,
    size: number,
    opts: { indent?: number; color?: typeof ink; gap?: number } = {},
  ) => {
    const indent = opts.indent ?? 0;
    for (const line of wrap(pdfSafe(text, font), font, size, width - indent)) {
      ensure(size + 3);
      y -= size + 3;
      page.drawText(line, { x: margin + indent, y, size, font, color: opts.color ?? ink });
    }
    y -= opts.gap ?? 0;
  };

  for (const block of cvBlocks(resume)) {
    switch (block.kind) {
      case "name":
        write(block.text, bold, 20, { gap: 2 });
        break;
      case "contact":
        write(block.text, regular, 9.5, { color: grey, gap: 4 });
        break;
      case "section":
        ensure(40);
        y -= 10;
        write(block.text.toUpperCase(), bold, 11, { gap: 3 });
        page.drawLine({
          start: { x: margin, y },
          end: { x: W - margin, y },
          thickness: 0.6,
          color: grey,
        });
        y -= 4;
        break;
      case "entry": {
        ensure(30);
        y -= 4;
        const right = block.right ? pdfSafe(block.right, regular) : "";
        const rightWidth = right ? regular.widthOfTextAtSize(right, 10) : 0;
        const title = wrap(pdfSafe(block.title, bold), bold, 10.5, width - rightWidth - 12);
        title.forEach((line, i) => {
          ensure(14);
          y -= 13.5;
          page.drawText(line, { x: margin, y, size: 10.5, font: bold, color: ink });
          if (i === 0 && right)
            page.drawText(right, {
              x: W - margin - rightWidth,
              y,
              size: 10,
              font: regular,
              color: grey,
            });
        });
        if (block.sub) write(block.sub, regular, 9.5, { color: grey });
        y -= 1;
        break;
      }
      case "paragraph":
        write(block.text, regular, 10, { gap: 2 });
        break;
      case "bullet": {
        ensure(13);
        page.drawText("-", { x: margin + 4, y: y - 13, size: 10, font: regular, color: ink });
        write(block.text, regular, 10, { indent: 14, gap: 1 });
        break;
      }
    }
  }
  return doc.save();
}

// ---------------------------------------------------------------- Word

export async function renderDocx(resume: Resume): Promise<Uint8Array> {
  const font = "Calibri";
  const children: Paragraph[] = [];
  // Right-aligned dates on the same line, through a tab stop (A4 width minus margins, in twips).
  const rightTab = [{ type: TabStopType.RIGHT, position: 9638 }];

  for (const block of cvBlocks(resume)) {
    switch (block.kind) {
      case "name":
        children.push(
          new Paragraph({
            children: [new TextRun({ text: block.text, bold: true, size: 40, font })],
          }),
        );
        break;
      case "contact":
        children.push(
          new Paragraph({
            spacing: { after: 120 },
            children: [new TextRun({ text: block.text, size: 19, font, color: "555555" })],
          }),
        );
        break;
      case "section":
        children.push(
          new Paragraph({
            spacing: { before: 240, after: 80 },
            border: { bottom: { style: "single", size: 6, color: "888888", space: 2 } },
            children: [new TextRun({ text: block.text.toUpperCase(), bold: true, size: 22, font })],
          }),
        );
        break;
      case "entry":
        children.push(
          new Paragraph({
            spacing: { before: 100 },
            tabStops: rightTab,
            children: [
              new TextRun({ text: block.title, bold: true, size: 21, font }),
              ...(block.right
                ? [new TextRun({ text: `\t${block.right}`, size: 20, font, color: "555555" })]
                : []),
            ],
          }),
        );
        if (block.sub)
          children.push(
            new Paragraph({
              children: [new TextRun({ text: block.sub, size: 19, font, color: "555555" })],
            }),
          );
        break;
      case "paragraph":
        children.push(
          new Paragraph({
            spacing: { after: 60 },
            children: [new TextRun({ text: block.text, size: 20, font })],
          }),
        );
        break;
      case "bullet":
        children.push(
          new Paragraph({
            bullet: { level: 0 },
            children: [new TextRun({ text: block.text, size: 20, font })],
          }),
        );
        break;
    }
  }

  const doc = new Document({
    creator: resume.basics.name,
    title: `${resume.basics.name} CV`,
    sections: [
      {
        properties: {
          page: {
            size: { width: 11906, height: 16838 },
            margin: { top: 1000, bottom: 1000, left: 1134, right: 1134 },
          },
        },
        children,
      },
    ],
  });
  return new Uint8Array(await Packer.toBuffer(doc));
}
