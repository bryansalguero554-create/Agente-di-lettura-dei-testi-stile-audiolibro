// Genera un documento Word di prova con titolo, capitoli, dialoghi, elenco e tabella.
import { Document, Packer, Paragraph, HeadingLevel, TextRun, Table, TableRow, TableCell } from 'docx';

export async function makeDocx() {
  const doc = new Document({
    title: 'Il faro di Levante',
    creator: 'Giulia Verdi',
    sections: [{
      children: [
        new Paragraph({ text: 'Il faro di Levante', heading: HeadingLevel.TITLE }),
        new Paragraph({ text: 'Capitolo 1', heading: HeadingLevel.HEADING_1 }),
        new Paragraph({ children: [new TextRun('Il Sig. Bianchi arrivò al faro il 12/03/1924 alle 18:30. Il vento soffiava forte.')] }),
        new Paragraph({ children: [new TextRun('«Chi va là?» gridò il guardiano. «Sono io, il nuovo assistente.»')] }),
        new Paragraph({ text: 'Primo punto della lista', bullet: { level: 0 } }),
        new Table({ rows: [new TableRow({ children: [new TableCell({ children: [new Paragraph('Ora')] }), new TableCell({ children: [new Paragraph('Evento')] })] })] }),
        new Paragraph({ text: 'Capitolo 2', heading: HeadingLevel.HEADING_1 }),
        new Paragraph({ children: [new TextRun({ text: 'La notte passò in silenzio', bold: true }), new TextRun('. Al mattino il mare era calmo.')] }),
      ],
    }],
  });
  return Packer.toBuffer(doc);
}
