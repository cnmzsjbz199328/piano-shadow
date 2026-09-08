import { useRef } from 'react';
import { useAppStore } from '@/stores/useAppStore';

export function ImportMidiButton() {
  const inputRef = useRef<HTMLInputElement>(null);
  const importMidiFile = useAppStore((s) => s.importMidiFile);
  return (
    <>
      <button type="button" className="btn btn--quiet btn--sm" onClick={() => inputRef.current?.click()}>Import MIDI</button>
      <input ref={inputRef} type="file" accept=".mid,.midi" hidden onChange={(e) => {
        const file = e.target.files?.[0];
        if (file) void file.arrayBuffer().then((bytes) => importMidiFile(bytes, file.name.replace(/\.(mid|midi)$/i, '')));
        e.target.value = '';
      }} />
    </>
  );
}
