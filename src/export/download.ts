const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** Saves bytes as a file through the browser's normal download. Nothing leaves the device. */
export function downloadBytes(data: Uint8Array, name: string, type = XLSX) {
  const blob = new Blob([data as BlobPart], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** A file name without characters Windows refuses. */
export const safeFileName = (name: string) => name.replace(/[<>:"/\\|?*]+/g, '-').trim() || 'export';
