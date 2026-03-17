# FoxDev Gif Maker

FoxDev Gif Maker es una app en Node.js + React para convertir spritesheets o secuencias de imagenes ordenadas en GIF animado y WebP animado.

## Caracteristicas

- Analiza spritesheets y propone un grid a partir del contenido visible.
- Modo manual con orden de frames mediante drag and drop.
- Exporta GIF y WebP animado en una sola accion.
- Permite ajustar ancho y alto de frame, offsets, gaps, cantidad de frames, orden de lectura, loops y delay.
- UI minimalista en React con overlay del grid y preview de frames.

## Stack

- Node.js
- Express
- React
- Vite
- Sharp
- GIFEncoder

## Instalacion

```bash
npm install
```

## Ejecucion

Compila el frontend y levanta la app:

```bash
npm run build
npm run start
```

Abre `http://localhost:3000`.

## Desarrollo

Servidor:

```bash
npm run dev:server
```

Cliente:

```bash
npm run dev:client
```

El servidor de Vite hace proxy de `/api` hacia `http://localhost:3000`.

## Uso

### Modo spritesheet

1. Sube una spritesheet.
2. Pulsa `Autodetectar` si quieres recalcular el grid.
3. Ajusta ancho, alto, filas, columnas, offsets, gaps y cantidad de frames si hace falta.
4. Exporta para generar GIF y WebP.

### Modo manual

1. Suelta varias imagenes en la zona manual.
2. Reordena la secuencia arrastrando las tarjetas de frame.
3. Configura delay, loop y calidad.
4. Exporta para generar GIF y WebP.

## Notas

- La autodeteccion funciona mejor con fondos transparentes o con separacion clara entre frames.
- Si la spritesheet usa un grid muy cerrado, usa la deteccion como punto de partida y corrige los valores manualmente.
- El modo manual normaliza los frames a un tamaño comun antes de exportar.
