import { startTransition, useState } from 'react';

type Mode = 'sprite' | 'manual';
type TraversalOrder = 'row-major' | 'column-major';

interface SpriteSettings {
  frameWidth: number;
  frameHeight: number;
  columns: number;
  rows: number;
  offsetX: number;
  offsetY: number;
  gapX: number;
  gapY: number;
  frameCount: number;
  order: TraversalOrder;
  skipEmptyCells: boolean;
}

interface ExportSettings {
  delay: number;
  loop: number;
  quality: number;
}

interface DetectionSummary {
  confidence: 'high' | 'medium' | 'low';
  method: string;
  occupiedFrames: number;
  message: string;
}

interface FrameRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface SpriteImage {
  width: number;
  height: number;
}

interface ManualFrame {
  id: string;
  file: File;
  url: string;
  name: string;
}

interface ExportResponse {
  outputs: {
    gifUrl: string;
    webpUrl: string;
  };
  summary: {
    exportedFrames: number;
    delay: number;
  };
}

const defaultSpriteSettings: SpriteSettings = {
  frameWidth: 64,
  frameHeight: 64,
  columns: 4,
  rows: 1,
  offsetX: 0,
  offsetY: 0,
  gapX: 0,
  gapY: 0,
  frameCount: 4,
  order: 'row-major',
  skipEmptyCells: true,
};

const defaultExportSettings: ExportSettings = {
  delay: 90,
  loop: 0,
  quality: 84,
};

function App() {
  const [mode, setMode] = useState<Mode>('sprite');
  const [spriteFile, setSpriteFile] = useState<File | null>(null);
  const [spriteUrl, setSpriteUrl] = useState('');
  const [spriteImage, setSpriteImage] = useState<SpriteImage>({ width: 0, height: 0 });
  const [spriteSettings, setSpriteSettings] = useState<SpriteSettings>(defaultSpriteSettings);
  const [detection, setDetection] = useState<DetectionSummary | null>(null);
  const [manualFrames, setManualFrames] = useState<ManualFrame[]>([]);
  const [draggedFrameId, setDraggedFrameId] = useState<string | null>(null);
  const [exportSettings, setExportSettings] = useState<ExportSettings>(defaultExportSettings);
  const [outputs, setOutputs] = useState<ExportResponse | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [error, setError] = useState('');

  const spriteRects = buildGridRects(spriteImage, spriteSettings);

  const visibleManualFrames = manualFrames.slice(0, 18);

  async function handleSpriteSelection(file: File | null | undefined) {
    if (!file) {
      return;
    }

    if (spriteUrl) {
      URL.revokeObjectURL(spriteUrl);
    }

    const nextUrl = URL.createObjectURL(file);
    setSpriteFile(file);
    setSpriteUrl(nextUrl);
    setOutputs(null);
    setError('');
    await analyzeSprite(file);
  }

  async function analyzeSprite(file: File) {
    setIsAnalyzing(true);
    setError('');

    try {
      const formData = new FormData();
      formData.append('sprite', file);

      const response = await fetch('/api/analyze-sprite', {
        method: 'POST',
        body: formData,
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Could not analyze the sprite sheet.');
      }

      startTransition(() => {
        setDetection(data.detection);
        setSpriteSettings((current) => ({
          ...current,
          ...data.grid,
          skipEmptyCells: current.skipEmptyCells,
        }));
      });
    } catch (analysisError: any) {
      setDetection(null);
      setError(analysisError.message);
    } finally {
      setIsAnalyzing(false);
    }
  }

  function handleSpriteInputChange(event) {
    const file = (event.target as HTMLInputElement).files?.[0];
    void handleSpriteSelection(file);
  }

  function handleManualInputChange(event) {
    appendManualFrames((event.target as HTMLInputElement).files);
  }

  function handleDropToManual(event) {
    event.preventDefault();
    appendManualFrames(event.dataTransfer.files);
  }

  function appendManualFrames(fileList: FileList | null | undefined) {
    const files = Array.from(fileList || []).filter((file) => file.type.startsWith('image/'));
    if (files.length === 0) {
      return;
    }

    const nextFrames = files.map((file) => ({
      id: makeId(),
      file,
      url: URL.createObjectURL(file),
      name: file.name,
    }));

    setManualFrames((current) => [...current, ...nextFrames]);
    setOutputs(null);
    setError('');
  }

  function removeManualFrame(frameId: string) {
    setManualFrames((current) => {
      const frame = current.find((entry) => entry.id === frameId);
      if (frame) {
        URL.revokeObjectURL(frame.url);
      }
      return current.filter((entry) => entry.id !== frameId);
    });
  }

  function clearManualFrames() {
    manualFrames.forEach((frame) => URL.revokeObjectURL(frame.url));
    setManualFrames([]);
    setOutputs(null);
  }

  function reorderFrames(targetId: string) {
    if (!draggedFrameId || draggedFrameId === targetId) {
      return;
    }

    setManualFrames((current) => {
      const sourceIndex = current.findIndex((entry) => entry.id === draggedFrameId);
      const targetIndex = current.findIndex((entry) => entry.id === targetId);

      if (sourceIndex === -1 || targetIndex === -1) {
        return current;
      }

      const next = [...current];
      const [moved] = next.splice(sourceIndex, 1);
      next.splice(targetIndex, 0, moved);
      return next;
    });
  }

  function updateSpriteSetting<Key extends keyof SpriteSettings>(key: Key, value: SpriteSettings[Key] | string) {
    setSpriteSettings((current) => ({
      ...current,
      [key]:
        typeof current[key] === 'number'
          ? Math.max(0, Number.parseInt(value || '0', 10) || 0)
          : value,
    }));
  }

  function updateExportSetting<Key extends keyof ExportSettings>(key: Key, value: string) {
    setExportSettings((current) => ({
      ...current,
      [key]: Math.max(0, Number.parseInt(value || '0', 10) || 0),
    }));
  }

  async function handleExport() {
    setIsExporting(true);
    setOutputs(null);
    setError('');

    try {
      const formData = new FormData();
      formData.append('mode', mode);
      formData.append('delay', String(exportSettings.delay));
      formData.append('loop', String(exportSettings.loop));
      formData.append('quality', String(exportSettings.quality));

      if (mode === 'sprite') {
        if (!spriteFile) {
          throw new Error('Select a sprite sheet first.');
        }

        formData.append('sprite', spriteFile);
        formData.append(
          'grid',
          JSON.stringify({
            frameWidth: spriteSettings.frameWidth,
            frameHeight: spriteSettings.frameHeight,
            columns: spriteSettings.columns,
            rows: spriteSettings.rows,
            offsetX: spriteSettings.offsetX,
            offsetY: spriteSettings.offsetY,
            gapX: spriteSettings.gapX,
            gapY: spriteSettings.gapY,
            frameCount: spriteSettings.frameCount,
            order: spriteSettings.order,
          }),
        );
        formData.append('skipEmptyCells', String(spriteSettings.skipEmptyCells));
      } else {
        if (manualFrames.length === 0) {
          throw new Error('Add at least one frame.');
        }

        manualFrames.forEach((frame) => {
          formData.append('frames', frame.file, frame.name);
        });
      }

      const response = await fetch('/api/export', {
        method: 'POST',
        body: formData,
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Could not export the animation.');
      }

      startTransition(() => {
        setOutputs(data);
      });
    } catch (exportError: any) {
      setError(exportError.message);
    } finally {
      setIsExporting(false);
    }
  }

  const canExport =
    !isExporting && ((mode === 'sprite' && spriteFile) || (mode === 'manual' && manualFrames.length > 0));

  return (
    <main className="shell">
      <section className="hero card">
        <div>
          <p className="eyebrow">Sprite to Motion</p>
          <h1>FoxDev Gif Maker</h1>
          <p className="hero-copy">
            Crea animaciones desde spritesheets autodetectados o desde frames sueltos con orden
            manual por drag and drop. Exporta GIF y WebP animado.
          </p>
        </div>

        <div className="hero-meta">
          <span>Node.js + Express</span>
          <span>React + Vite</span>
          <span>GIF + WebP</span>
        </div>
      </section>

      <section className="workspace">
        <div className="panel card">
          <div className="section-head">
            <div>
              <p className="eyebrow">Workflow</p>
              <h2>Fuente</h2>
            </div>
            <div className="mode-switch" role="tablist" aria-label="Modo de trabajo">
              <button
                type="button"
                className={mode === 'sprite' ? 'active' : ''}
                onClick={() => setMode('sprite')}
              >
                Spritesheet
              </button>
              <button
                type="button"
                className={mode === 'manual' ? 'active' : ''}
                onClick={() => setMode('manual')}
              >
                Frames manuales
              </button>
            </div>
          </div>

          {mode === 'sprite' ? (
            <>
              <label className="dropzone">
                <input type="file" accept="image/*" onChange={handleSpriteInputChange} />
                <span className="dropzone-title">Sube tu spritesheet</span>
                <span className="dropzone-copy">
                  PNG, WebP o cualquier imagen compatible. La app intenta detectar el grid y te deja
                  afinarlo.
                </span>
              </label>

              <div className="inline-actions">
                <button
                  type="button"
                  className="secondary"
                  onClick={() => spriteFile && analyzeSprite(spriteFile)}
                  disabled={!spriteFile || isAnalyzing}
                >
                  {isAnalyzing ? 'Analizando...' : 'Autodetectar'}
                </button>
                {detection ? (
                  <div className="pill-group">
                    <span className={`pill ${detection.confidence}`}>{detection.confidence}</span>
                    <span className="pill subtle">{detection.method}</span>
                    <span className="pill subtle">{detection.occupiedFrames} frames utiles</span>
                  </div>
                ) : null}
              </div>

              <div className="grid-form">
                <NumberField
                  label="Frame width"
                  value={spriteSettings.frameWidth}
                  onChange={(value) => updateSpriteSetting('frameWidth', value)}
                />
                <NumberField
                  label="Frame height"
                  value={spriteSettings.frameHeight}
                  onChange={(value) => updateSpriteSetting('frameHeight', value)}
                />
                <NumberField
                  label="Columns"
                  value={spriteSettings.columns}
                  onChange={(value) => updateSpriteSetting('columns', value)}
                />
                <NumberField
                  label="Rows"
                  value={spriteSettings.rows}
                  onChange={(value) => updateSpriteSetting('rows', value)}
                />
                <NumberField
                  label="Offset X"
                  value={spriteSettings.offsetX}
                  onChange={(value) => updateSpriteSetting('offsetX', value)}
                />
                <NumberField
                  label="Offset Y"
                  value={spriteSettings.offsetY}
                  onChange={(value) => updateSpriteSetting('offsetY', value)}
                />
                <NumberField
                  label="Gap X"
                  value={spriteSettings.gapX}
                  onChange={(value) => updateSpriteSetting('gapX', value)}
                />
                <NumberField
                  label="Gap Y"
                  value={spriteSettings.gapY}
                  onChange={(value) => updateSpriteSetting('gapY', value)}
                />
                <NumberField
                  label="Frame count"
                  value={spriteSettings.frameCount}
                  onChange={(value) => updateSpriteSetting('frameCount', value)}
                />

                <label className="field">
                  <span>Order</span>
                  <select
                    value={spriteSettings.order}
                  onChange={(event) =>
                    updateSpriteSetting('order', (event.target as HTMLSelectElement).value as TraversalOrder)
                  }
                  >
                    <option value="row-major">Row major</option>
                    <option value="column-major">Column major</option>
                  </select>
                </label>
              </div>

              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={spriteSettings.skipEmptyCells}
                  onChange={(event) => updateSpriteSetting('skipEmptyCells', event.target.checked)}
                />
                <span>Omitir celdas vacias al exportar</span>
              </label>
            </>
          ) : (
            <>
              <label
                className="dropzone manual"
                onDragOver={(event) => event.preventDefault()}
                onDrop={handleDropToManual}
              >
                <input type="file" accept="image/*" multiple onChange={handleManualInputChange} />
                <span className="dropzone-title">Arrastra frames aqui</span>
                <span className="dropzone-copy">
                  Puedes soltar varias imagenes. Luego reordena la secuencia arrastrando cada frame.
                </span>
              </label>

              <div className="inline-actions">
                <span className="pill subtle">{manualFrames.length} frames cargados</span>
                <button
                  type="button"
                  className="secondary"
                  onClick={clearManualFrames}
                  disabled={manualFrames.length === 0}
                >
                  Limpiar
                </button>
              </div>

              <div className="frame-strip">
                {manualFrames.length === 0 ? (
                  <div className="empty-state">No hay frames todavia.</div>
                ) : (
                  manualFrames.map((frame, index) => (
                    <article
                      key={frame.id}
                      className="frame-card"
                      draggable
                      onDragStart={() => setDraggedFrameId(frame.id)}
                      onDragOver={(event) => event.preventDefault()}
                      onDrop={() => reorderFrames(frame.id)}
                      onDragEnd={() => setDraggedFrameId(null)}
                    >
                      <img src={frame.url} alt={frame.name} />
                      <div className="frame-card-foot">
                        <span>{index + 1}</span>
                        <button type="button" onClick={() => removeManualFrame(frame.id)}>
                          Remove
                        </button>
                      </div>
                    </article>
                  ))
                )}
              </div>
            </>
          )}
        </div>

        <div className="panel card">
          <div className="section-head">
            <div>
              <p className="eyebrow">Preview</p>
              <h2>Salida</h2>
            </div>
          </div>

          <div className="export-grid">
            <NumberField
              label="Delay ms"
              value={exportSettings.delay}
              onChange={(value) => updateExportSetting('delay', value)}
            />
            <NumberField
              label="Loop"
              value={exportSettings.loop}
              onChange={(value) => updateExportSetting('loop', value)}
            />
            <NumberField
              label="WebP quality"
              value={exportSettings.quality}
              onChange={(value) => updateExportSetting('quality', value)}
            />
          </div>

          {mode === 'sprite' && spriteUrl ? (
            <div className="sprite-preview">
              <div className="sprite-stage">
                <img
                  src={spriteUrl}
                  alt="Sprite sheet preview"
                  onLoad={(event) =>
                    setSpriteImage({
                      width: event.currentTarget.naturalWidth,
                      height: event.currentTarget.naturalHeight,
                    })
                  }
                />
                {spriteImage.width > 0 ? (
                  <svg
                    className="overlay"
                    viewBox={`0 0 ${spriteImage.width} ${spriteImage.height}`}
                    preserveAspectRatio="none"
                  >
                    {spriteRects.map((rect, index) => (
                      <g key={`${rect.left}-${rect.top}-${index}`}>
                        <rect
                          x={rect.left}
                          y={rect.top}
                          width={rect.width}
                          height={rect.height}
                          rx="2"
                        />
                        <text x={rect.left + 6} y={rect.top + 16}>
                          {index + 1}
                        </text>
                      </g>
                    ))}
                  </svg>
                ) : null}
              </div>

              <div className="thumb-grid">
                {spriteRects.slice(0, 16).map((rect, index) => (
                  <div key={`${rect.left}-${rect.top}-${index}`} className="thumb">
                    <div
                      className="thumb-art"
                      style={{
                        width: `${rect.width}px`,
                        height: `${rect.height}px`,
                        backgroundImage: `url(${spriteUrl})`,
                        backgroundPosition: `-${rect.left}px -${rect.top}px`,
                        backgroundSize: `${spriteImage.width}px ${spriteImage.height}px`,
                      }}
                    />
                    <span>{index + 1}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {mode === 'manual' ? (
            <div className="thumb-grid manual-grid">
              {visibleManualFrames.length === 0 ? (
                <div className="empty-state">La secuencia manual aparecera aqui.</div>
              ) : (
                visibleManualFrames.map((frame, index) => (
                  <div key={frame.id} className="thumb manual-thumb">
                    <img src={frame.url} alt={frame.name} />
                    <span>{index + 1}</span>
                  </div>
                ))
              )}
            </div>
          ) : null}

          <button type="button" className="primary large" disabled={!canExport} onClick={handleExport}>
            {isExporting ? 'Exportando...' : 'Exportar GIF + WebP'}
          </button>

          {error ? <p className="error-banner">{error}</p> : null}

          {outputs ? (
            <div className="result-card">
              <div className="result-preview">
                <img src={outputs.outputs.webpUrl} alt="Animated result preview" />
              </div>
              <div className="result-copy">
                <p>Exportacion lista.</p>
                <div className="pill-group">
                  <span className="pill subtle">{outputs.summary.exportedFrames} frames</span>
                  <span className="pill subtle">{outputs.summary.delay} ms</span>
                </div>
                <div className="result-links">
                  <a href={outputs.outputs.gifUrl} download>
                    Download GIF
                  </a>
                  <a href={outputs.outputs.webpUrl} download>
                    Download WebP
                  </a>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </section>
    </main>
  );
}

function NumberField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (value: string) => void;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <input type="number" min="0" value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function buildGridRects(image: SpriteImage, settings: SpriteSettings): FrameRect[] {
  if (!image.width || !image.height) {
    return [];
  }

  const columns = Math.max(1, Number(settings.columns) || 1);
  const rows = Math.max(1, Number(settings.rows) || 1);
  const frameWidth = Math.max(1, Number(settings.frameWidth) || 1);
  const frameHeight = Math.max(1, Number(settings.frameHeight) || 1);
  const offsetX = Math.max(0, Number(settings.offsetX) || 0);
  const offsetY = Math.max(0, Number(settings.offsetY) || 0);
  const gapX = Math.max(0, Number(settings.gapX) || 0);
  const gapY = Math.max(0, Number(settings.gapY) || 0);
  const frameCount = Math.max(1, Number(settings.frameCount) || columns * rows);

  const rects = [];

  const pushRect = (column, row) => {
    const left = offsetX + column * (frameWidth + gapX);
    const top = offsetY + row * (frameHeight + gapY);

    if (left >= image.width || top >= image.height) {
      return;
    }

    rects.push({
      left,
      top,
      width: Math.min(frameWidth, image.width - left),
      height: Math.min(frameHeight, image.height - top),
    });
  };

  if (settings.order === 'column-major') {
    for (let column = 0; column < columns && rects.length < frameCount; column += 1) {
      for (let row = 0; row < rows && rects.length < frameCount; row += 1) {
        pushRect(column, row);
      }
    }
  } else {
    for (let row = 0; row < rows && rects.length < frameCount; row += 1) {
      for (let column = 0; column < columns && rects.length < frameCount; column += 1) {
        pushRect(column, row);
      }
    }
  }

  return rects;
}

function makeId() {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export default App;
