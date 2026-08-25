import { useEffect, useMemo, useRef, useState } from 'react';
import ApiKeyBar from './components/ApiKeyBar';
import DeterminismPanel from './components/DeterminismPanel';
import DriftLab from './components/DriftLab';
import ExportPanel from './components/ExportPanel';
import GeneratePanel from './components/GeneratePanel';
import MeasurePanel from './components/MeasurePanel';
import Preview from './components/Preview';
import SimpleStudio from './components/SimpleStudio';
import SpecPanel from './components/SpecPanel';
import TracePanel from './components/TracePanel';
import type { ComposeLayers } from './core/compose';
import { useImageStore } from './state/useImageStore';
import { hydrateProject, useProject, type Project } from './state/useProject';
import { download } from './core/export';
import type { ImageBundle } from './state/useImageStore';
import { repairLegacyBuiltinGlyphModes, resetBuiltinGlyphModelResults } from './core/library';
import {
  deleteProjectSlot,
  listSavedProjects,
  loadProjectSlot,
  saveProjectSlot,
  type SavedProjectBundle,
  type SavedProjectSummary,
} from './core/projectLibrary';

const ACTIVE_SET_KEY = 'icon-generator-active-set-v1';
const newSetId = () => globalThis.crypto?.randomUUID?.() ?? `set-${Date.now()}-${Math.random().toString(36).slice(2)}`;

export default function App() {
  const { project, setProject, setSpec, setCompose, setField, reset } = useProject();
  const store = useImageStore();
  const [showGuides, setShowGuides] = useState(true);
  const projectInput = useRef<HTMLInputElement>(null);
  const [projectMessage, setProjectMessage] = useState('');
  const [savedProjects, setSavedProjects] = useState<SavedProjectSummary[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(
    () => localStorage.getItem(ACTIVE_SET_KEY),
  );
  const [projectBusy, setProjectBusy] = useState(false);

  useEffect(() => {
    void listSavedProjects().then(setSavedProjects);
  }, []);

  const projectBundle = async (): Promise<SavedProjectBundle> => ({
    schemaVersion: 1,
    project,
    images: await store.exportImages(),
  });

  const saveLocalProject = async (forceNew = false) => {
    setProjectBusy(true);
    try {
      const id = forceNew || !activeProjectId ? newSetId() : activeProjectId;
      setSavedProjects(await saveProjectSlot(id, await projectBundle()));
      setActiveProjectId(id);
      localStorage.setItem(ACTIVE_SET_KEY, id);
      setProjectMessage(`Saved “${project.name || 'Untitled icon set'}” in this browser.`);
      return id;
    } finally {
      setProjectBusy(false);
    }
  };

  const openLocalProject = async (id: string) => {
    if (!id || id === activeProjectId || projectBusy) return;
    setProjectBusy(true);
    try {
      const hasWork = Boolean(project.items.length || project.master || store.material || store.glyph);
      if (hasWork) {
        const currentId = activeProjectId ?? newSetId();
        setSavedProjects(await saveProjectSlot(currentId, await projectBundle()));
      }
      const saved = await loadProjectSlot(id);
      if (!saved) throw new Error('That saved icon set could not be found.');
      await store.importImages(saved.images);
      setProject(hydrateProject(saved.project));
      setActiveProjectId(id);
      localStorage.setItem(ACTIVE_SET_KEY, id);
      setProjectMessage(`Opened “${saved.project.name}”.`);
    } catch (error) {
      setProjectMessage(`Could not open icon set: ${(error as Error).message}`);
    } finally {
      setProjectBusy(false);
    }
  };

  const newLocalProject = async () => {
    if (projectBusy) return;
    setProjectBusy(true);
    try {
      const hasWork = Boolean(project.items.length || project.master || store.material || store.glyph);
      if (hasWork) {
        const id = activeProjectId ?? newSetId();
        setSavedProjects(await saveProjectSlot(id, await projectBundle()));
      }
      store.clearAll();
      reset();
      setActiveProjectId(null);
      localStorage.removeItem(ACTIVE_SET_KEY);
      setProjectMessage('Started a new icon set. The previous set was saved locally.');
    } finally {
      setProjectBusy(false);
    }
  };

  const deleteLocalProject = async () => {
    if (!activeProjectId || projectBusy) return;
    if (!window.confirm('Delete this saved icon set? The open working copy will remain until you switch or reset.')) return;
    setSavedProjects(await deleteProjectSlot(activeProjectId));
    setActiveProjectId(null);
    localStorage.removeItem(ACTIVE_SET_KEY);
    setProjectMessage('Removed this set from saved icon sets. The current working copy is still open.');
  };

  const downloadProject = async () => {
    const bundle = {
      schemaVersion: 1,
      project,
      images: await store.exportImages(),
    };
    const safe = project.name.replace(/[^a-z0-9_-]+/gi, '-').replace(/^-|-$/g, '') || 'icon-family';
    download(
      new Blob([JSON.stringify(bundle)], { type: 'application/json' }),
      `${safe}.icon-family.json`,
    );
    setProjectMessage('Portable project saved with its rendered artwork.');
  };

  const openProject = async (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text()) as {
        schemaVersion?: number;
        project?: Partial<Project>;
        images?: ImageBundle;
      };
      if (!parsed.project || !parsed.images) throw new Error('This is not an icon-family project bundle.');
      await store.importImages(parsed.images);
      setProject(hydrateProject(parsed.project));
      setActiveProjectId(null);
      localStorage.removeItem(ACTIVE_SET_KEY);
      setProjectMessage(`Opened ${file.name}.`);
    } catch (error) {
      setProjectMessage(`Could not open project: ${(error as Error).message}`);
    }
  };

  const { material, glyph } = store;
  const layers: ComposeLayers = useMemo(() => ({ material, glyph }), [material, glyph]);

  /** Repair the catalog regression once per saved project. */
  useEffect(() => {
    if (!store.loaded) return;
    const repair = project.catalogTextSubjectVersion < 1
      ? resetBuiltinGlyphModelResults(project.items)
      : repairLegacyBuiltinGlyphModes(project.items);
    // Enforce reference-only behavior even if a v1 project was later switched
    // back to exact mode before that choice was removed.
    if (
      !repair.clearedIds.length &&
      project.builtinGlyphStyleVersion >= 1 &&
      project.catalogTextSubjectVersion >= 1
    ) return;
    if (repair.clearedIds.length) store.clearItemGlyphs(repair.clearedIds);
    setProject((current) => ({
      ...current,
      items: repair.items,
      builtinGlyphStyleVersion: 1,
      catalogTextSubjectVersion: 1,
    }));
  }, [
    store.loaded,
    store.clearItemGlyphs,
    project.builtinGlyphStyleVersion,
    project.catalogTextSubjectVersion,
    project.items,
    setProject,
  ]);

  /**
   * Reconcile cards against what actually survived in storage.
   *
   * A card can be marked ready in the project JSON while its glyph is gone —
   * the browser evicted the database, or storage was cleared independently —
   * and a card claiming a result it cannot show is worse than one that admits
   * it needs regenerating.
   */
  useEffect(() => {
    if (!store.loaded) return;
    const stale = project.items.filter(
      (item) => item.status === 'ready' && !store.glyphs.has(item.id),
    );
    if (!stale.length) return;
    const staleIds = new Set(stale.map((item) => item.id));
    setField(
      'items',
      project.items.map((item) =>
        staleIds.has(item.id) ? { ...item, status: 'draft' as const, selected: true } : item,
      ),
    );
  }, [store.loaded, store.glyphs, project.items, setField]);
  const advanced = project.advanced;

  return (
    <div className={advanced ? 'app' : 'app app-simple'}>
      <header className="topbar">
        <div>
          <h1>{project.name || 'Icon Generator'}</h1>
          <p>
            {advanced
              ? 'Geometry is compiled. Material is generated. The two never negotiate.'
              : 'Pick a shape, describe the look, download every size.'}
          </p>
        </div>
        <div className="row row-tight">
          <ApiKeyBar />
          <details className="project-menu">
            <summary>
              <span className="project-menu-label">Set</span>
              <span className="project-menu-name">{project.name || 'Untitled'}</span>
            </summary>
            <div className="project-menu-body">
              {!advanced && (
                <>
                  <label className="field">
                    <span className="field-label">Switch icon set</span>
                    <select
                      aria-label="Saved icon sets"
                      value={activeProjectId ?? ''}
                      disabled={projectBusy}
                      onChange={(event) => void openLocalProject(event.target.value)}
                    >
                      <option value="">Current unsaved set</option>
                      {savedProjects.map((saved) => (
                        <option key={saved.id} value={saved.id}>
                          {saved.name} · {saved.iconCount} icons
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="project-menu-primary">
                    <button type="button" disabled={projectBusy}
                      onClick={() => void saveLocalProject()}>
                      {projectBusy ? 'Saving…' : 'Save set'}
                    </button>
                    <button type="button" className="ghost" disabled={projectBusy}
                      onClick={() => void newLocalProject()}>
                      New set
                    </button>
                  </div>
                </>
              )}

              <button
                type="button"
                className="ghost project-view-toggle"
                onClick={() => setField('advanced', !advanced)}
              >
                {advanced ? 'Return to simple view' : 'Open all controls'}
              </button>

              <details className="project-more">
                <summary>More actions</summary>
                <div className="project-menu-body">
                  {!advanced && (
                    <>
                      <button type="button" className="ghost" onClick={() => void downloadProject()}>Download backup</button>
                      <button type="button" className="ghost" onClick={() => projectInput.current?.click()}>
                        Import backup
                      </button>
                      <button type="button" className="ghost" disabled={!activeProjectId || projectBusy}
                        onClick={() => void deleteLocalProject()}>
                        Delete saved set
                      </button>
                    </>
                  )}
                  <button
                    type="button"
                    className="ghost project-reset"
                    onClick={() => {
                      reset();
                      store.clearAll();
                    }}
                  >
                    Reset current work
                  </button>
                </div>
              </details>
            </div>
          </details>
          {!advanced && (
            <>
              <input
                ref={projectInput}
                type="file"
                accept=".json,.icon-family.json,application/json"
                hidden
                onChange={(event) => void openProject(event.target.files)}
              />
            </>
          )}
        </div>
      </header>

      {!advanced && projectMessage && <p className="project-message status status-ok">{projectMessage}</p>}

      {!advanced && (
          <SimpleStudio
          familyName={project.name}
          onFamilyName={(value) => setField('name', value)}
          spec={project.spec}
          compose={project.compose}
          layers={layers}
          model={project.model}
          onModel={(value) => setField('model', value)}
          quality={project.quality}
          onQuality={(value) => setField('quality', value)}
          premiumAllowed={project.premiumAllowed}
          onPremiumAllowed={(value) => setField('premiumAllowed', value)}
          visionModel={project.visionModel}
          material={project.materialDescription}
          familyPrompt={project.familyPrompt}
          negativePrompt={project.negativePrompt}
          glyph={project.glyphSubject}
          glyphColor={project.glyphColor}
          referenceSubject={project.referenceSubject}
          styleProfile={project.styleProfile}
          subjectStyleProfile={project.subjectStyleProfile}
          frameStyleProfile={project.frameStyleProfile}
          theme={project.theme}
          themeSuggestions={project.themeSuggestions}
          onSpec={setSpec}
          onCompose={setCompose}
          onMaterial={(value) => setField('materialDescription', value)}
          onFamilyPrompt={(value) => setField('familyPrompt', value)}
          onNegativePrompt={(value) => setField('negativePrompt', value)}
          onGlyph={(value) => setField('glyphSubject', value)}
          onGlyphColor={(value) => setField('glyphColor', value)}
          onReferenceSubject={(value) => setField('referenceSubject', value)}
          onStyleProfile={(value) => setField('styleProfile', value)}
          onSubjectStyleProfile={(value) => setField('subjectStyleProfile', value)}
          onFrameStyleProfile={(value) => setField('frameStyleProfile', value)}
          onTheme={(value) => setField('theme', value)}
          onThemeSuggestions={(value) => setField('themeSuggestions', value)}
          onMaterialLayer={store.setMaterial}
          onGlyphLayer={store.setGlyph}
          materialLayer={material}
          glyphs={store.glyphs}
          onItemGlyph={store.setItemGlyph}
          onRestoreRevision={store.restoreItemRevision}
          onClearGlyphs={store.clearGlyphs}
          onClearSelectedGlyphs={store.clearItemGlyphs}
          lockedContainer={project.lockedContainer}
          onLockedContainer={(value) => setField('lockedContainer', value)}
          glyphTransparency={project.glyphTransparency}
          onGlyphTransparency={(value) => setField('glyphTransparency', value)}
          containerMode={project.containerMode}
          onContainerMode={(value) => setField('containerMode', value)}
          frameReady={project.frameReady}
          onFrameReady={(value) => setField('frameReady', value)}
          references={project.references}
          onReferences={(value) => setField('references', value)}
          exportApprovedOnly={project.exportApprovedOnly}
          onExportApprovedOnly={(value) => setField('exportApprovedOnly', value)}
          exportSelectedOnly={project.exportSelectedOnly}
          onExportSelectedOnly={(value) => setField('exportSelectedOnly', value)}
          maxBatchCost={project.maxBatchCost}
          onMaxBatchCost={(value) => setField('maxBatchCost', value)}
          master={project.master}
          onMaster={(next) => setField('master', next)}
          items={project.items}
          onItems={(next) => setField('items', next)}
          concurrency={project.concurrency}
          onConcurrency={(next) => setField('concurrency', next)}
        />
      )}

      {advanced && (
        <div className="columns">
          <div className="column">
            <SpecPanel spec={project.spec} onChange={setSpec} />
          </div>

          <div className="column column-center">
            <section className="panel panel-preview">
              <div className="preview-head">
                <h2>Preview</h2>
                <label className="toggle">
                  <input
                    type="checkbox"
                    checked={showGuides}
                    onChange={(event) => setShowGuides(event.target.checked)}
                  />
                  Contour guides
                </label>
              </div>
              <Preview
                spec={project.spec}
                compose={project.compose}
                layers={layers}
                showGuides={showGuides}
              />

              <div className="style-grid">
                <label className="field">
                  <span className="field-label">Base</span>
                  <input
                    type="color"
                    value={project.compose.baseColor}
                    onChange={(event) => setCompose({ baseColor: event.target.value })}
                  />
                </label>
                <label className="field">
                  <span className="field-label">Rim</span>
                  <input
                    type="color"
                    value={project.compose.rimColor}
                    onChange={(event) => setCompose({ rimColor: event.target.value })}
                  />
                </label>
                <label className="field">
                  <span className="field-label">
                    Rim width <b>{project.compose.rimWidth}</b>
                  </span>
                  <input
                    type="range"
                    min={0}
                    max={24}
                    value={project.compose.rimWidth}
                    onChange={(event) => setCompose({ rimWidth: Number(event.target.value) })}
                  />
                </label>
                <label className="field">
                  <span className="field-label">
                    Shadow <b>{project.compose.shadowBlur}</b>
                  </span>
                  <input
                    type="range"
                    min={0}
                    max={120}
                    value={project.compose.shadowBlur}
                    onChange={(event) => setCompose({ shadowBlur: Number(event.target.value) })}
                  />
                </label>
              </div>
            </section>

            <TracePanel
              spec={project.spec}
              onApply={(next) => setSpec(next)}
              onMaster={(next) => setField('master', next)}
              onDescribe={(described) => {
                setField('materialDescription', described.material);
                setCompose({ baseColor: described.baseColor });
              }}
            />
            <DriftLab spec={project.spec} />
            <MeasurePanel onApply={setSpec} />
          </div>

          <div className="column">
            <GeneratePanel
              spec={project.spec}
              model={project.model}
              quality={project.quality}
              onQuality={(value) => setField('quality', value)}
              wantAlpha={project.glyphTransparency}
              onWantAlpha={(value) => setField('glyphTransparency', value)}
              master={project.master?.dataUrl ?? null}
              materialDescription={project.materialDescription}
              glyphSubject={project.glyphSubject}
              glyphStyle={project.glyphStyle}
              onModel={(value) => setField('model', value)}
              onMaterialDescription={(value) => setField('materialDescription', value)}
              onGlyphSubject={(value) => setField('glyphSubject', value)}
              onGlyphStyle={(value) => setField('glyphStyle', value)}
              onMaterial={store.setMaterial}
              onGlyph={store.setGlyph}
            />
            <DeterminismPanel spec={project.spec} compose={project.compose} layers={layers} />
            <ExportPanel spec={project.spec} compose={project.compose} layers={layers} />
          </div>
        </div>
      )}
    </div>
  );
}
