import express from 'express';
import multer from 'multer';
import sharp from 'sharp';
import GIFEncoder from 'gifencoder';
import { createWriteStream, existsSync } from 'node:fs';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

type TraversalOrder = 'row-major' | 'column-major';

interface GridSettings {
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
}

interface ImageSize {
  width: number;
  height: number;
}

interface Pixel {
  r: number;
  g: number;
  b: number;
  alpha: number;
}

interface DecodedImage {
  data: Uint8Array;
  info: ImageSize;
}

interface FrameRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface AnimationOptions {
  delay: number;
  loop: number;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const distDir = path.join(__dirname, 'dist');
const outputsDir = path.join(__dirname, 'outputs');
const indexFile = path.join(distDir, 'index.html');

await mkdir(outputsDir, { recursive: true });

const app = express();
const port = Number(process.env.PORT) || 3000;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 30 * 1024 * 1024,
    files: 300,
  },
});

app.use(express.json({ limit: '2mb' }));
app.use('/outputs', express.static(outputsDir, { maxAge: '1h' }));

if (existsSync(distDir)) {
  app.use(express.static(distDir));
}

app.get('/api/health', (_req: any, res: any) => {
  res.json({ ok: true });
});

app.post('/api/analyze-sprite', upload.single('sprite'), async (req: any, res: any) => {
  if (!req.file) {
    res.status(400).json({ error: 'Sprite sheet is required.' });
    return;
  }

  const analysis = await analyzeSpriteSheet(req.file.buffer);
  res.json(analysis);
});

app.post(
  '/api/export',
  upload.fields([
    { name: 'sprite', maxCount: 1 },
    { name: 'frames', maxCount: 300 },
  ]),
  async (req: any, res: any) => {
    const mode = req.body.mode;
    const delay = clampInteger(req.body.delay, 90, 10, 10_000);
    const loop = clampInteger(req.body.loop, 0, 0, 65_535);
    const quality = clampInteger(req.body.quality, 84, 1, 100);
    const files = req.files ?? {};

    let frames: Buffer[] = [];
    let summary: Record<string, unknown> = {};

    if (mode === 'sprite') {
      const sprite = files.sprite?.[0];
      if (!sprite) {
        res.status(400).json({ error: 'Sprite sheet is required.' });
        return;
      }

      const grid = parseGrid(req.body.grid);
      const skipEmptyCells = toBoolean(req.body.skipEmptyCells, true);
      const extraction = await extractFramesFromSprite(sprite.buffer, grid, skipEmptyCells);
      frames = extraction.frames;
      summary = {
        source: 'sprite',
        image: extraction.image,
        exportedFrames: extraction.frames.length,
        grid: extraction.grid,
      };
    } else if (mode === 'manual') {
      const manualFrames = files.frames ?? [];
      if (manualFrames.length === 0) {
        res.status(400).json({ error: 'At least one frame is required.' });
        return;
      }

      const normalized = await normalizeManualFrames(manualFrames.map((file) => file.buffer));
      frames = normalized.frames;
      summary = {
        source: 'manual',
        exportedFrames: normalized.frames.length,
        frameSize: {
          width: normalized.width,
          height: normalized.height,
        },
      };
    } else {
      res.status(400).json({ error: 'Unsupported export mode.' });
      return;
    }

    if (frames.length === 0) {
      res.status(400).json({ error: 'No frames could be extracted with the current settings.' });
      return;
    }

    const jobId = `${Date.now()}-${randomUUID().slice(0, 8)}`;
    const gifName = `${jobId}.gif`;
    const webpName = `${jobId}.webp`;
    const gifPath = path.join(outputsDir, gifName);
    const webpPath = path.join(outputsDir, webpName);

    await exportGif(frames, gifPath, { delay, loop });
    await sharp(gifPath, { animated: true })
      .webp({ quality, effort: 5, loop, delay })
      .toFile(webpPath);

    res.json({
      ok: true,
      outputs: {
        gifUrl: `/outputs/${gifName}`,
        webpUrl: `/outputs/${webpName}`,
      },
      summary: {
        ...summary,
        delay,
        loop,
        quality,
      },
    });
  },
);

if (existsSync(indexFile)) {
  app.get(/^(?!\/api|\/outputs).*/, async (_req: any, res: any) => {
    res.type('html').send(await readFile(indexFile, 'utf8'));
  });
} else {
  app.get('/', (_req: any, res: any) => {
    res
      .type('text/plain')
      .send('Frontend build not found. Run "npm run build" and restart the server.');
  });
}

app.use((error: any, _req: any, res: any, _next: any) => {
  console.error(error);
  const message = error?.message || 'Unexpected server error.';
  res.status(500).json({ error: message });
});

app.listen(port, () => {
  console.log(`FoxDev Gif Maker running at http://localhost:${port}`);
});

function clampInteger(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(Math.max(parsed, min), max);
}

function toBoolean(value: unknown, fallback = false): boolean {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'string') {
    return value === 'true';
  }
  return fallback;
}

function parseGrid(value: unknown): GridSettings {
  const raw = typeof value === 'string' ? JSON.parse(value) : value;

  if (!raw || typeof raw !== 'object') {
    throw new Error('Grid settings are required.');
  }

  return {
    frameWidth: clampInteger(raw.frameWidth, 64, 1, 8_192),
    frameHeight: clampInteger(raw.frameHeight, 64, 1, 8_192),
    columns: clampInteger(raw.columns, 1, 1, 1_000),
    rows: clampInteger(raw.rows, 1, 1, 1_000),
    offsetX: clampInteger(raw.offsetX, 0, 0, 8_192),
    offsetY: clampInteger(raw.offsetY, 0, 0, 8_192),
    gapX: clampInteger(raw.gapX, 0, 0, 8_192),
    gapY: clampInteger(raw.gapY, 0, 0, 8_192),
    frameCount: clampInteger(raw.frameCount, raw.columns * raw.rows || 1, 1, 100_000),
    order: raw.order === 'column-major' ? 'column-major' : 'row-major',
  };
}

async function analyzeSpriteSheet(buffer: Buffer) {
  const decoded = await decodeImage(buffer);
  const detected = detectGrid(decoded);

  return {
    image: {
      width: decoded.info.width,
      height: decoded.info.height,
    },
    detection: detected.detection,
    grid: detected.grid,
    frames: detected.frames,
  };
}

async function extractFramesFromSprite(buffer: Buffer, grid: GridSettings, skipEmptyCells: boolean) {
  const decoded = await decodeImage(buffer);
  const image = { width: decoded.info.width, height: decoded.info.height };
  const allRects = buildGridRects(image, grid);

  const rects = skipEmptyCells
    ? allRects.filter((rect) => getRectOccupancy(decoded, rect) > 0.015)
    : allRects;

  if (rects.length === 0) {
    return { frames: [], image, grid };
  }

  const frames = await Promise.all(
    rects.map((rect) =>
      sharp(buffer)
        .extract(rect)
        .png()
        .toBuffer(),
    ),
  );

  return { frames, image, grid };
}

async function normalizeManualFrames(buffers: Buffer[]) {
  const prepared = await Promise.all(
    buffers.map(async (buffer) => {
      const image = sharp(buffer).ensureAlpha();
      const metadata = await image.metadata();
      const pngBuffer = await image.png().toBuffer();

      return {
        buffer: pngBuffer,
        width: metadata.width ?? 1,
        height: metadata.height ?? 1,
      };
    }),
  );

  const width = Math.max(...prepared.map((frame) => frame.width));
  const height = Math.max(...prepared.map((frame) => frame.height));

  const frames = await Promise.all(
    prepared.map((frame) => {
      const left = Math.floor((width - frame.width) / 2);
      const top = Math.floor((height - frame.height) / 2);

      return sharp({
        create: {
          width,
          height,
          channels: 4,
          background: { r: 0, g: 0, b: 0, alpha: 0 },
        },
      })
        .composite([{ input: frame.buffer, left, top }])
        .png()
        .toBuffer();
    }),
  );

  return { frames, width, height };
}

async function exportGif(frameBuffers: Buffer[], outputPath: string, options: AnimationOptions) {
  const first = await sharp(frameBuffers[0]).metadata();
  const width = first.width ?? 1;
  const height = first.height ?? 1;

  const encoder = new GIFEncoder(width, height);
  const stream = encoder.createReadStream();
  const file = createWriteStream(outputPath);

  const completed = new Promise((resolve, reject) => {
    file.on('finish', resolve);
    file.on('error', reject);
    stream.on('error', reject);
  });

  stream.pipe(file);
  encoder.start();
  encoder.setRepeat(options.loop === 0 ? 0 : options.loop);
  encoder.setDelay(options.delay);
  encoder.setQuality(10);

  for (const frameBuffer of frameBuffers) {
    const rgbaFrame = await sharp(frameBuffer)
      .ensureAlpha()
      .raw()
      .toBuffer();
    encoder.addFrame(rgbaFrame);
  }

  encoder.finish();
  await completed;
}

async function decodeImage(buffer: Buffer): Promise<DecodedImage> {
  const { data, info } = await sharp(buffer)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  return { data, info };
}

function detectGrid(decoded: DecodedImage) {
  const width = decoded.info.width;
  const height = decoded.info.height;
  const background = inferBackground(decoded);
  const foreground = buildForegroundMap(decoded, background);

  const columnActivity = Array.from({ length: width }, (_, x) => {
    let score = 0;
    for (let y = 0; y < height; y += 1) {
      if (foreground[y * width + x]) {
        score += 1;
      }
    }
    return score;
  });

  const rowActivity = Array.from({ length: height }, (_, y) => {
    let score = 0;
    for (let x = 0; x < width; x += 1) {
      if (foreground[y * width + x]) {
        score += 1;
      }
    }
    return score;
  });

  const columnRuns = detectRuns(columnActivity, Math.max(1, Math.floor(height * 0.04)));
  const rowRuns = detectRuns(rowActivity, Math.max(1, Math.floor(width * 0.04)));

  let grid;
  let method = 'content-bounds';
  let confidence = 'medium';

  if (columnRuns.length > 0 && rowRuns.length > 0) {
    grid = deriveGridFromRuns(width, height, columnRuns, rowRuns);
  }

  if (!grid) {
    grid = inferStripGrid(width, height);
    if (grid) {
      method = 'strip-inference';
      confidence = 'low';
    }
  }

  if (!grid) {
    grid = {
      frameWidth: width,
      frameHeight: height,
      columns: 1,
      rows: 1,
      offsetX: 0,
      offsetY: 0,
      gapX: 0,
      gapY: 0,
      frameCount: 1,
      order: 'row-major',
    };
    method = 'single-frame-fallback';
    confidence = 'low';
  } else if (grid.columns * grid.rows > 1) {
    confidence = grid.columns > 1 || grid.rows > 1 ? 'high' : confidence;
  }

  const frames = buildGridRects({ width, height }, grid).map((rect, index) => ({
    index,
    ...rect,
    occupied: Number(getRectOccupancy(decoded, rect).toFixed(3)),
  }));

  return {
    detection: {
      method,
      confidence,
      occupiedFrames: frames.filter((frame) => frame.occupied > 0.015).length,
      message:
        method === 'content-bounds'
          ? 'Detected frame bounds from visible content.'
          : method === 'strip-inference'
            ? 'Guessed a strip layout from image proportions.'
            : 'Using the whole image as a single frame.',
      background,
    },
    grid,
    frames,
  };
}

function inferBackground(decoded: DecodedImage): Pixel {
  const { data, info } = decoded;
  const corners = [
    readPixel(data, info.width, 0, 0),
    readPixel(data, info.width, info.width - 1, 0),
    readPixel(data, info.width, 0, info.height - 1),
    readPixel(data, info.width, info.width - 1, info.height - 1),
  ];

  const transparentCorners = corners.filter((pixel) => pixel.alpha < 24);
  if (transparentCorners.length >= 2) {
    return { r: 0, g: 0, b: 0, alpha: 0 };
  }

  return {
    r: Math.round(corners.reduce((sum, pixel) => sum + pixel.r, 0) / corners.length),
    g: Math.round(corners.reduce((sum, pixel) => sum + pixel.g, 0) / corners.length),
    b: Math.round(corners.reduce((sum, pixel) => sum + pixel.b, 0) / corners.length),
    alpha: Math.round(corners.reduce((sum, pixel) => sum + pixel.alpha, 0) / corners.length),
  };
}

function readPixel(data: Uint8Array, width: number, x: number, y: number): Pixel {
  const index = (y * width + x) * 4;
  return {
    r: data[index],
    g: data[index + 1],
    b: data[index + 2],
    alpha: data[index + 3],
  };
}

function buildForegroundMap(decoded: DecodedImage, background: Pixel): Uint8Array {
  const { data, info } = decoded;
  const pixels = new Uint8Array(info.width * info.height);

  for (let index = 0; index < info.width * info.height; index += 1) {
    const offset = index * 4;
    const alpha = data[offset + 3];
    const delta =
      Math.abs(data[offset] - background.r) +
      Math.abs(data[offset + 1] - background.g) +
      Math.abs(data[offset + 2] - background.b) +
      Math.abs(alpha - background.alpha);

    pixels[index] = alpha > 24 && delta > 36 ? 1 : 0;
  }

  return pixels;
}

function detectRuns(activity: number[], threshold: number): Array<{ start: number; end: number }> {
  const runs: Array<{ start: number; end: number }> = [];
  let start = -1;

  for (let index = 0; index < activity.length; index += 1) {
    if (activity[index] > threshold && start === -1) {
      start = index;
    }

    if (activity[index] <= threshold && start !== -1) {
      runs.push({ start, end: index - 1 });
      start = -1;
    }
  }

  if (start !== -1) {
    runs.push({ start, end: activity.length - 1 });
  }

  return runs;
}

function deriveGridFromRuns(
  width: number,
  height: number,
  columnRuns: Array<{ start: number; end: number }>,
  rowRuns: Array<{ start: number; end: number }>,
): GridSettings | null {
  const columns = convertRunsToCells(columnRuns, width);
  const rows = convertRunsToCells(rowRuns, height);

  if (columns.length === 0 || rows.length === 0) {
    return null;
  }

  return {
    frameWidth: median(columns.map((cell) => cell.size)),
    frameHeight: median(rows.map((cell) => cell.size)),
    columns: columns.length,
    rows: rows.length,
    offsetX: columns[0].start,
    offsetY: rows[0].start,
    gapX: medianGap(columns),
    gapY: medianGap(rows),
    frameCount: columns.length * rows.length,
    order: 'row-major',
  };
}

function convertRunsToCells(
  runs: Array<{ start: number; end: number }>,
  axisSize: number,
): Array<{ start: number; size: number }> {
  return runs.map((run, index) => {
    const previousEdge = index === 0 ? 0 : Math.floor((runs[index - 1].end + run.start) / 2) + 1;
    const nextEdge =
      index === runs.length - 1 ? axisSize : Math.ceil((run.end + runs[index + 1].start) / 2);

    return {
      start: previousEdge,
      size: Math.max(1, nextEdge - previousEdge),
    };
  });
}

function median(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }

  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);

  if (sorted.length % 2 === 0) {
    return Math.round((sorted[middle - 1] + sorted[middle]) / 2);
  }

  return sorted[middle];
}

function medianGap(cells: Array<{ start: number; size: number }>): number {
  if (cells.length < 2) {
    return 0;
  }

  const gaps = [];
  for (let index = 1; index < cells.length; index += 1) {
    const previous = cells[index - 1];
    const current = cells[index];
    gaps.push(Math.max(0, current.start - (previous.start + previous.size)));
  }

  return median(gaps);
}

function inferStripGrid(width: number, height: number): GridSettings | null {
  if (width > height && width % height === 0) {
    return {
      frameWidth: height,
      frameHeight: height,
      columns: width / height,
      rows: 1,
      offsetX: 0,
      offsetY: 0,
      gapX: 0,
      gapY: 0,
      frameCount: width / height,
      order: 'row-major',
    };
  }

  if (height > width && height % width === 0) {
    return {
      frameWidth: width,
      frameHeight: width,
      columns: 1,
      rows: height / width,
      offsetX: 0,
      offsetY: 0,
      gapX: 0,
      gapY: 0,
      frameCount: height / width,
      order: 'column-major',
    };
  }

  return null;
}

function buildGridRects(image: ImageSize, grid: GridSettings): FrameRect[] {
  const rects: FrameRect[] = [];
  const maxFrames = Math.min(grid.frameCount, grid.columns * grid.rows);

  const pushRect = (column, row) => {
    const left = grid.offsetX + column * (grid.frameWidth + grid.gapX);
    const top = grid.offsetY + row * (grid.frameHeight + grid.gapY);

    if (left >= image.width || top >= image.height) {
      return;
    }

    const width = Math.min(grid.frameWidth, image.width - left);
    const height = Math.min(grid.frameHeight, image.height - top);

    if (width <= 0 || height <= 0) {
      return;
    }

    rects.push({ left, top, width, height });
  };

  if (grid.order === 'column-major') {
    for (let column = 0; column < grid.columns && rects.length < maxFrames; column += 1) {
      for (let row = 0; row < grid.rows && rects.length < maxFrames; row += 1) {
        pushRect(column, row);
      }
    }
  } else {
    for (let row = 0; row < grid.rows && rects.length < maxFrames; row += 1) {
      for (let column = 0; column < grid.columns && rects.length < maxFrames; column += 1) {
        pushRect(column, row);
      }
    }
  }

  return rects;
}

function getRectOccupancy(decoded: DecodedImage, rect: FrameRect): number {
  let occupied = 0;

  for (let y = rect.top; y < rect.top + rect.height; y += 1) {
    for (let x = rect.left; x < rect.left + rect.width; x += 1) {
      const pixel = readPixel(decoded.data, decoded.info.width, x, y);
      if (pixel.alpha > 24) {
        occupied += 1;
      }
    }
  }

  return occupied / (rect.width * rect.height);
}
