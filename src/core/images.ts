/** Browser image helpers used by the guided icon creator. */

export function fileDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error(`Could not read ${file.name}.`));
    reader.readAsDataURL(file);
  });
}

export function imageFromUrl(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('The glyph artwork could not be decoded.'));
    image.src = src;
  });
}

/** Load an SVG and apply a family glyph colour without changing its geometry. */
export async function exactGlyph(source: string, color: string): Promise<HTMLImageElement> {
  if (!source.toLowerCase().includes('.svg') && !source.startsWith('data:image/svg')) {
    return imageFromUrl(source);
  }
  const svg = source.startsWith('data:')
    ? decodeURIComponent(source.slice(source.indexOf(',') + 1))
    : await fetch(source).then((response) => {
        if (!response.ok) throw new Error('Could not load the selected SVG.');
        return response.text();
      });
  const coloured = svg.replace(/<svg\b/, `<svg fill="${color}"`);
  return imageFromUrl(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(coloured)}`);
}

export async function sourceReference(source: string): Promise<string> {
  if (source.startsWith('data:')) return source;
  const blob = await fetch(source).then((response) => {
    if (!response.ok) throw new Error('Could not load the selected glyph source.');
    return response.blob();
  });
  return fileDataUrl(new File([blob], 'glyph', { type: blob.type }));
}

export function imageSourceDataUrl(image: CanvasImageSource): string {
  const width = (image as HTMLImageElement).naturalWidth || (image as HTMLCanvasElement).width || 1024;
  const height = (image as HTMLImageElement).naturalHeight || (image as HTMLCanvasElement).height || 1024;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.getContext('2d')?.drawImage(image, 0, 0, width, height);
  return canvas.toDataURL('image/png');
}
