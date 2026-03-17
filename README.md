# FoxDev Gif Maker

FoxDev Gif Maker is a Node.js + React app for turning sprite sheets or ordered image sequences into animated GIF and animated WebP files.

## Features

- Auto-analyzes sprite sheets and suggests a grid from visible frame content.
- Manual sequence mode with drag and drop ordering.
- Exports both GIF and animated WebP in one step.
- Lets you tune frame width, height, offsets, gaps, frame count, traversal order, loop count, and delay.
- Minimal React UI with live grid overlay and frame previews.

## Stack

- Node.js
- Express
- React
- Vite
- Sharp
- GIFEncoder

## Install

```bash
npm install
```

## Run

Build the frontend and start the app:

```bash
npm run build
npm run start
```

Open `http://localhost:3000`.

## Development

Server:

```bash
npm run dev:server
```

Client:

```bash
npm run dev:client
```

The Vite dev server proxies `/api` to `http://localhost:3000`.

## Usage

### Sprite sheet mode

1. Upload a sprite sheet.
2. Click `Autodetectar` if you want to re-run detection.
3. Adjust frame width, height, rows, columns, offsets, gaps, and frame count if needed.
4. Export to generate GIF and WebP.

### Manual frames mode

1. Drop multiple images into the manual area.
2. Reorder the sequence by dragging the frame cards.
3. Set delay, loop, and quality.
4. Export to generate GIF and WebP.

## Notes

- Auto detection works best with transparent backgrounds or clear spacing between frames.
- If a sprite sheet uses a strict grid without empty gutters, use the detected values as a starting point and adjust them manually.
- Manual mode normalizes frames to a shared canvas size before export.
