'use client';

import React, { useRef, useState } from 'react';
import { Upload, FileText } from 'lucide-react';

interface FileUploadZoneProps {
  /**
   * Parses the JD (file or pasted text). The page owns the request so it can
   * drive the processing overlay from the streamed stage events; a rejected
   * promise is shown here as the error message.
   */
  onSubmit: (input: { file?: File; text?: string }) => Promise<void>;
  isLoading: boolean;
}

export function FileUploadZone({ onSubmit, isLoading }: FileUploadZoneProps) {
  const [tab, setTab] = useState<'upload' | 'paste'>('upload');
  const [pasteText, setPasteText] = useState('');
  const [dragActive, setDragActive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const submit = async (input: { file?: File; text?: string }) => {
    if (isLoading) return;
    setError(null);
    try {
      await onSubmit(input);
    } catch (err: any) {
      setError(err?.message || 'The job description could not be parsed.');
    }
  };

  const onDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') setDragActive(true);
    else if (e.type === 'dragleave') setDragActive(false);
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    const file = e.dataTransfer.files?.[0];
    if (file) void submit({ file });
  };

  const wordCount = pasteText.trim().split(/\s+/).filter(Boolean).length;

  return (
    <section className="card">
      <div className="px-5 py-4 border-b border-hairline flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-label-sm text-ink">Job description</h2>
          <p className="text-body-sm text-mute mt-0.5">PDF, DOCX or TXT up to 10 MB, or pasted text. Only what the document says is extracted.</p>
        </div>
        <div className="seg" role="tablist" aria-label="Input method">
          <button type="button" role="tab" aria-selected={tab === 'upload'} aria-pressed={tab === 'upload'} onClick={() => setTab('upload')} className="seg-item">
            <Upload className="w-3.5 h-3.5" /> Upload file
          </button>
          <button type="button" role="tab" aria-selected={tab === 'paste'} aria-pressed={tab === 'paste'} onClick={() => setTab('paste')} className="seg-item">
            <FileText className="w-3.5 h-3.5" /> Paste text
          </button>
        </div>
      </div>

      <div className="p-5 flex flex-col gap-4">
        {error && <div className="px-3 py-2 rounded-sm bg-error-soft text-body-sm text-error-deep">{error}</div>}

        {tab === 'upload' ? (
          <div
            onDragEnter={onDrag}
            onDragOver={onDrag}
            onDragLeave={onDrag}
            onDrop={onDrop}
            onClick={() => fileInputRef.current?.click()}
            onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && fileInputRef.current?.click()}
            role="button"
            tabIndex={0}
            className={`rounded-md border border-dashed px-6 py-12 text-center cursor-pointer transition-colors flex flex-col items-center gap-3 ${
              dragActive ? 'border-ink bg-hairline-soft' : 'border-hairline hover:border-faint bg-canvas'
            }`}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.docx,.doc,.txt"
              onChange={(e) => e.target.files?.[0] && void submit({ file: e.target.files[0] })}
              className="hidden"
            />
            <span className="w-10 h-10 rounded-sm bg-elevated border border-hairline flex items-center justify-center text-body">
              <Upload className="w-4 h-4" strokeWidth={1.75} />
            </span>
            <div>
              <p className="text-body-md font-medium text-ink">Drop the job description here</p>
              <p className="text-body-sm text-mute mt-0.5">or click to browse your files</p>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <div className="relative">
              <textarea
                rows={10}
                value={pasteText}
                onChange={(e) => setPasteText(e.target.value)}
                placeholder="Paste the job description: title, responsibilities, required skills, location, experience…"
                className="textarea"
              />
              <span className={`absolute bottom-2.5 right-2.5 chip tabular-nums ${wordCount > 0 && wordCount < 200 ? 'text-warning-deep' : ''}`}>
                {wordCount} words
              </span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <p className="text-body-xs text-mute">{wordCount > 0 && wordCount < 200 ? 'Under 200 words: you can proceed, but more requirements give better queries.' : 'Aim for 200+ words for the best constraint extraction.'}</p>
              <button type="button" onClick={() => void submit({ text: pasteText })} disabled={isLoading || !pasteText.trim()} className="btn-primary">
                Analyse job description
              </button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
