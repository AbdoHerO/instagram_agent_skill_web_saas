'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { buttonClass } from '@/components/ui';

/**
 * Uploads to /api/drafts/<id>/media with a progress bar (a Reel can be tens of
 * MB). Files above the limit are refused here, before anything is sent.
 */
export function MediaUpload({ draftId, kind, maxBytes }: { draftId: string; kind: string; maxBytes: number }) {
  const router = useRouter();
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const limitMb = Math.floor(maxBytes / 1024 / 1024);

  function upload(file: File) {
    setError(null);
    setMessage(null);
    if (file.size > maxBytes) {
      setError(`${file.name} is ${Math.round(file.size / 1024 / 1024)} MB: the limit is ${limitMb} MB.`);
      return;
    }
    const data = new FormData();
    data.append('file', file);
    const request = new XMLHttpRequest();
    request.open('POST', `/api/drafts/${draftId}/media`);
    request.responseType = 'json';
    request.upload.onprogress = (event) => { if (event.lengthComputable) setProgress(Math.round((event.loaded / event.total) * 100)); };
    request.onload = () => {
      setProgress(null);
      const body = (request.response ?? {}) as { ok?: boolean; error?: string; message?: string };
      if (request.status === 200 && body.ok) {
        setMessage(body.message ?? 'Media attached.');
        router.refresh();
      } else {
        setError(body.error ?? `The upload was refused (HTTP ${request.status}).`);
      }
    };
    request.onerror = () => { setProgress(null); setError('The upload did not reach the server. Check the connection and try again.'); };
    setProgress(0);
    request.send(data);
  }

  return (
    <form
      className="space-y-2"
      onSubmit={(event) => {
        event.preventDefault();
        const file = new FormData(event.currentTarget).get('file');
        if (file instanceof File && file.size > 0) upload(file);
        else setError('Choose a file first.');
      }}
    >
      <input type="file" name="file" accept={kind === 'reel' ? 'video/mp4' : 'image/jpeg'} className="block w-full text-sm" />
      <p className="text-xs text-muted">{kind === 'reel' ? 'MP4 video' : 'JPEG image'}, up to {limitMb} MB · attaching creates a new version (re-approval needed).</p>
      <button type="submit" disabled={progress !== null} className={buttonClass('secondary')} aria-busy={progress !== null || undefined}>
        {progress === null ? 'Upload and attach' : `Uploading… ${progress} %`}
      </button>
      {error ? <p role="alert" className="text-sm text-danger">{error}</p> : null}
      {message ? <p role="status" className="text-sm text-success">{message}</p> : null}
    </form>
  );
}
