import { useRef, useState, type DragEvent, type ReactNode } from 'react';

interface FileDropZoneProps {
  onFile: (file: File) => void;
  accept?: string;
  label?: string;
  hint?: string;
  icon?: ReactNode;
  className?: string;
}

export function FileDropZone({
  onFile,
  accept = '.mid,.midi',
  label = 'Drop a MIDI file here',
  hint,
  icon,
  className,
}: FileDropZoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [active, setActive] = useState(false);

  function handleDrop(e: DragEvent<HTMLButtonElement>) {
    e.preventDefault();
    setActive(false);
    const file = e.dataTransfer.files[0];
    if (file) onFile(file);
  }

  return (
    <button
      type="button"
      className={`drop-zone${active ? ' drop-zone--active' : ''}${className ? ` ${className}` : ''}`}
      onClick={() => inputRef.current?.click()}
      onDragOver={(e) => {
        e.preventDefault();
        setActive(true);
      }}
      onDragLeave={() => setActive(false)}
      onDrop={handleDrop}
    >
      {icon && <span className="drop-zone__icon">{icon}</span>}
      <strong>{label}</strong>
      <div>{hint ?? 'or click to browse — .mid / .midi'}</div>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        aria-hidden
        tabIndex={-1}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onFile(file);
          e.target.value = '';
        }}
      />
    </button>
  );
}
