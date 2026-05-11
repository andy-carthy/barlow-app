import { useState, useRef } from 'react';
import { extractRules } from '../api/anthropic';

// PDF files are read with FileReader.readAsText() for MVP.
// This works for text-layer PDFs exported from Word/Acrobat but will produce
// garbled output for scanned/image-based PDFs. A proper implementation would
// use pdf.js to extract text before sending to Claude.

export default function IndenturUpload({ onExtracted }) {
  const [file, setFile]       = useState(null);
  const [status, setStatus]   = useState('idle');   // idle | ready | loading | error
  const [error, setError]     = useState(null);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef(null);

  function acceptFile(selected) {
    if (!selected) return;
    setFile(selected);
    setStatus('ready');
    setError(null);
  }

  function handleInputChange(e) {
    acceptFile(e.target.files[0]);
  }

  function handleDrop(e) {
    e.preventDefault();
    setDragging(false);
    acceptFile(e.dataTransfer.files[0]);
  }

  function handleDragOver(e) {
    e.preventDefault();
    setDragging(true);
  }

  function handleDragLeave() {
    setDragging(false);
  }

  async function handleExtract() {
    if (!file) return;
    setStatus('loading');
    setError(null);

    try {
      const text = await readFileAsText(file);
      const rules = await extractRules(text);
      onExtracted(rules);
    } catch (e) {
      setError(e.message);
      setStatus('error');
    }
  }

  function reset() {
    setFile(null);
    setStatus('idle');
    setError(null);
    if (inputRef.current) inputRef.current.value = '';
  }

  const isLoading = status === 'loading';

  return (
    <div style={s.outer}>
      {/* Upload zone — hidden once a file is confirmed */}
      {status === 'idle' && (
        <div
          style={{ ...s.zone, ...(dragging ? s.zoneDragging : {}) }}
          onClick={() => inputRef.current?.click()}
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
        >
          <input
            ref={inputRef}
            type="file"
            accept=".txt,.pdf"
            style={{ display: 'none' }}
            onChange={handleInputChange}
          />
          <div style={s.uploadIcon}>
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
          </div>
          <p style={s.zoneLabel}>Drop an indenture file here or <span style={s.browse}>browse</span></p>
          <p style={s.zoneHint}>Accepts .txt · .pdf</p>
        </div>
      )}

      {/* File confirmed — ready to extract */}
      {(status === 'ready' || status === 'error') && (
        <div style={s.confirmed}>
          <div style={s.fileRow}>
            <FileIcon ext={file?.name?.split('.').pop()} />
            <div style={s.fileMeta}>
              <span style={s.fileName}>{file?.name}</span>
              <span style={s.fileSize}>{formatBytes(file?.size)}</span>
            </div>
            <button style={s.changeBtn} onClick={reset} title="Choose a different file">
              Change
            </button>
          </div>

          {error && (
            <div style={s.errorBox}>
              <strong>Extraction failed:</strong> {error}
            </div>
          )}

          <button style={s.extractBtn} onClick={handleExtract}>
            Extract Rules →
          </button>
        </div>
      )}

      {/* Loading state */}
      {isLoading && (
        <div style={s.loadingBox}>
          <Spinner />
          <div style={s.loadingText}>
            <p style={s.loadingPrimary}>Extracting rules...</p>
            <p style={s.loadingSecondary}>Sending <strong>{file?.name}</strong> to Claude for structured extraction</p>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = (e) => resolve(e.target.result);
    reader.onerror = ()  => reject(new Error(`Could not read ${file.name}`));
    reader.readAsText(file);
  });
}

function formatBytes(bytes) {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function FileIcon({ ext }) {
  return (
    <div style={s.fileIcon}>
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <polyline points="14 2 14 8 20 8" />
      </svg>
      <span style={s.fileExt}>{(ext || 'txt').toUpperCase()}</span>
    </div>
  );
}

function Spinner() {
  return <div style={s.spinner} />;
}

// ── Styles ───────────────────────────────────────────────────────────────────

const s = {
  outer: {
    display: 'flex',
    flexDirection: 'column',
    gap: 0,
  },
  zone: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    padding: '48px 32px',
    border: '2px dashed var(--color-border)',
    borderRadius: 10,
    cursor: 'pointer',
    transition: 'border-color 0.15s, background 0.15s',
    background: 'var(--color-bg)',
    userSelect: 'none',
  },
  zoneDragging: {
    borderColor: 'var(--color-dusty-blue)',
    background: '#eef2f6',
  },
  uploadIcon: {
    opacity: 0.6,
  },
  zoneLabel: {
    margin: 0,
    fontSize: 15,
    color: 'var(--color-text-primary)',
  },
  browse: {
    color: 'var(--color-dusty-blue)',
    textDecoration: 'underline',
    cursor: 'pointer',
  },
  zoneHint: {
    margin: 0,
    fontSize: 12,
    color: 'var(--color-text-muted)',
    letterSpacing: '0.03em',
  },
  confirmed: {
    display: 'flex',
    flexDirection: 'column',
    gap: 14,
    padding: '20px 24px',
    border: '1px solid var(--color-border)',
    borderRadius: 10,
    background: 'var(--color-surface)',
  },
  fileRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 14,
  },
  fileIcon: {
    width: 44,
    height: 52,
    background: 'var(--color-bg)',
    borderRadius: 6,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    color: 'var(--color-text-muted)',
    flexShrink: 0,
  },
  fileExt: {
    fontSize: 9,
    fontWeight: 700,
    letterSpacing: '0.05em',
    color: 'var(--color-text-muted)',
  },
  fileMeta: {
    display: 'flex',
    flexDirection: 'column',
    gap: 3,
    flex: 1,
    minWidth: 0,
  },
  fileName: {
    fontSize: 15,
    fontWeight: 600,
    color: 'var(--color-text-primary)',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  fileSize: {
    fontSize: 12,
    color: 'var(--color-text-muted)',
  },
  changeBtn: {
    background: 'none',
    border: 'none',
    color: 'var(--color-text-muted)',
    fontSize: 13,
    cursor: 'pointer',
    textDecoration: 'underline',
    padding: '4px 0',
    flexShrink: 0,
  },
  errorBox: {
    background: 'var(--color-fail-tint)',
    border: '1px solid var(--color-fail-border)',
    borderRadius: 6,
    padding: '10px 14px',
    fontSize: 13,
    color: 'var(--color-fail)',
  },
  extractBtn: {
    alignSelf: 'flex-end',
    padding: '9px 22px',
    background: 'var(--color-text-primary)',
    color: 'var(--color-surface)',
    border: 'none',
    borderRadius: 6,
    cursor: 'pointer',
    fontWeight: 600,
    fontSize: 14,
  },
  loadingBox: {
    display: 'flex',
    alignItems: 'center',
    gap: 20,
    padding: '32px 28px',
    border: '1px solid var(--color-border)',
    borderRadius: 10,
    background: 'var(--color-surface)',
  },
  spinner: {
    width: 28,
    height: 28,
    borderRadius: '50%',
    border: '3px solid var(--color-border)',
    borderTopColor: 'var(--color-text-primary)',
    animation: 'spin 0.75s linear infinite',
    flexShrink: 0,
  },
  loadingText: {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
  },
  loadingPrimary: {
    margin: 0,
    fontSize: 15,
    fontWeight: 600,
    color: 'var(--color-text-primary)',
  },
  loadingSecondary: {
    margin: 0,
    fontSize: 13,
    color: 'var(--color-text-muted)',
  },
};
