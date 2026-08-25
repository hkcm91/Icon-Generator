import { useEffect, useMemo, useState } from 'react';
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
import Tutorial from './components/Tutorial';
import type { ComposeLayers } from './core/compose';
import { useImageStore } from './state/useImageStore';
import { useProject } from './state/useProject';

export default function App() {
  const { project, setSpec, setCompose, setField, reset } = useProject();
  const store = useImageStore();
  const [showGuides, setShowGuides] = useState(true);

  const { material, glyph } = store;
  const layers: ComposeLayers = useMemo(() => ({ material, glyph }), [material, glyph]);

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
          <h1>Icon Generator</h1>
          <p>
            {advanced
              ? 'Geometry is compiled. Material is generated. The two never negotiate.'
              : 'Pick a shape, describe the look, download every size.'}
          </p>
        </div>
        <div className="row row-tight">
          <ApiKeyBar />
          <button
            type="button"
            className={project.tutorial ? 'ghost ghost-on' : 'ghost'}
            aria-pressed={project.tutorial}
            onClick={() => setField('tutorial', !project.tutorial)}
          >
            Tutorial
          </button>
          <button
            type="button"
            className="ghost"
            onClick={() => setField('advanced', !advanced)}
          >
            {advanced ? 'Simple view' : 'All controls'}
          </button>
          <button
            type="button"
            className="ghost"
            onClick={() => {
              reset();
              // Reset means reset: leaving orphaned blobs behind would have the
              // next project silently inherit the last one's renders.
              store.clearAll();
            }}
          >
            Reset
          </button>
        </div>
      </header>

      {project.tutorial && <Tutorial onClose={() => setField('tutorial', false)} />}

      {!advanced && (
        <SimpleStudio
          spec={project.spec}
          compose={project.compose}
          layers={layers}
          model={project.model}
          visionModel={project.visionModel}
          material={project.materialDescription}
          glyph={project.glyphSubject}
          onSpec={setSpec}
          onCompose={setCompose}
          onMaterial={(value) => setField('materialDescription', value)}
          onGlyph={(value) => setField('glyphSubject', value)}
          onMaterialLayer={store.setMaterial}
          onGlyphLayer={store.setGlyph}
          materialLayer={material}
          glyphs={store.glyphs}
          onItemGlyph={store.setItemGlyph}
          onClearGlyphs={store.clearGlyphs}
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
