import { generate, resumeGeneration } from './replicate';
import { canvasToBlob } from './export';

export const SHEET_MODEL = 'openai/gpt-image-2';
export interface SheetRequest {
  names: string[];
  style: string;
  quality: 'low' | 'medium' | 'high';
  reference?: string;
}
export interface SheetResult {
  request: SheetRequest;
  predictionId: string;
  png: Blob;
  width: number;
  height: number;
  transparentFraction: number;
}
export const parseSheetNames = (value: string) => value.split(/\r?\n/).map(s => s.trim()).filter(Boolean);

export function sheetLayout(count: number) {
  if (!Number.isInteger(count) || count < 10 || count > 20) {
    throw new Error('Enter 10–20 icon subjects, one per line.');
  }
  return { columns: 5, rows: Math.ceil(count / 5) };
}

export function sheetInput(request: SheetRequest): Record<string, unknown> {
  const { columns, rows } = sheetLayout(request.names.length);
  if (request.names.some(name => !name.trim() || name.length > 200)) throw new Error('Each subject must be 1–200 characters.');
  if (!request.style.trim() || request.style.length > 4000) throw new Error('Describe the icon style in 1–4000 characters.');
  return {
    prompt: [
      `Create ONE icon sheet with exactly ${request.names.length} separate icons in a ${columns}-column by ${rows}-row uniform grid.`,
      'Read cells left to right, top to bottom. Equal cell dimensions. Center each subject within its cell, with at least 12% empty padding on every side.',
      'Subjects in cell order: ' + request.names.map((name, index) => `${index + 1}: ${name}`).join('; '),
      `Leave the final ${columns * rows - request.names.length} unused cells completely empty and transparent.`,
      `Style shared by every icon: ${request.style.trim()}`,
      request.reference ? 'Use the supplied image for style only. Draw the requested subjects in the new grid.' : '',
      'Output genuine RGBA transparency: all empty space, cell gutters, and holes in objects have zero alpha.',
      'Keep white details on the objects. Smooth antialiased alpha edges with no white matte or fringe.',
      'No background, floor, checkerboard artwork, cast shadows, glow outside objects, text, labels, grid lines, borders, or watermark. No overlapping or cropped icons.',
    ].filter(Boolean).join('\n'),
    background: 'transparent', output_format: 'png', number_of_images: 1,
    quality: request.quality, aspect_ratio: '3:2',
    ...(request.reference ? { input_images: [request.reference] } : {}),
  };
}

export function sheetCells(width: number, height: number, count: number) {
  const { columns, rows } = sheetLayout(count);
  return Array.from({ length: columns * rows }, (_, index) => {
    const x = Math.floor((index % columns) * width / columns);
    const y = Math.floor(Math.floor(index / columns) * height / rows);
    return { x, y, width: Math.floor((index % columns + 1) * width / columns) - x,
      height: Math.floor((Math.floor(index / columns) + 1) * height / rows) - y };
  });
}

/** Reject opaque/fake alpha, empty cells and artwork crossing the crop boundaries.
 * This verifies alpha and layout only; it cannot prove subjects or halo quality.
 */
export function inspectSheet(data: Uint8ClampedArray, width: number, height: number, count: number) {
  if (width < 100 || height < 100 || data.length !== width * height * 4) throw new Error('Invalid sheet dimensions.');
  let transparent = 0;
  for (let i = 3; i < data.length; i += 4) if (data[i] === 0) transparent++;
  if (transparent / (width * height) < 0.05) {
    throw new Error('The model returned an opaque background or insufficient transparency. No background was removed. Try a new generation.');
  }
  const cells = sheetCells(width, height, count);
  cells.forEach((cell, index) => {
    let foreground = 0;
    let empty = 0;
    for (let y = 0; y < cell.height; y++) for (let x = 0; x < cell.width; x++) {
      const alpha = data[((cell.y + y) * width + cell.x + x) * 4 + 3];
      if (alpha === 0) empty++;
      else {
        foreground++;
        if (index >= count) throw new Error('The model filled an unused grid cell. Try generating again with fewer subjects.');
        if (x < 2 || y < 2 || x >= cell.width - 2 || y >= cell.height - 2) {
          throw new Error(`Artwork touches the boundary of cell ${index + 1}. Extraction would crop it. Try a new generation.`);
        }
      }
    }
    if (index < count && (foreground < 16 || empty / (cell.width * cell.height) < 0.05)) {
      throw new Error(`Cell ${index + 1} is empty or lacks a transparent background. Try a new generation.`);
    }
  });
  return { transparentFraction: transparent / (width * height), cells: cells.slice(0, count) };
}

export async function decodeSheet(png: Blob) {
  const bytes = new Uint8Array(await png.slice(0, 8).arrayBuffer());
  if ([137, 80, 78, 71, 13, 10, 26, 10].some((n, i) => bytes[i] !== n)) throw new Error('The model did not return a PNG.');
  const bitmap = await createImageBitmap(png);
  try {
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width; canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('Canvas is unavailable.');
    ctx.drawImage(bitmap, 0, 0);
    return { canvas, ctx, pixels: ctx.getImageData(0, 0, canvas.width, canvas.height) };
  } finally { bitmap.close(); }
}

export async function generateSheet(request: SheetRequest, onStarted: (id: string) => void, resumeId?: string): Promise<SheetResult> {
  const input = sheetInput(request);
  // Deliberately avoid generateImage: that helper retries without transparency.
  const output = resumeId ? await resumeGeneration(resumeId) : await generate(SHEET_MODEL, input, onStarted);
  if (output.images.length !== 1) throw new Error('Expected one sheet from the model.');
  const response = await fetch(output.images[0]);
  if (!response.ok) throw new Error('Could not download the generated sheet. Retry retrieving this prediction.');
  const png = await response.blob();
  const { canvas, pixels } = await decodeSheet(png);
  const { transparentFraction } = inspectSheet(pixels.data, canvas.width, canvas.height, request.names.length);
  return { request, predictionId: output.predictionId, png, width: canvas.width, height: canvas.height, transparentFraction };
}

export async function splitSheet(sheet: SheetResult) {
  const { canvas, ctx, pixels } = await decodeSheet(sheet.png);
  const { cells } = inspectSheet(pixels.data, canvas.width, canvas.height, sheet.request.names.length);
  return Promise.all(cells.map(async (cell, index) => {
    const tile = document.createElement('canvas'); tile.width = cell.width; tile.height = cell.height;
    // Exact integer crop: no scaling, color key, threshold, or background fill.
    tile.getContext('2d')!.putImageData(ctx.getImageData(cell.x, cell.y, cell.width, cell.height), 0, 0);
    const name = sheet.request.names[index].replace(/[^a-z0-9_-]+/gi, '-').replace(/^-|-$/g, '').slice(0, 70) || 'icon';
    return { name: `${String(index + 1).padStart(2, '0')}-${name}.png`, blob: await canvasToBlob(tile) };
  }));
}
