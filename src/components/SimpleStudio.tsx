import { useEffect, useRef, useState } from 'react';
import Preview from './Preview';
import { containerPath } from '../core/geometry';
import { traceMaster } from '../core/trace';
import { describeMaster } from '../core/describe';
import { analyzeReference, suggestThemeFamily, type ThemeSuggestion } from '../core/vision';
import { SHAPE_PRESETS, matchPreset, normalizeSpec, type ContainerSpec } from '../core/spec';
import { hasNativeAlpha, type ComposeLayers, type ComposeOptions } from '../core/compose';
import { useGeneration, type GenerationOptions } from '../state/useGeneration';
import IconGrid from './IconGrid';
import IconDirector from './IconDirector';
import type { DirectorMessage, DirectorResult } from '../core/director';
import { containerGenerationUsesAlpha, frameVariantTarget, makeItem, repairedTransparentOutputMode, resolveIconOutputMode, stableFrameIndex, type ContainerMode, type IconItem } from '../core/library';
import {
  PLATFORM_TARGETS,
  blobBytes,
  buildIco,
  buildZip,
  canvasToBlob,
  download,
  ICO_SIZES,
  renderAtSize,
  renderCompleteAtSize,
  renderContainerOverlayAtSize,
  renderOpenFrameAtSize,
  renderTransparentAtSize,
  svgMask,
} from '../core/export';
import { estimateGlyphBatch, modelOutputCost } from '../core/cost';
import { mergeMaterialPalette, type MaterialPalette, type MaterialRole } from '../core/materialPalette';
import { inspectOpenFrame } from '../core/frameValidation';

interface Props {
  familyName: string;
  onFamilyName: (value: string) => void;
  spec: ContainerSpec;
  compose: ComposeOptions;
  layers: ComposeLayers;
  model: string;
  onModel: (value: string) => void;
  quality: 'low' | 'medium' | 'high';
  onQuality: (value: 'low' | 'medium' | 'high') => void;
  premiumAllowed: boolean;
  onPremiumAllowed: (value: boolean) => void;
  visionModel: string;
  material: string;
  familyPrompt: string;
  negativePrompt: string;
  glyph: string;
  glyphColor: string;
  referenceSubject: string;
  styleProfile: string;
  subjectStyleProfile: string;
  frameStyleProfile: string;
  materialPalette: MaterialPalette | null;
  styleFidelity: number;
  detailVariation: number;
  theme: string;
  themeSuggestions: ThemeSuggestion[];
  directorMessages: DirectorMessage[];
  directorMemory: string;
  onSpec: (patch: Partial<ContainerSpec>) => void;
  onCompose: (patch: Partial<ComposeOptions>) => void;
  onMaterial: (value: string) => void;
  onFamilyPrompt: (value: string) => void;
  onNegativePrompt: (value: string) => void;
  onGlyph: (value: string) => void;
  onGlyphColor: (value: string) => void;
  onReferenceSubject: (value: string) => void;
  onStyleProfile: (value: string) => void;
  onSubjectStyleProfile: (value: string) => void;
  onFrameStyleProfile: (value: string) => void;
  onMaterialPalette: (value: MaterialPalette | null) => void;
  onStyleFidelity: (value: number) => void;
  onDetailVariation: (value: number) => void;
  onTheme: (value: string) => void;
  onThemeSuggestions: (value: ThemeSuggestion[]) => void;
  onDirectorMessages: (value: DirectorMessage[]) => void;
  onDirectorMemory: (value: string) => void;
  onMaterialLayer: (image: CanvasImageSource | null) => void;
  onGlyphLayer: (image: CanvasImageSource | null) => void;
  imageStoreLoaded: boolean;
  extractedSubject: CanvasImageSource | null;
  onExtractedSubject: (image: CanvasImageSource | null) => void;
  master: { name: string; dataUrl: string } | null;
  onMaster: (master: { name: string; dataUrl: string } | null) => void;
  items: IconItem[];
  onItems: (items: IconItem[]) => void;
  concurrency: number;
  onConcurrency: (value: number) => void;
  materialLayer: CanvasImageSource | null;
  glyphs: Map<string, CanvasImageSource>;
  onItemGlyph: (id: string, image: CanvasImageSource, revision?: number) => void;
  onRestoreRevision: (id: string, revision: number) => Promise<boolean>;
  onClearGlyphs: () => void;
  onClearSelectedGlyphs: (ids: Iterable<string>) => void;
  lockedContainer: boolean;
  onLockedContainer: (value: boolean) => void;
  onGlyphTransparency: (value: boolean) => void;
  containerMode: ContainerMode;
  onContainerMode: (value: ContainerMode) => void;
  frameReady: boolean;
  onFrameReady: (value: boolean) => void;
  frameVariants: Map<string, CanvasImageSource>;
  containerOverlay: CanvasImageSource | null;
  onContainerOverlay: (image: CanvasImageSource | null) => void;
  onFrameVariant: (id: string, image: CanvasImageSource) => void;
  onClearFrameVariants: () => void;
  references: Array<{ name: string; dataUrl: string }>;
  onReferences: (value: Array<{ name: string; dataUrl: string }>) => void;
  exportApprovedOnly: boolean;
  onExportApprovedOnly: (value: boolean) => void;
  exportSelectedOnly: boolean;
  onExportSelectedOnly: (value: boolean) => void;
  maxBatchCost: number;
  onMaxBatchCost: (value: number) => void;
}

/** Small filled thumbnail of a shape, for the preset buttons. */
function ShapeChip({ spec }: { spec: ContainerSpec }) {
  const preview = normalizeSpec({ ...spec, size: 48, padding: 4 });
  return (
    <svg viewBox="0 0 48 48" className="shape-chip" aria-hidden="true">
      <path d={containerPath(preview)} fill="currentColor" />
    </svg>
  );
}

function LayerThumbnail({ image }: { image: CanvasImageSource }) {
  const holder = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 320;
    canvas.height = 320;
    canvas.className = 'frame-compare-canvas';
    canvas.getContext('2d')?.drawImage(image, 0, 0, canvas.width, canvas.height);
    holder.current?.replaceChildren(canvas);
  }, [image]);
  return <div className="frame-compare-art" ref={holder} />;
}

/** Decode once, returning both the pixels to analyse and a URL to send. */
async function readMaster(
  file: File,
): Promise<{ pixels: ImageData; dataUrl: string; stored: string; layer: HTMLCanvasElement }> {
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('This browser did not provide a 2D canvas context.');
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  return {
    pixels: ctx.getImageData(0, 0, canvas.width, canvas.height),
    dataUrl: canvas.toDataURL('image/png'),
    // A separate, smaller copy for persistence. A full-size master is easily
    // half a megabyte as a data URL and localStorage caps out around five,
    // which a family project would blow through on the master alone.
    stored: downscale(canvas, 384),
    layer: canvas,
  };
}

async function readStoredPixels(source: string): Promise<ImageData> {
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const next = new Image();
    next.onload = () => resolve(next);
    next.onerror = () => reject(new Error('The saved master could not be decoded.'));
    next.src = source;
  });
  const canvas = document.createElement('canvas');
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('This browser did not provide a 2D canvas context.');
  context.drawImage(image, 0, 0);
  return context.getImageData(0, 0, canvas.width, canvas.height);
}

function downscale(source: HTMLCanvasElement, size: number): string {
  const scale = Math.min(1, size / Math.max(source.width, source.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(source.width * scale);
  canvas.height = Math.round(source.height * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) return source.toDataURL('image/png');
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/png');
}

/**
 * The guided view: shape, look, generate, download.
 *
 * Everything that is a *diagnostic* or a *fine adjustment* lives in the full
 * view instead. The geometry controls in particular are deliberately absent —
 * the presets and the trace cover what people actually need, and exposing an
 * exponent slider by default invites fiddling with the one thing that is
 * supposed to be settled.
 */
export default function SimpleStudio(props: Props) {
  const { status, generateIcon, generateGlyph, generateCompleteIcon, generateOpenFrame, generateForItem, setStatus } = useGeneration();
  const [tracing, setTracing] = useState('');
  const [notes, setNotes] = useState<string[]>([]);
  const [exporting, setExporting] = useState(false);
  const [variantBusy, setVariantBusy] = useState(false);
  const [analysisBusy, setAnalysisBusy] = useState(false);
  const [ideasBusy, setIdeasBusy] = useState(false);
  const [directorGenerationRequest, setDirectorGenerationRequest] = useState<{
    id: string;
    targetIds: string[];
  } | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const lockedInput = useRef<HTMLInputElement>(null);
  const referenceInput = useRef<HTMLInputElement>(null);

  const applyReferenceAnalysis = (
    described: ReturnType<typeof describeMaster>,
    analysis: Awaited<ReturnType<typeof analyzeReference>>,
  ) => {
    props.onReferenceSubject(analysis.subject);
    props.onStyleProfile(analysis.style);
    props.onSubjectStyleProfile(analysis.subjectStyle);
    props.onFrameStyleProfile(analysis.frameStyle);
    props.onMaterialPalette(mergeMaterialPalette(described.palette, analysis.materials, {
      base: analysis.construction === 'filled-container' || analysis.construction === 'unknown'
        ? described.material
        : '',
      glyph: analysis.subjectStyle,
      frame: analysis.construction === 'open-frame-with-subject'
        ? analysis.frameStyle || described.material
        : analysis.frameStyle,
    }, analysis.construction));
    props.onThemeSuggestions(analysis.themes);
    if (analysis.construction === 'open-frame-with-subject') {
      props.onContainerMode('open-frame');
      props.onGlyphTransparency(true);
      props.onFrameReady(false);
    }
  };
  const alphaRepairChecked = useRef(new Set<string>());
  const active = matchPreset(props.spec);
  const selectedModel = props.model === 'openai/gpt-image-2'
    ? `${props.model}#${props.quality}`
    : props.model;
  const cost = modelOutputCost(props.model, props.quality);
  const premiumBlocked = cost !== null && cost > 0.05 && !props.premiumAllowed;
  const premiumMessage = premiumBlocked
    ? `Premium generation is locked: this setting is about $${cost.toFixed(3)} per output.`
    : undefined;

  // The full-resolution layer lives in IndexedDB, while the compact master is
  // persisted with the project. Restore that saved upload after a refresh so
  // the simple flow never repaints it merely because the page was reopened.
  useEffect(() => {
    if (!props.imageStoreLoaded || !props.master || props.materialLayer) return;
    let cancelled = false;
    const image = new Image();
    image.onload = () => {
      if (!cancelled) props.onMaterialLayer(image);
    };
    image.src = props.master.dataUrl;
    return () => { cancelled = true; };
  }, [props.imageStoreLoaded, props.master, props.materialLayer, props.onMaterialLayer]);

  useEffect(() => {
    if (!props.imageStoreLoaded || props.containerMode !== 'open-frame' || !props.materialLayer) return;
    // A persisted extracted subject proves this frame came from the validated
    // two-layer separation flow. Decorative flourishes may legitimately enter
    // the centre, so the older coverage-only heuristic must not erase it.
    if (props.extractedSubject) return;
    const inspection = inspectOpenFrame(props.materialLayer, props.spec.size);
    // Never auto-approve a transparent-looking layer. Older releases carved a
    // large hole and would otherwise immediately approve that damaged result
    // again after the migration deliberately marked it for re-extraction.
    if (!inspection.subjectLikely) return;
    if (props.frameReady) {
      props.onFrameReady(false);
      props.onClearFrameVariants();
      setStatus({
        kind: 'error',
        message: 'Part of the source subject extends into the decorative frame. Extract a clean frame before generating the family.',
      });
    }
  }, [props.imageStoreLoaded, props.containerMode, props.frameReady, props.materialLayer, props.extractedSubject, props.spec, props.onFrameReady, props.onClearFrameVariants, setStatus]);

  // Older versions could save a transparent AI layer but mark its card for
  // container composition. Once IndexedDB restores those pixels, repair only
  // the affected AI results and persist the corrected display/export mode.
  useEffect(() => {
    let changed = false;
    const repaired = props.items.map((item) => {
      if (item.outputMode === 'transparent' || item.outputMode === 'framed' || item.outputMode === 'overlay') return item;
      if (item.sourceUrl && item.sourceMode !== 'styled') return item;
      const image = props.glyphs.get(item.id);
      if (!image) return item;
      const repairKey = `${item.id}:v${item.activeRevision ?? item.revision}`;
      if (alphaRepairChecked.current.has(repairKey)) return item;
      alphaRepairChecked.current.add(repairKey);
      const outputMode = repairedTransparentOutputMode(item, hasNativeAlpha(image));
      if (!outputMode || outputMode === item.outputMode) return item;
      changed = true;
      return { ...item, outputMode };
    });
    if (changed) props.onItems(repaired);
  }, [props.glyphs, props.items, props.onItems]);

  /**
   * One upload does everything: shape, colour, material wording, and — where a
   * vision model is reachable — a strict separation between depicted subject,
   * transferable style and possible set themes. None becomes the next output
   * subject automatically.
   */
  const useMaster = async (files: FileList | null, exact = false) => {
    const file = files?.[0];
    if (!file) return;
    setTracing('Reading your icon…');
    setNotes([]);

    let dataUrl = '';
    try {
      const master = await readMaster(file);
      dataUrl = master.dataUrl;
      // Registered before anything else can fail, so a later vision error still
      // leaves every generation referencing the approved master.
      props.onMaster({ name: file.name, dataUrl: master.stored });
      props.onReferenceSubject('');
      props.onStyleProfile('');
      props.onSubjectStyleProfile('');
      props.onFrameStyleProfile('');
      props.onMaterialPalette(null);
      props.onTheme('');
      props.onThemeSuggestions([]);
      props.onFrameReady(false);
      props.onClearFrameVariants();
      props.onExtractedSubject(null);
      // The upload is already the approved master. Reuse its pixels instead of
      // paying for a second model call to repaint a surface the user supplied.
      props.onMaterialLayer(master.layer);
      props.onLockedContainer(exact);

      const traced = traceMaster(master.pixels, 'symmetric', props.spec);
      props.onSpec(traced.spec);

      const described = describeMaster(master.pixels, traced.spec.glyphInset);
      props.onMaterial(described.material);
      props.onCompose({ baseColor: described.baseColor });
      setNotes(described.notes);
      const localPalette = mergeMaterialPalette(described.palette, [], {
        base: described.material,
        glyph: described.glyph.present
          ? `${described.glyph.colorName} (${described.glyph.color}), sampled from the central subject`
          : '',
        frame: '',
      });
      props.onMaterialPalette(localPalette);
      setTracing(
        `Shape and colours taken from ${file.name}. Corner curve n ≈ ${traced.exponent.toFixed(1)}.`,
      );

      // The reference's depicted object must never become the requested output
      // subject. That old coupling is what made a ghost master produce ghosts
      // for Home, Back and every other family card.
      props.onGlyph('');
      setTracing('Separating its subject, style and possible themes…');
      const analysis = await analyzeReference(dataUrl, props.visionModel);
      applyReferenceAnalysis(described, analysis);
      setTracing(
        analysis.subject
          ? `Reference subject detected as “${analysis.subject}”. It will not be reused unless an icon asks for it.`
          : `Read ${file.name}. Its pixels still provide the visual reference.`,
      );
    } catch (error) {
      // A vision failure must not lose the shape and colour work already done.
      setTracing(
        dataUrl
          ? `Shape and colours read. Style and theme analysis failed: ${(error as Error).message}`
          : `Could not read that image: ${(error as Error).message}`,
      );
    }
  };

  const analyzeSavedMaster = async () => {
    if (!props.master || analysisBusy) return;
    setAnalysisBusy(true);
    setTracing('Dissecting the saved master into materials…');
    try {
      const pixels = await readStoredPixels(props.master.dataUrl);
      const described = describeMaster(pixels, props.spec.glyphInset);
      const analysis = await analyzeReference(props.master.dataUrl, props.visionModel);
      props.onMaterial(described.material);
      props.onCompose({ baseColor: described.baseColor });
      setNotes(described.notes);
      applyReferenceAnalysis(described, analysis);
      setTracing('Material palette ready. Base, glyph, frame and accents will keep their own treatments.');
    } catch (error) {
      setTracing(`Could not analyze the saved master: ${(error as Error).message}`);
    } finally {
      setAnalysisBusy(false);
    }
  };

  const addReferences = async (files: FileList | null) => {
    if (!files?.length) return;
    const added = await Promise.all(Array.from(files).map(async (file) => {
      const image = await readMaster(file);
      return { name: file.name, dataUrl: image.stored };
    }));
    props.onReferences([...props.references, ...added].slice(0, 6));
  };

  const run = () => {
    if (premiumMessage) {
      setStatus({ kind: 'error', message: premiumMessage });
      return;
    }
    if (props.containerMode === 'open-frame' && !props.frameReady) {
      setStatus({ kind: 'error', message: 'Extract or approve a subject-free transparent frame before generating icons.' });
      return;
    }
    // Construction is authoritative. A stale legacy transparency preference
    // must never turn a selected Filled tile into a glyph-only request.
    const layeredOutput = containerGenerationUsesAlpha(props.containerMode);
    const options: GenerationOptions = {
        spec: props.spec,
        model: props.model,
        material: props.material,
        // The guided view keeps one symbol field; style words in the same
        // sentence work fine, so there is no reason to split it in two.
        glyphSubject: props.glyph,
        glyphStyle: '',
        conditioning: 'auto',
        wantAlpha: layeredOutput,
        // Isolated mode keeps the container out of the glyph request. Complete
        // mode deliberately sends it because repainting the whole icon is the
        // selected outcome.
        // Open-frame glyphs still need the original finished sample so they can
        // copy the central subject's treatment. The cleaned frame lives in the
        // material layer and is never substituted for that style evidence.
        master: props.containerMode === 'open-frame'
          ? (props.master?.dataUrl ?? null)
          : layeredOutput && props.lockedContainer ? null : (props.master?.dataUrl ?? null),
        references: props.references.map((reference) => reference.dataUrl),
        referenceSubject: props.referenceSubject,
        styleProfile: props.styleProfile,
        subjectStyleProfile: props.subjectStyleProfile,
        frameStyleProfile: props.frameStyleProfile,
        referenceHasSeparateFrame: props.containerMode === 'open-frame',
        styleFidelity: props.styleFidelity,
        detailVariation: props.detailVariation,
        materialPalette: props.materialPalette,
        theme: props.theme,
        familyPrompt: props.familyPrompt,
        negativePrompt: props.negativePrompt,
        quality: props.quality,
      };
    if (!layeredOutput) {
      void generateCompleteIcon(options, props.onMaterialLayer, props.onGlyphLayer);
      return;
    }
    if (props.materialLayer) {
      if (!props.glyph.trim()) {
        setStatus({ kind: 'ok', message: 'Uploaded master kept; no paid generation was needed.' });
        return;
      }
      void generateGlyph(options, props.onGlyphLayer);
      return;
    }
    void generateIcon(options, props.onMaterialLayer, props.onGlyphLayer);
  };

  const extractFrame = async () => {
    if (premiumMessage) {
      setStatus({ kind: 'error', message: premiumMessage });
      return;
    }
    if (!props.master) {
      setStatus({ kind: 'error', message: 'Upload a finished reference before extracting an open frame.' });
      return;
    }
    const success = await generateOpenFrame({
      spec: props.spec,
      model: props.model,
      material: props.material,
      glyphSubject: '',
      glyphStyle: '',
      conditioning: 'off',
      wantAlpha: true,
      master: props.master.dataUrl,
      references: props.references.map((reference) => reference.dataUrl),
      referenceSubject: props.referenceSubject,
      styleProfile: props.styleProfile,
      subjectStyleProfile: props.subjectStyleProfile,
      frameStyleProfile: props.frameStyleProfile,
      referenceHasSeparateFrame: true,
      styleFidelity: props.styleFidelity,
      detailVariation: props.detailVariation,
      materialPalette: props.materialPalette,
      familyPrompt: props.familyPrompt,
      negativePrompt: props.negativePrompt,
      quality: props.quality,
    }, props.onMaterialLayer, props.onExtractedSubject);
    if (success) {
      props.onFrameReady(true);
      props.onClearFrameVariants();
    }
  };

  const approveExistingFrame = () => {
    if (!props.materialLayer) return;
    const inspection = inspectOpenFrame(props.materialLayer, props.spec.size);
    if (inspection.subjectLikely) {
      setStatus({
        kind: 'error',
        message: `This artwork still occupies ${Math.round(inspection.centralCoverage * 100)}% of the central safe area. It cannot be approved as a subject-free frame.`,
      });
      props.onFrameReady(false);
      return;
    }
    props.onFrameReady(true);
    props.onExtractedSubject(null);
    setStatus({ kind: 'ok', message: 'The existing artwork passed the empty-center check.' });
  };

  const targetFrameCount = frameVariantTarget(props.detailVariation);
  const availableFrameCount = props.materialLayer ? 1 + props.frameVariants.size : props.frameVariants.size;
  const framePool = () => [
    ...(props.materialLayer ? [props.materialLayer] : []),
    ...[...props.frameVariants.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, image]) => image),
  ].slice(0, targetFrameCount);
  const frameFor = (itemId: string) => {
    const pool = framePool();
    return pool[stableFrameIndex(itemId, pool.length)] ?? props.materialLayer;
  };

  const generateFrameVariants = async () => {
    if (!props.frameReady || !props.master || !props.materialLayer) {
      setStatus({ kind: 'error', message: 'Extract and approve the base frame first.' });
      return;
    }
    const needed = Math.max(0, targetFrameCount - 1);
    const totalCost = cost === null ? null : cost * needed;
    if (totalCost !== null && totalCost > props.maxBatchCost) {
      setStatus({ kind: 'error', message: `Frame variants would cost about $${totalCost.toFixed(2)}, above the $${props.maxBatchCost.toFixed(2)} batch limit.` });
      return;
    }
    props.onClearFrameVariants();
    setVariantBusy(true);
    try {
      for (let index = 1; index <= needed; index++) {
        const success = await generateOpenFrame({
          spec: props.spec,
          model: props.model,
          material: props.material,
          glyphSubject: '',
          glyphStyle: '',
          conditioning: 'off',
          wantAlpha: true,
          master: props.master.dataUrl,
          references: props.references.map((reference) => reference.dataUrl),
          referenceSubject: props.referenceSubject,
          styleProfile: props.styleProfile,
          subjectStyleProfile: props.subjectStyleProfile,
          frameStyleProfile: props.frameStyleProfile,
          referenceHasSeparateFrame: true,
          styleFidelity: props.styleFidelity,
          detailVariation: props.detailVariation,
          materialPalette: props.materialPalette,
          familyPrompt: props.familyPrompt,
          negativePrompt: props.negativePrompt,
          variationKey: `frame-variant-${index}-of-${needed}-detail-${props.detailVariation}`,
          quality: props.quality,
        }, (image) => props.onFrameVariant(`v${String(index).padStart(2, '0')}`, image));
        if (!success) return;
      }
      setStatus({ kind: 'ok', message: `${targetFrameCount} stable frame variations are ready for automatic distribution across the family.` });
    } finally {
      setVariantBusy(false);
    }
  };

  const addThemeSubjects = (suggestion: ThemeSuggestion) => {
    const existing = new Set(props.items.map((item) => item.name.toLowerCase()));
    const fresh = suggestion.subjects
      .filter((subject) => !existing.has(subject.toLowerCase()))
      .map((subject) => makeItem(subject, {
        concept: subject,
        category: suggestion.name,
        themeTreatment: `${suggestion.name} interpretation of ${subject}; use one clear seasonal or cultural motif integrated into the subject`,
      }));
    props.onItems([...props.items, ...fresh]);
    props.onTheme(suggestion.name);
    setStatus({
      kind: 'ok',
      message: `Using ${suggestion.name}; added ${fresh.length} new theme concept${fresh.length === 1 ? '' : 's'} to the family.`,
    });
  };

  const generateThemeIdeas = async () => {
    if (!props.master || !props.theme.trim() || ideasBusy) return;
    setIdeasBusy(true);
    setStatus({ kind: 'busy', what: `Planning a ${props.theme.trim()} family` });
    try {
      const ideas = await suggestThemeFamily(props.master.dataUrl, props.theme, props.visionModel);
      if (!ideas.length) throw new Error('The model returned no usable icon ideas.');
      const existing = new Set(props.items.map((item) => item.name.toLowerCase()));
      const fresh = ideas.filter((idea) => !existing.has(idea.name.toLowerCase())).map((idea) => makeItem(idea.name, {
        concept: idea.concept,
        themeTreatment: idea.themeTreatment,
        category: props.theme.trim(),
      }));
      props.onItems([...props.items, ...fresh]);
      setStatus({ kind: 'ok', message: `Added ${fresh.length} themed card idea${fresh.length === 1 ? '' : 's'}. Review the name, subject and treatment before generating.` });
    } catch (error) {
      setStatus({ kind: 'error', message: `Could not suggest the family: ${(error as Error).message}` });
    } finally {
      setIdeasBusy(false);
    }
  };

  const updateMaterialRole = (role: MaterialRole, description: string, fallbackName: string) => {
    if (!props.materialPalette) return;
    const previous = props.materialPalette.recipes.find((recipe) => recipe.role === role);
    const recipes = props.materialPalette.recipes.filter((recipe) => recipe.role !== role);
    if (description.trim()) recipes.push({
      role,
      name: previous?.name || fallbackName,
      description: description.trim(),
      opacityMin: previous?.opacityMin,
      opacityMax: previous?.opacityMax,
    });
    props.onMaterialPalette(mergeMaterialPalette(
      props.materialPalette.colors,
      recipes,
      { base: '', glyph: '', frame: '' },
    ));
  };

  const updateMaterialOpacity = (role: MaterialRole, key: 'opacityMin' | 'opacityMax', value: number) => {
    if (!props.materialPalette) return;
    const recipes = props.materialPalette.recipes.map((recipe) => recipe.role === role
      ? { ...recipe, [key]: Math.max(0, Math.min(100, value)) }
      : recipe);
    props.onMaterialPalette({ ...props.materialPalette, recipes });
  };

  const downloadAll = async () => {
    setExporting(true);
    try {
      const files: Array<{ name: string; bytes: Uint8Array<ArrayBuffer> }> = [];
      const contacts: Array<{ name: string; canvas: HTMLCanvasElement }> = [];
      const safe = (value: string) =>
        value.trim().replace(/[<>:"/\\|?*\x00-\x1f]+/g, '-').replace(/[. ]+$/g, '').slice(0, 96) || 'icon';
      const ready = props.items.filter((item) =>
        item.status === 'ready' &&
        props.glyphs.has(item.id) &&
        (!props.exportApprovedOnly || item.approved),
      ).filter((item) => !props.exportSelectedOnly || item.selected);
      if (props.items.length && !ready.length) {
        throw new Error(props.exportApprovedOnly
          ? 'Approve at least one finished icon before exporting approved-only.'
          : props.exportSelectedOnly
            ? 'Select at least one finished icon before exporting selected-only.'
          : 'Generate at least one family icon before exporting.');
      }
      const targets = ready.length
        ? ready.map((item) => ({ item, glyph: props.glyphs.get(item.id)! }))
        : [{ item: { id: 'current', name: props.glyph || 'Icon', revision: 1 }, glyph: props.layers.glyph }];

      for (const { item, glyph } of targets) {
        const stem = safe(item.name);
        const familyItem = ready.length ? item as IconItem : null;
        const outputMode = familyItem
          ? resolveIconOutputMode(familyItem, containerGenerationUsesAlpha(props.containerMode), props.containerMode)
          : props.containerMode === 'open-frame'
            ? 'framed'
            : props.containerMode === 'isolated'
              ? 'transparent'
              : 'composed';
        const layers = outputMode === 'complete'
          ? { material: glyph ?? props.materialLayer, glyph: null }
          : { material: outputMode === 'framed'
            ? frameFor(item.id)
            : outputMode === 'overlay' ? props.containerOverlay : props.materialLayer, glyph };
        const itemCompose: ComposeOptions = {
          ...props.compose,
          glyphScale: props.compose.glyphScale * ('opticalScale' in item ? (item.opticalScale ?? 1) : 1),
          glyphOffsetX: 'opticalOffsetX' in item ? (item.opticalOffsetX ?? 0) : 0,
          glyphOffsetY: 'opticalOffsetY' in item ? (item.opticalOffsetY ?? 0) : 0,
        };
        const render = (size: number) => outputMode === 'transparent'
          ? renderTransparentAtSize(props.spec, size, glyph, itemCompose)
          : outputMode === 'overlay'
            ? renderContainerOverlayAtSize(props.spec, size, layers, itemCompose)
          : outputMode === 'framed'
            ? renderOpenFrameAtSize(props.spec, size, layers, itemCompose)
            : outputMode === 'complete'
              ? renderCompleteAtSize(props.spec, size, glyph, itemCompose)
              : renderAtSize(props.spec, size, layers, itemCompose);
        for (const target of PLATFORM_TARGETS) {
          const canvas = render(target.size);
          files.push({
            name: `${stem}/${target.platform}/${target.name}.png`,
            bytes: await blobBytes(await canvasToBlob(canvas)),
          });
        }
        const ico = [];
        for (const size of ICO_SIZES) {
          const canvas = render(size);
          ico.push({ size, bytes: await blobBytes(await canvasToBlob(canvas)) });
        }
        files.push({ name: `${stem}/windows/${stem}.ico`, bytes: await blobBytes(await buildIco(ico)) });
        contacts.push({ name: item.name, canvas: render(128) });
      }
      if (contacts.length) {
        const columns = Math.min(5, contacts.length);
        const rows = Math.ceil(contacts.length / columns);
        const sheet = document.createElement('canvas');
        sheet.width = columns * 160;
        sheet.height = rows * 176;
        const ctx = sheet.getContext('2d');
        if (ctx) {
          ctx.fillStyle = '#f8fafc';
          ctx.fillRect(0, 0, sheet.width, sheet.height);
          ctx.fillStyle = '#0f172a';
          ctx.font = '13px system-ui';
          ctx.textAlign = 'center';
          contacts.forEach((contact, index) => {
            const x = (index % columns) * 160;
            const y = Math.floor(index / columns) * 176;
            ctx.drawImage(contact.canvas, x + 16, y + 8, 128, 128);
            ctx.fillText(contact.name.slice(0, 22), x + 80, y + 157);
          });
          files.push({ name: 'family-contact-sheet.png', bytes: await blobBytes(await canvasToBlob(sheet)) });
        }
      }
      files.push({ name: 'container-mask.svg', bytes: new TextEncoder().encode(svgMask(props.spec)) });
      files.push({
        name: 'container-spec.json',
        bytes: new TextEncoder().encode(JSON.stringify(props.spec, null, 2)),
      });
      files.push({
        name: 'family-manifest.json',
        bytes: new TextEncoder().encode(JSON.stringify({
          schemaVersion: 1,
          familyName: props.familyName,
          exportedAt: new Date().toISOString(),
          iconCount: targets.length,
          icons: targets.map(({ item }) => ({
            id: item.id,
            name: item.name,
            concept: 'concept' in item ? item.concept : undefined,
            themeTreatment: 'themeTreatment' in item ? item.themeTreatment : undefined,
            revision: 'activeRevision' in item ? (item.activeRevision ?? item.revision) : item.revision,
            latestRevision: item.revision,
            category: 'category' in item ? item.category : undefined,
            keywords: 'keywords' in item ? item.keywords : undefined,
            approved: 'approved' in item ? item.approved : undefined,
            anchor: 'anchor' in item ? item.anchor : undefined,
            calibration: 'calibration' in item ? item.calibration : undefined,
            complexity: 'complexity' in item ? item.complexity : undefined,
            role: 'role' in item ? item.role : undefined,
            opticalScale: 'opticalScale' in item ? item.opticalScale : undefined,
            opticalOffsetX: 'opticalOffsetX' in item ? item.opticalOffsetX : undefined,
            opticalOffsetY: 'opticalOffsetY' in item ? item.opticalOffsetY : undefined,
            notes: 'notes' in item ? item.notes : undefined,
          })),
          containerSpec: props.spec,
        }, null, 2)),
      });
      files.push({
        name: 'package-index.txt',
        bytes: new TextEncoder().encode(files.map((file) => file.name).sort().join('\n')),
      });
      download(buildZip(files), `${safe(props.familyName)}.zip`);
      setStatus({ kind: 'ok', message: `Exported ${targets.length} icon${targets.length === 1 ? '' : 's'} with manifest.` });
    } catch (error) {
      setStatus({ kind: 'error', message: (error as Error).message });
    } finally {
      setExporting(false);
    }
  };

  const applyDirectorResult = (result: DirectorResult) => {
    const patch = result.patch;
    if (patch.familyName !== undefined) props.onFamilyName(patch.familyName);
    if (patch.material !== undefined) props.onMaterial(patch.material);
    if (patch.familyPrompt !== undefined) props.onFamilyPrompt(patch.familyPrompt);
    if (patch.negativePrompt !== undefined) props.onNegativePrompt(patch.negativePrompt);
    if (patch.styleProfile !== undefined) props.onStyleProfile(patch.styleProfile);
    if (patch.subjectStyleProfile !== undefined) props.onSubjectStyleProfile(patch.subjectStyleProfile);
    if (patch.frameStyleProfile !== undefined) {
      props.onFrameStyleProfile(patch.frameStyleProfile);
      props.onClearFrameVariants();
    }
    if (patch.containerMode !== undefined) {
      props.onContainerMode(patch.containerMode);
      props.onGlyphTransparency(patch.containerMode !== 'filled');
      if (patch.containerMode === 'open-frame') props.onFrameReady(false);
    }
    if (patch.styleFidelity !== undefined) props.onStyleFidelity(patch.styleFidelity);
    if (patch.detailVariation !== undefined) {
      props.onDetailVariation(patch.detailVariation);
      props.onClearFrameVariants();
    }
    if (patch.glyphScale !== undefined) props.onCompose({ glyphScale: patch.glyphScale });
    if (patch.theme !== undefined) props.onTheme(patch.theme);

    const instructionByName = new Map(
      (patch.cardInstructions ?? []).map((entry) => [entry.name.trim().toLocaleLowerCase(), entry.instruction]),
    );
    const named = new Set((patch.selection?.names ?? []).map((name) => name.trim().toLocaleLowerCase()));
    let nextItems = props.items;
    if (patch.selection || instructionByName.size > 0) {
      nextItems = props.items.map((item) => {
        const key = item.name.trim().toLocaleLowerCase();
        const instruction = instructionByName.get(key);
        let selected = item.selected;
        switch (patch.selection?.mode) {
          case 'all': selected = true; break;
          case 'none': selected = false; break;
          case 'named': selected = named.has(key); break;
          case 'drafts': selected = item.status === 'draft'; break;
          case 'failed': selected = item.status === 'failed'; break;
          default: break;
        }
        if (instruction) selected = true;
        return instruction
          ? { ...item, selected, approved: false, directorInstruction: instruction }
          : { ...item, selected };
      });
      props.onItems(nextItems);
    }

    if (result.action === 'generate-selected') {
      const targets = nextItems.filter((item) => item.selected);
      if (!targets.length) {
        const message = 'Generation blocked: select at least one card, then ask the Director to generate again.';
        setStatus({ kind: 'error', message });
        return message;
      }
      if (premiumMessage) {
        const message = `Generation blocked: ${premiumMessage}`;
        setStatus({ kind: 'error', message });
        return message;
      }
      const effectiveMode = patch.containerMode ?? props.containerMode;
      if (effectiveMode === 'open-frame' && !props.frameReady) {
        const inspection = props.materialLayer ? inspectOpenFrame(props.materialLayer, props.spec.size) : null;
        const coverage = inspection?.subjectLikely
          ? ` The current artwork occupies ${Math.round(inspection.centralCoverage * 100)}% of the central safe area.`
          : '';
        const message = `Generation blocked: Open frame requires a subject-free reusable frame.${coverage} Extract the frame first, or ask the Director to keep the complete container and replace its subject.`;
        setStatus({ kind: 'error', message });
        return message;
      }
      const estimate = estimateGlyphBatch(targets, props.model, props.quality);
      if (estimate.cost !== null && estimate.cost > props.maxBatchCost) {
        const message = `Generation blocked: this batch is estimated at $${estimate.cost.toFixed(2)}, above the $${props.maxBatchCost.toFixed(2)} limit.`;
        setStatus({ kind: 'error', message });
        return message;
      }
      setDirectorGenerationRequest({
        id: globalThis.crypto?.randomUUID?.() ?? `director-generate-${Date.now()}-${Math.random()}`,
        targetIds: targets.map((item) => item.id),
      });
      const construction = effectiveMode === 'filled'
        ? `complete icon${targets.length === 1 ? '' : 's'}`
        : effectiveMode === 'open-frame'
          ? `open-frame icon${targets.length === 1 ? '' : 's'}`
          : `isolated subject${targets.length === 1 ? '' : 's'}`;
      const message = `Starting ${targets.length} selected card${targets.length === 1 ? '' : 's'} as ${construction}. Estimated batch cost: ${estimate.cost === null ? 'model-priced' : `$${estimate.cost.toFixed(2)}`}.`;
      setStatus({ kind: 'ok', message });
      return message;
    }
    return result.reply;
  };

  const busy = status.kind === 'busy';
  const directorSummary = [...props.directorMessages].reverse().find((message) => message.role === 'assistant')?.text
    ?? (props.master ? 'Tell the director what this set needs' : 'Upload a reference to begin');

  return (
    <div className="studio">
      <Preview spec={props.spec} compose={props.compose} layers={{ material: props.materialLayer, glyph: props.layers.glyph }} showGuides={false} mode={props.containerMode} />
      <div className="studio-flow">
        <label className="field family-name-field">
          <span className="field-label">Family name</span>
          <input value={props.familyName} onChange={(event) => props.onFamilyName(event.target.value)} />
        </label>
        <ol className="steps">
        <li>
          <details className="compact-step">
          <summary>
            <span className="compact-step-title"><span className="step-num">1</span> Shape or master</span>
            <span className="compact-step-value">
              {props.master?.name ?? SHAPE_PRESETS.find((preset) => preset.id === active)?.label ?? 'Custom'}
            </span>
          </summary>
          <div className="compact-step-body">
          <div className="shape-row">
            {SHAPE_PRESETS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                className={active === preset.id ? 'shape-btn shape-btn-on' : 'shape-btn'}
                onClick={() => props.onSpec(preset.patch)}
              >
                <ShapeChip spec={normalizeSpec({ ...props.spec, ...preset.patch })} />
                {preset.label}
              </button>
            ))}
            <button
              type="button"
              className={active === null ? 'shape-btn shape-btn-on' : 'shape-btn'}
              onClick={() => input.current?.click()}
            >
              <span className="shape-chip shape-chip-drop">↑</span>
              From my icon
            </button>
            <button
              type="button"
              className={props.lockedContainer ? 'shape-btn shape-btn-on' : 'shape-btn'}
              onClick={() => lockedInput.current?.click()}
            >
              <span className="shape-chip shape-chip-drop">✓</span>
              Exact container
            </button>
            <input
              ref={input}
              type="file"
              accept="image/*"
              hidden
              onChange={(event) => void useMaster(event.target.files)}
            />
            <input
              ref={lockedInput}
              type="file"
              accept="image/*"
              hidden
              onChange={(event) => void useMaster(event.target.files, true)}
            />
          </div>
          {props.master && (
            <p className="status status-ok">
              Master: {props.master.name} — {props.lockedContainer
                ? 'container pixels are locked; only glyphs will change.'
                : 'every generation references it.'}
            </p>
          )}
          {props.master && !props.materialPalette && (
            <button type="button" className="ghost" onClick={() => void analyzeSavedMaster()} disabled={busy || analysisBusy}>
              {analysisBusy ? 'Analyzing materials…' : 'Analyze materials'}
            </button>
          )}
          {tracing && <p className="hint">{tracing}</p>}
          {notes.length > 0 && (
            <ul className="notes">
              {notes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          )}
          </div>
          </details>
        </li>

        <li>
          <details className="compact-step">
          <summary>
            <span className="compact-step-title"><span className="step-num">2</span> Icon Director</span>
            <span className="compact-step-value">{directorSummary}</span>
          </summary>
          <div className="compact-step-body compact-fields">
          <IconDirector
            master={props.master}
            messages={props.directorMessages}
            memory={props.directorMemory}
            context={{
              familyName: props.familyName,
              material: props.material,
              familyPrompt: props.familyPrompt,
              negativePrompt: props.negativePrompt,
              styleProfile: props.styleProfile,
              subjectStyleProfile: props.subjectStyleProfile,
              frameStyleProfile: props.frameStyleProfile,
              containerMode: props.containerMode,
              styleFidelity: props.styleFidelity,
              detailVariation: props.detailVariation,
              glyphScale: props.compose.glyphScale,
              theme: props.theme,
              estimatedImageCost: cost,
              cards: props.items.map(({ name, concept, status, selected, themeTreatment, directorInstruction }) => ({
                name, concept, status, selected, themeTreatment, directorInstruction,
              })),
            }}
            onMessages={props.onDirectorMessages}
            onMemory={props.onDirectorMemory}
            onApply={applyDirectorResult}
          />
          {props.containerMode === 'open-frame' && (
            <div className={props.frameReady ? 'frame-gate frame-gate-ready' : 'frame-gate'}>
              <strong>{props.frameReady ? 'Subject-removed master ready' : 'Create a subject-removed master'}</strong>
              <p>{props.frameReady
                ? 'The original upload remains unchanged. The cleaned version removes only the subject and preserves inward frame details.'
                : `Remove ${props.referenceSubject || 'the reference subject'} without applying a second center cut. You can compare both versions here before generating the family.`}</p>
              {props.master && (
                <div className="frame-master-compare" aria-label="Original, extracted subject, and subject-removed master comparison">
                  <figure>
                    <div className="frame-compare-art">
                      <img src={props.master.dataUrl} alt="Original uploaded master icon" />
                    </div>
                    <figcaption><strong>Original master upload</strong><small>Kept unchanged</small></figcaption>
                  </figure>
                  <figure>
                    {props.extractedSubject
                      ? <LayerThumbnail image={props.extractedSubject} />
                      : <div className="frame-compare-art frame-compare-empty">Extracted subject appears here</div>}
                    <figcaption><strong>Extracted subject</strong><small>{props.extractedSubject ? 'Original pixels · saved separately' : 'Not created yet'}</small></figcaption>
                  </figure>
                  <figure>
                    {props.frameReady && props.materialLayer
                      ? <LayerThumbnail image={props.materialLayer} />
                      : <div className="frame-compare-art frame-compare-empty">Subject-removed version appears here</div>}
                    <figcaption><strong>Subject-removed frame</strong><small>{props.frameReady ? 'Saved separately · size matched' : 'Not created yet'}</small></figcaption>
                  </figure>
                </div>
              )}
              <div className="row">
                <button type="button" onClick={() => void extractFrame()} disabled={busy || !props.master}>
                  {props.frameReady ? 'Re-extract subject only' : 'Remove subject'}
                </button>
                {!props.frameReady && props.master && (
                  <button type="button" className="ghost" onClick={approveExistingFrame}>
                    Frame already has no subject
                  </button>
                )}
              </div>
              {props.frameReady && targetFrameCount > 1 && (
                <div className="frame-variants-control">
                  <span>{Math.min(availableFrameCount, targetFrameCount)}/{targetFrameCount} frame variations ready</span>
                  <button type="button" className="ghost" onClick={() => void generateFrameVariants()}
                    disabled={busy || variantBusy || premiumBlocked}>
                    {variantBusy ? 'Generating variations…' : `Generate ${targetFrameCount - 1} alternate frames`}
                  </button>
                </div>
              )}
            </div>
          )}
          <details className="director-manual">
            <summary>Manual controls</summary>
            <div className="director-manual-body compact-fields">
          <fieldset className="construction-picker">
            <legend>Icon construction</legend>
            {([
              ['filled', 'Filled tile', 'Material fills the container.'],
              ['open-frame', 'Open frame', 'Decoration defines the boundary while holes stay transparent.'],
              ['isolated', 'No container', 'Only the subject is exported.'],
            ] as const).map(([mode, label, description]) => (
              <label className={props.containerMode === mode ? 'construction-choice construction-choice-on' : 'construction-choice'} key={mode}>
                <input type="radio" name="construction" checked={props.containerMode === mode} onChange={() => {
                  props.onContainerMode(mode);
                  // Keep the legacy saved preference aligned for advanced view
                  // compatibility, but let this construction choice be final.
                  props.onGlyphTransparency(mode !== 'filled');
                  if (mode === 'open-frame') props.onFrameReady(false);
                }} />
                <span><b>{label}</b><small>{description}</small></span>
              </label>
            ))}
          </fieldset>
          <label className="field">
            <span className="field-label">Surface</span>
            <input
              value={props.material}
              placeholder="brushed deep indigo metal"
              onChange={(event) => {
                props.onMaterial(event.target.value);
                updateMaterialRole('base', event.target.value, 'Container surface');
              }}
            />
          </label>
          <label className="field">
            <span className="field-label">Symbol — leave empty for a plain tile</span>
            <input
              value={props.glyph}
              placeholder="a paper plane, solid white"
              onChange={(event) => props.onGlyph(event.target.value)}
            />
          </label>
          {props.master && (
            <div className="reference-intelligence">
              {props.materialPalette && (
                <details className="material-palette">
                  <summary>
                    <span><b>Material palette</b><small>{props.materialPalette.recipes.length} materials automatically separated and active</small></span>
                    <span className="material-swatches" aria-label="Measured colors">
                      {props.materialPalette.colors.map((color) => (
                        <i key={color.hex} style={{ backgroundColor: color.hex }} title={`${color.name} ${color.hex}`} />
                      ))}
                    </span>
                  </summary>
                  <div className="material-recipes">
                    {props.materialPalette.recipes.map((recipe) => (
                      <div className="material-recipe" key={recipe.role}>
                        <strong>{recipe.role === 'base' ? 'Base' : recipe.role === 'glyph' ? 'Glyph' : recipe.role === 'frame' ? 'Frame' : 'Accent'}</strong>
                        <span><b>{recipe.name}</b><small>{recipe.description}</small>
                          {(recipe.opacityMin !== undefined || recipe.opacityMax !== undefined) && (
                            <span className="opacity-range">
                              <label>Opacity min <input type="number" min={0} max={100} value={recipe.opacityMin ?? recipe.opacityMax ?? 100}
                                onChange={(event) => updateMaterialOpacity(recipe.role, 'opacityMin', Number(event.target.value))} /></label>
                              <label>max <input type="number" min={0} max={100} value={recipe.opacityMax ?? recipe.opacityMin ?? 100}
                                onChange={(event) => updateMaterialOpacity(recipe.role, 'opacityMax', Number(event.target.value))} /></label>
                            </span>
                          )}
                        </span>
                      </div>
                    ))}
                  </div>
                </details>
              )}
              <div className="reference-separation">
                <span className="field-label">Reference content</span>
                <strong>{props.referenceSubject || 'Not identified'}</strong>
                <small>Used as an exclusion, not as the next icon subject.</small>
              </div>
              <details className="reference-material-details">
                <summary>Fine-tune detected materials</summary>
                <label className="field">
                  <span className="field-label">Transferable style</span>
                  <textarea
                    value={props.styleProfile}
                    placeholder="transparent iridescent gel, cool pastel reflections, soft studio lighting…"
                    onChange={(event) => props.onStyleProfile(event.target.value)}
                  />
                </label>
                <label className="field">
                  <span className="field-label">Glyph material</span>
                  <textarea
                    value={props.subjectStyleProfile}
                    placeholder="milky opalescent filled volume, bright pearly body, broad highlights…"
                    onChange={(event) => {
                      props.onSubjectStyleProfile(event.target.value);
                      updateMaterialRole('glyph', event.target.value, 'Symbol material');
                    }}
                  />
                  <small>Copies the subject’s treatment—not its identity.</small>
                </label>
                {props.containerMode === 'open-frame' && (
                  <label className="field">
                    <span className="field-label">Frame material</span>
                    <textarea
                      value={props.frameStyleProfile}
                      placeholder="clear iridescent ribbons and bubbles with transparent gaps…"
                      onChange={(event) => {
                        props.onFrameStyleProfile(event.target.value);
                        updateMaterialRole('frame', event.target.value, 'Decorative frame');
                        props.onClearFrameVariants();
                      }}
                    />
                    <small>Kept separate so glyphs do not become hollow pieces of the frame.</small>
                  </label>
                )}
              </details>
              <label className="field">
                <span className="field-label">Set theme — optional</span>
                <input
                  value={props.theme}
                  placeholder="Choose a suggestion or type your own"
                  onChange={(event) => props.onTheme(event.target.value)}
                />
              </label>
              <button type="button" className="ghost" disabled={!props.theme.trim() || !props.master || ideasBusy}
                onClick={() => void generateThemeIdeas()}>
                {ideasBusy ? 'Planning family…' : 'Suggest themed icon cards'}
              </button>
              {props.themeSuggestions.length > 0 && (
                <div className="theme-suggestions" aria-label="Detected theme suggestions">
                  {props.themeSuggestions.map((suggestion) => (
                    <div className={props.theme === suggestion.name ? 'theme-card theme-card-on' : 'theme-card'} key={suggestion.name}>
                      <div>
                        <strong>{suggestion.name}</strong>
                        <small>{suggestion.rationale}</small>
                      </div>
                      <div className="row row-tight">
                        <button type="button" className="ghost" onClick={() => props.onTheme(suggestion.name)}>
                          Use theme
                        </button>
                        <button type="button" className="ghost" onClick={() => addThemeSubjects(suggestion)}>
                          Add {suggestion.subjects.length} ideas
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
          <label className="field field-inline">
            <span className="field-label">Colour</span>
            <input
              type="color"
              value={props.compose.baseColor}
              onChange={(event) => props.onCompose({ baseColor: event.target.value })}
            />
          </label>
          <label className="field">
            <span className="field-label">Generation model</span>
            <select value={selectedModel} onChange={(event) => {
              const [model, quality] = event.target.value.split('#');
              props.onModel(model);
              if (model === 'openai/gpt-image-2' && (quality === 'low' || quality === 'medium' || quality === 'high')) {
                props.onQuality(quality);
              }
            }}>
              <option value="openai/gpt-image-2#low">GPT Image 2 · Low — ~$0.012</option>
              <option value="openai/gpt-image-2#medium">GPT Image 2 · Medium — ~$0.047</option>
              <option value="openai/gpt-image-2#high">GPT Image 2 · High — ~$0.128</option>
              <option value="bytedance/seedream-4">Seedream 4 — ~$0.030</option>
              <option value="google/nano-banana">Nano Banana — ~$0.039</option>
              <option value="google/nano-banana-pro">Nano Banana Pro — ~$0.150</option>
            </select>
          </label>
          {cost !== null && <p className={cost > 0.05 ? 'status status-error' : 'status status-ok'}>
            Estimated Replicate charge: about ${cost.toFixed(3)} per generated output.
            {' '}{props.containerMode === 'filled'
              ? 'Each result is generated as one complete tile containing both its container and symbol.'
              : props.materialLayer
                ? 'Your prepared frame is reused, so only the requested subject is generated.'
                : 'A new material plus an AI subject uses two outputs; exact library artwork uses none.'}
          </p>}
          {cost !== null && cost > 0.05 && (
            <label className="toggle premium-lock">
              <input type="checkbox" checked={props.premiumAllowed}
                onChange={(event) => props.onPremiumAllowed(event.target.checked)} />
              Allow premium generation at about ${cost.toFixed(3)} per output
            </label>
          )}
          <details className="guided-options">
            <summary>Optional fine-tuning</summary>
            <label className="field">
              <span className="field-label">Family art direction</span>
              <textarea value={props.familyPrompt} placeholder="shared lighting, material, camera and style rules"
                onChange={(event) => props.onFamilyPrompt(event.target.value)} />
            </label>
            <label className="field">
              <span className="field-label">Exclude</span>
              <input value={props.negativePrompt} placeholder="text, extra objects, inconsistent perspective"
                onChange={(event) => props.onNegativePrompt(event.target.value)} />
            </label>
            <label className="field field-inline">
              <span className="field-label">Glyph colour</span>
              <input type="color" value={props.glyphColor}
                onChange={(event) => props.onGlyphColor(event.target.value)} />
            </label>
            <div className="row reference-row">
              <button type="button" className="ghost" onClick={() => referenceInput.current?.click()}>
                Add glyph style masters
              </button>
              <input ref={referenceInput} type="file" accept="image/*" multiple hidden
                onChange={(event) => void addReferences(event.target.files)} />
              {props.references.map((reference, index) => (
                <button key={`${reference.name}-${index}`} type="button" className="chip"
                  title="Remove reference"
                  onClick={() => props.onReferences(props.references.filter((_, at) => at !== index))}>
                  {reference.name} ×
                </button>
              ))}
            </div>
            <p className="hint">Add 2–5 different finished glyphs from the same family. Shared material and lighting are treated as rules; differing subjects and detail placement are treated as allowed variation.</p>
            <div className="style-grid simple-controls">
              <label className="field">
                <span className="field-label">Style match <b>{props.styleFidelity}%</b></span>
                <input type="range" min={0} max={100} step={5} value={props.styleFidelity}
                  onChange={(event) => {
                    props.onStyleFidelity(Number(event.target.value));
                    props.onClearFrameVariants();
                  }} />
                <small>Locks material, palette, lighting and subject/frame treatments.</small>
              </label>
              <label className="field">
                <span className="field-label">Decorative variation <b>{props.detailVariation}%</b></span>
                <input type="range" min={0} max={100} step={5} value={props.detailVariation}
                  onChange={(event) => {
                    props.onDetailVariation(Number(event.target.value));
                    props.onClearFrameVariants();
                  }} />
                <small>Varies bubble counts, sizes, positions and swirl paths independently of style.</small>
              </label>
              <label className="field">
                <span className="field-label">Glyph size <b>{Math.round(props.compose.glyphScale * 100)}%</b></span>
                <input type="range" min={50} max={140} value={props.compose.glyphScale * 100}
                  onChange={(event) => props.onCompose({ glyphScale: Number(event.target.value) / 100 })} />
              </label>
              <label className="field">
                <span className="field-label">Shadow <b>{props.compose.shadowBlur}px</b></span>
                <input type="range" min={0} max={120} value={props.compose.shadowBlur}
                  onChange={(event) => props.onCompose({ shadowBlur: Number(event.target.value) })} />
              </label>
            </div>
          </details>
            </div>
          </details>
          </div>
          </details>
        </li>

        <li>
          <h3>
            <span className="step-num">3</span> Make it
          </h3>
          <div className="row">
            <button type="button" className="primary" onClick={run}
              disabled={busy || premiumBlocked || (props.containerMode === 'open-frame' && !props.frameReady)}>
              {busy ? 'Working…' : `${props.containerMode === 'isolated' ? 'Generate subject' : 'Generate icon'}${cost !== null ? ` · ~${(cost * (props.containerMode === 'filled' || !props.glyph.trim() || props.materialLayer ? 1 : 2)).toFixed(3)}` : ''}`}
            </button>
            <button
              type="button"
              className="ghost"
              onClick={() => {
                props.onMaterialLayer(null);
                props.onGlyphLayer(null);
                props.onMaster(null);
                props.onLockedContainer(false);
                props.onReferenceSubject('');
                props.onStyleProfile('');
                props.onSubjectStyleProfile('');
                props.onFrameStyleProfile('');
                props.onMaterialPalette(null);
                props.onTheme('');
                props.onThemeSuggestions([]);
                props.onFrameReady(false);
                props.onClearFrameVariants();
              }}
              disabled={busy}
            >
              Clear
            </button>
          </div>
          {status.kind === 'busy' && <p className="status status-busy">{status.what}…</p>}
          {status.kind === 'error' && <p className="status status-error">{status.message}</p>}
          {status.kind === 'ok' && <p className="status status-ok">{status.message}</p>}
        </li>

        <li>
          <h3>
            <span className="step-num">4</span> Build the family
          </h3>
          <details className="scale-saver">
            <summary><strong>Batch cost limit</strong></summary>
            <label className="field field-inline">
              <span className="field-label">Hard limit per batch</span>
              <span>$</span>
              <input type="number" min={0} step={0.25} value={props.maxBatchCost}
                onChange={(event) => props.onMaxBatchCost(Math.max(0, Number(event.target.value) || 0))} />
            </label>
            <p className="hint">Exact SVG/custom artwork renders locally for $0. Identical AI requests reuse the saved result.</p>
          </details>
          <IconGrid
            spec={props.spec}
            compose={props.compose}
            material={props.materialLayer}
            frameVariants={props.frameVariants}
            containerOverlay={props.containerOverlay}
            onContainerOverlay={props.onContainerOverlay}
            glyphColor={props.glyphColor}
            items={props.items}
            concurrency={props.concurrency}
            onItems={props.onItems}
            onConcurrency={props.onConcurrency}
            generate={generateForItem}
            glyphs={props.glyphs}
            onItemGlyph={props.onItemGlyph}
            onRestoreRevision={props.onRestoreRevision}
            onClearGlyphs={props.onClearGlyphs}
            onClearSelectedGlyphs={props.onClearSelectedGlyphs}
            options={{
              spec: props.spec,
              model: props.model,
              material: props.material,
              glyphStyle: '',
              conditioning: 'auto',
              wantAlpha: containerGenerationUsesAlpha(props.containerMode),
              master: props.containerMode === 'open-frame'
                ? (props.master?.dataUrl ?? null)
                : containerGenerationUsesAlpha(props.containerMode) && props.lockedContainer
                  ? null
                  : (props.master?.dataUrl ?? null),
              references: props.references.map((reference) => reference.dataUrl),
              referenceSubject: props.referenceSubject,
              styleProfile: props.styleProfile,
              subjectStyleProfile: props.subjectStyleProfile,
              frameStyleProfile: props.frameStyleProfile,
              referenceHasSeparateFrame: props.containerMode === 'open-frame',
              styleFidelity: props.styleFidelity,
              detailVariation: props.detailVariation,
              materialPalette: props.materialPalette,
              theme: props.theme,
              familyPrompt: props.familyPrompt,
              negativePrompt: props.negativePrompt,
              quality: props.quality,
            }}
            maxBatchCost={props.maxBatchCost}
            containerMode={props.containerMode}
            generationBlocked={props.containerMode === 'open-frame' && !props.frameReady
              ? 'Extract or approve a subject-free transparent frame before generating the family.'
              : premiumMessage}
            generationRequest={directorGenerationRequest}
          />
        </li>

        <li>
          <h3>
            <span className="step-num">5</span> Download
          </h3>
          <button type="button" onClick={downloadAll} disabled={exporting}>
            {exporting ? 'Rendering every size…' : 'Download all icon sizes'}
          </button>
          <label className="toggle export-gate">
            <input
              type="checkbox"
              checked={props.exportApprovedOnly}
              onChange={(event) => {
                props.onExportApprovedOnly(event.target.checked);
                if (event.target.checked) props.onExportSelectedOnly(false);
              }}
            />
            Export approved icons only
          </label>
          <label className="toggle export-gate">
            <input
              type="checkbox"
              checked={props.exportSelectedOnly}
              onChange={(event) => {
                props.onExportSelectedOnly(event.target.checked);
                if (event.target.checked) props.onExportApprovedOnly(false);
              }}
            />
            Export selected ready icons only
          </label>
          <div className="qa-summary" aria-label="Family QA summary">
            <span className="badge badge-ready">
              {props.items.filter((item) => item.status === 'ready').length} ready
            </span>
            <span className="badge">
              {props.items.filter((item) => item.approved).length} approved
            </span>
            <span className="badge">
              {props.items.filter((item) => item.status === 'failed').length} failed
            </span>
            <span className="badge">
              {props.items.filter((item) => item.status === 'draft').length} draft
            </span>
          </div>
          {status.kind === 'error' && <p className="status status-error">{status.message}</p>}
          {status.kind === 'ok' && <p className="status status-ok">{status.message}</p>}
          <p className="hint">
            iOS, Android, macOS, Windows and web, plus a .ico and the shape spec. Every size is
            rendered fresh, not shrunk down.
          </p>
        </li>
        </ol>
      </div>
    </div>
  );
}
