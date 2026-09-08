import pdfParse from 'pdf-parse';
import mammoth from 'mammoth';

export interface ExtractionOutput {
  text: string;
  wordCount: number;
  format: 'PDF' | 'DOCX' | 'TXT' | 'URL' | 'PASTE';
  warnings: string[];
}

export async function extractTextFromBuffer(
  buffer: Buffer,
  filename: string
): Promise<ExtractionOutput> {
  const extension = filename.split('.').pop()?.toLowerCase() || '';
  const warnings: string[] = [];

  let text = '';
  let format: ExtractionOutput['format'] = 'TXT';

  try {
    if (extension === 'pdf') {
      format = 'PDF';
      const pdfData = await pdfParse(buffer);
      text = pdfData.text || '';
    } else if (extension === 'docx' || extension === 'doc') {
      format = 'DOCX';
      const docxResult = await mammoth.extractRawText({ buffer });
      text = docxResult.value || '';
      if (docxResult.messages && docxResult.messages.length > 0) {
        docxResult.messages.forEach((msg) => {
          if (msg.type === 'warning') warnings.push(`DOCX Warning: ${msg.message}`);
        });
      }
    } else {
      format = 'TXT';
      text = buffer.toString('utf-8');
    }
  } catch (err: any) {
    warnings.push(`Extraction notice: ${err.message || 'Standard parser used fallback mode'}`);
    text = buffer.toString('utf-8');
  }

  // Clean and sanitize text
  const cleanText = text
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  const words = cleanText.split(/\s+/).filter(Boolean);
  const wordCount = words.length;

  if (wordCount < 200) {
    warnings.push('Job description is under 200 words. AI parsing accuracy improves with more detail.');
  }

  return {
    text: cleanText,
    wordCount,
    format,
    warnings,
  };
}

export function extractTextFromRawString(rawInput: string): ExtractionOutput {
  const warnings: string[] = [];
  const cleanText = rawInput
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  const wordCount = cleanText.split(/\s+/).filter(Boolean).length;

  if (wordCount < 200) {
    warnings.push('Job description is under 200 words. AI parsing accuracy improves with more detail.');
  }

  return {
    text: cleanText,
    wordCount,
    format: 'PASTE',
    warnings,
  };
}
