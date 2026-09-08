import { describe, expect, it, vi, afterEach } from 'vitest';
import { generateSheet, inspectSheet, parseSheetNames, sheetCells, sheetInput, sheetLayout, SHEET_MODEL } from '../src/core/iconSheet';
import { generate, resumeGeneration } from '../src/core/replicate';

vi.mock('../src/core/replicate', () => ({ generate: vi.fn(), resumeGeneration: vi.fn() }));
const request = { names: Array.from({ length: 10 }, (_, i) => `Subject ${i + 1}`), style: 'Glossy ceramic', quality: 'medium' as const };
function fixture(count: number) {
  const width = 503, height = 307;
  const data = new Uint8ClampedArray(width * height * 4);
  const cells = sheetCells(width, height, count);
  cells.slice(0, count).forEach(cell => {
    for (let y = 10; y < cell.height - 10; y++) for (let x = 10; x < cell.width - 10; x++) {
      const pos = ((cell.y + y) * width + cell.x + x) * 4;
      data.set([255, 255, 255, x === 10 ? 127 : 255], pos);
    }
  });
  return { width, height, data, cells };
}
afterEach(() => vi.clearAllMocks());

describe('transparent sheet contract', () => {
  it('accepts every count from 10 to 20, including incomplete final rows', () => {
    for (let count = 10; count <= 20; count++) {
      const f = fixture(count);
      expect(inspectSheet(f.data, f.width, f.height, count).cells).toHaveLength(count);
      expect(sheetLayout(count).columns).toBe(5);
    }
    for (const count of [0, 9, 21, 10.5, NaN]) expect(() => sheetLayout(count)).toThrow();
  });
  it('requests ONE PNG containing the grid with an explicit alpha parameter', () => {
    const input = sheetInput(request);
    expect(SHEET_MODEL).toBe('openai/gpt-image-2');
    expect(input).toMatchObject({ background: 'transparent', output_format: 'png', number_of_images: 1, quality: 'medium' });
    expect(input.prompt).toContain('5-column by 2-row');
    expect(input.prompt).toContain('10: Subject 10');
    expect(sheetInput({ ...request, reference: 'data:image/png;base64,abc' }).input_images).toEqual(['data:image/png;base64,abc']);
    expect(parseSheetNames(' Phone\r\n\nMail ')).toEqual(['Phone', 'Mail']);
  });
  it('rejects RGB/fake checkerboards even with one transparent pixel', () => {
    const f = fixture(10); f.data.fill(255); f.data[3] = 0;
    expect(() => inspectSheet(f.data, f.width, f.height, 10)).toThrow(/opaque/);
  });
  it('rejects blank results, missing subjects, filled spare cells, and cropped art', () => {
    const f = fixture(11);
    const missing = new Uint8ClampedArray(f.data);
    const first = f.cells[0];
    for (let y = 0; y < first.height; y++) for (let x = 0; x < first.width; x++) missing[(y * f.width + x) * 4 + 3] = 0;
    expect(() => inspectSheet(missing, f.width, f.height, 11)).toThrow(/Cell 1/);
    expect(() => inspectSheet(new Uint8ClampedArray(f.data.length), f.width, f.height, 11)).toThrow(/empty/);
    const extra = new Uint8ClampedArray(f.data); const spare = f.cells[11];
    extra[((spare.y + 10) * f.width + spare.x + 10) * 4 + 3] = 255;
    expect(() => inspectSheet(extra, f.width, f.height, 11)).toThrow(/unused/);
    f.data[(10 * f.width) * 4 + 3] = 128;
    expect(() => inspectSheet(f.data, f.width, f.height, 11)).toThrow(/boundary/);
  });
  it('does not modify opaque white artwork or fractional alpha', () => {
    const f = fixture(20); const before = new Uint8ClampedArray(f.data);
    inspectSheet(f.data, f.width, f.height, 20);
    expect(f.data).toEqual(before);
  });
  it('covers odd dimensions without gaps or overlaps', () => {
    const f = fixture(20); const hits = new Uint8Array(f.width * f.height);
    f.cells.forEach(cell => { for (let y = cell.y; y < cell.y + cell.height; y++) for (let x = cell.x; x < cell.x + cell.width; x++) hits[y * f.width + x]++; });
    expect(hits.every(n => n === 1)).toBe(true);
  });
  it('never retries an unsupported alpha request as an opaque generation', async () => {
    vi.mocked(generate).mockRejectedValueOnce(new Error('transparent background unsupported'));
    await expect(generateSheet(request, vi.fn())).rejects.toThrow(/unsupported/);
    expect(generate).toHaveBeenCalledTimes(1);
    expect(generate).toHaveBeenCalledWith(SHEET_MODEL, expect.objectContaining({ background: 'transparent' }), expect.any(Function));
  });
  it('resumes the paid prediction without creating another one', async () => {
    vi.mocked(resumeGeneration).mockRejectedValueOnce(new Error('still unavailable'));
    await expect(generateSheet(request, vi.fn(), 'existing')).rejects.toThrow();
    expect(resumeGeneration).toHaveBeenCalledWith('existing');
    expect(generate).not.toHaveBeenCalled();
  });
});
