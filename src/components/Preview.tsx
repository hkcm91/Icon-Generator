import { useEffect, useRef } from 'react';
import { composeIcon, type ComposeLayers, type ComposeOptions } from '../core/compose';
import { containerPath, glyphSafePath } from '../core/geometry';
import type { ContainerSpec } from '../core/spec';

interface Props {
  spec: ContainerSpec;
  compose: ComposeOptions;
  layers: ComposeLayers;
  showGuides: boolean;
}

export default function Preview({ spec, compose, layers, showGuides }: Props) {
  const holder = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const node = holder.current;
    if (!node) return;

    const canvas = composeIcon(spec, layers, compose);
    canvas.className = 'preview-canvas';

    if (showGuides) {
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.save();
        ctx.lineWidth = Math.max(1, spec.size / 512);
        ctx.setLineDash([spec.size / 64, spec.size / 64]);
        ctx.strokeStyle = 'rgba(56, 189, 248, 0.9)';
        ctx.stroke(new Path2D(containerPath(spec)));
        ctx.strokeStyle = 'rgba(251, 191, 36, 0.9)';
        ctx.stroke(new Path2D(glyphSafePath(spec)));
        ctx.restore();
      }
    }

    node.replaceChildren(canvas);
  }, [spec, compose, layers, showGuides]);

  return <div className="preview" ref={holder} />;
}
