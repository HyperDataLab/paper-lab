export function download(name: string, bytes: Uint8Array, type: string) {
  const url = URL.createObjectURL(new Blob([new Uint8Array(bytes).buffer], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
