import JSZip from 'jszip';
import * as opentype from 'opentype.js';
import { Polygons } from '@kurgm/kage-engine';

export interface ProjectGlyph {
  char: string;
  source: string;
}

export interface FontProject {
  version: 1;
  name: string;
  glyphs: ProjectGlyph[];
}

const downloadBlob = (blob: Blob, filename: string) => {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
};

export const polygonsToSvg = (polygons: Polygons[]): string => {
  const paths = polygons.flatMap((stroke) => stroke.array.map((polygon) =>
    polygon.array.map((point, index) => `${index === 0 ? 'M' : 'L'}${point.x} ${point.y}`).join(' ') + ' Z'
  ));
  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" width="200" height="200"><g fill="#000">${paths.map((path) => `<path d="${path}"/>`).join('')}</g></svg>`;
};

export const downloadSvgArchive = async (fontName: string, glyphs: { char: string; svg: string }[]) => {
  const zip = new JSZip();
  glyphs.forEach(({ char, svg }, index) => {
    const codePoint = char ? Array.from(char)[0]?.codePointAt(0) : undefined;
    let name = typeof codePoint === 'number'
      ? `U+${codePoint.toString(16).toUpperCase().padStart(4, '0')}`
      : `glyph-${index + 1}`;
    if (/[^A-Za-z0-9.+_-]/u.test(name)) name = `glyph-${index + 1}`;
    zip.file(`${name}.svg`, svg);
  });
  const blob = await zip.generateAsync({ type: 'blob' });
  downloadBlob(blob, `${fontName || 'glyphs'}.svg.zip`);
};

export const downloadProject = (project: FontProject) => {
  const blob = new Blob([JSON.stringify(project, null, 2)], { type: 'application/json' });
  downloadBlob(blob, `${project.name || 'kage-project'}.kage.json`);
};

export const downloadFont = (fontName: string, glyphs: { char: string; polygons: Polygons[] }[]) => {
  const fontGlyphs: opentype.Glyph[] = [
    new opentype.Glyph({ name: '.notdef', unicode: 0, advanceWidth: 1000, path: new opentype.Path() }),
  ];
  glyphs.forEach(({ char, polygons }) => {
    if (!char || char.length === 0) return;
    const codePoint = Array.from(char)[0].codePointAt(0);
    if (typeof codePoint === 'undefined') return;
    const path = new opentype.Path();
    polygons.forEach((stroke) => stroke.array.forEach((polygon) => {
      polygon.array.forEach((point, index) => {
        const x = Math.round(point.x * 5);
        const y = Math.round((200 - point.y) * 5);
        if (index === 0) path.moveTo(x, y);
        else path.lineTo(x, y);
      });
      path.close();
    }));
    fontGlyphs.push(new opentype.Glyph({
      name: `uni${codePoint.toString(16).toUpperCase()}`,
      unicode: codePoint,
      advanceWidth: 1000,
      path,
    }));
  });
  const font = new opentype.Font({
    familyName: fontName || 'KAGE Font',
    styleName: 'Regular',
    unitsPerEm: 1000,
    ascender: 800,
    descender: -200,
    glyphs: fontGlyphs,
  });
  downloadBlob(new Blob([font.toArrayBuffer()], { type: 'font/ttf' }), `${fontName || 'kage-font'}.ttf`);
};
