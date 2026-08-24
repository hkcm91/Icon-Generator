import { useMemo, useState } from 'react';
import DeterminismPanel from './components/DeterminismPanel';
import DriftLab from './components/DriftLab';
import ExportPanel from './components/ExportPanel';
import GeneratePanel from './components/GeneratePanel';
import Preview from './components/Preview';
import SpecPanel from './components/SpecPanel';
import type { ComposeLayers } from './core/compose';
import { useProject } from './state/useProject';

export default function App() {
  const { project, setSpec, setCompose, setField, reset } = useProject();
  const [material, setMaterial] = useState<CanvasImageSource | null>(null);
  const [glyph, setGlyph] = useState<CanvasImageSource | null>(null);
  const [showGuides, setShowGuides] = useState(true);

  const layers: ComposeLayers = useMemo(() => ({ material, glyph }), [material, glyph]);

  return (
    <div className="app">
      <header className="topbar">
        <div>
          <h1>Icon Generator</h1>
          <p>Geometry is compiled. Material is generated. The two never negotiate.</p>
        </div>
        <button type="button" className="ghost" onClick={reset}>
          Reset project
        </button>
      </header>

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

          <DriftLab spec={project.spec} />
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
            onMaterial={setMaterial}
            onGlyph={setGlyph}
          />
          <DeterminismPanel spec={project.spec} compose={project.compose} layers={layers} />
          <ExportPanel spec={project.spec} compose={project.compose} layers={layers} />
        </div>
      </div>
    </div>
  );
}
