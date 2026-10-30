import { ChangeEvent, useEffect, useMemo, useState } from 'react';
import { useAppDispatch, useAppSelector } from '../hooks';
import { editorActions } from '../actions/editor';
import { parseGlyph, unparseGlyph, Glyph } from '../kageUtils/glyph';
import { makeGlyphSeparated } from '../kage';
import { downloadFont, downloadProject, downloadSvgArchive, FontProject, polygonsToSvg } from '../projectExport';
import styles from './ProjectManager.module.css';

const STORAGE_KEY = 'kage-editor-project-v1';

interface ProjectGlyph {
  char: string;
  source: string;
}

const cloneGlyph = (glyph: Glyph): Glyph => glyph.map((line) => ({ ...line, value: [...line.value] }));

const unicodeLabel = (char: string): string => {
  const codePoint = Array.from(char)[0]?.codePointAt(0);
  if (typeof codePoint === 'undefined') return char;
  const isPrivateUse = (codePoint >= 0xe000 && codePoint <= 0xf8ff)
    || (codePoint >= 0xf0000 && codePoint <= 0xffffd)
    || (codePoint >= 0x100000 && codePoint <= 0x10fffd);
  const isControl = codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f);
  if (!isPrivateUse && !isControl) return char;
  const width = codePoint <= 0xffff ? 4 : 6;
  return `U+${codePoint.toString(16).toUpperCase().padStart(width, '0')}`;
};

const parseUnicode = (value: string): number | null => {
  const normalized = value.trim().replace(/^U\+/i, '').replace(/^0x/i, '');
  if (!/^[0-9a-f]+$/i.test(normalized)) return null;
  const codePoint = Number.parseInt(normalized, 16);
  return Number.isInteger(codePoint) && codePoint >= 0 && codePoint <= 0x10ffff ? codePoint : null;
};

const ProjectManager = ({ className }: { className?: string }) => {
  const dispatch = useAppDispatch();
  const glyph = useAppSelector((state) => state.glyph);
  const buhinMap = useAppSelector((state) => state.buhinMap);
  const shotai = useAppSelector((state) => state.shotai);
  const [characterInput, setCharacterInput] = useState('');
  const [activeChar, setActiveChar] = useState<string | null>(null);
  const [unicodeStart, setUnicodeStart] = useState('E000');
  const [unicodeEnd, setUnicodeEnd] = useState('E01F');
  const [glyphs, setGlyphs] = useState<ProjectGlyph[]>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{"glyphs":[]}') as FontProject;
      return Array.isArray(saved.glyphs) ? saved.glyphs : [];
    } catch {
      return [];
    }
  });
  const [fontName, setFontName] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') as FontProject;
      return typeof saved.name === 'string' ? saved.name : 'KAGE Font';
    } catch {
      return 'KAGE Font';
    }
  });

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, name: fontName, glyphs }));
  }, [fontName, glyphs]);

  const persist = (next: ProjectGlyph[]) => setGlyphs(next);

  const saveCurrent = () => {
    const inputCharacters = Array.from(characterInput.trim()).filter((char) => !/\s/u.test(char));
    const characters = inputCharacters.length > 0 ? inputCharacters : (activeChar ? [activeChar] : []);
    if (characters.length === 0) {
      window.alert('Enter one or more characters, or select an existing glyph to save.');
      return;
    }
    const next = [...glyphs];
    characters.forEach((char) => {
      const index = next.findIndex((entry) => entry.char === char);
      const entry = { char, source: unparseGlyph(cloneGlyph(glyph)) };
      if (index >= 0) next[index] = entry;
      else next.push(entry);
    });
    persist(next);
  };

  const addEmptyGlyphs = () => {
    const characters = Array.from(characterInput.trim()).filter((char) => !/\s/u.test(char));
    if (characters.length === 0) {
      window.alert('Enter one or more characters to add.');
      return;
    }
    const next = [...glyphs];
    characters.forEach((char) => {
      if (!next.some((entry) => entry.char === char)) next.push({ char, source: '' });
    });
    persist(next);
  };

  const addUnicodeRange = () => {
    const start = parseUnicode(unicodeStart);
    const end = parseUnicode(unicodeEnd);
    if (start === null || end === null || end < start) {
      window.alert('Enter a valid Unicode range, for example E000 through E01F.');
      return;
    }
    if (end - start + 1 > 4096) {
      window.alert('Unicode ranges are limited to 4096 characters at a time.');
      return;
    }
    const next = [...glyphs];
    for (let codePoint = start; codePoint <= end; codePoint++) {
      const char = String.fromCodePoint(codePoint);
      if (!next.some((entry) => entry.char === char)) next.push({ char, source: '' });
    }
    persist(next);
  };

  const loadGlyph = (char: string, source: string) => {
    setActiveChar(char);
    setCharacterInput(char);
    dispatch(editorActions.setGlyph(parseGlyph(source)));
  };
  const deleteGlyph = (char: string) => {
    persist(glyphs.filter((entry) => entry.char !== char));
    if (activeChar === char) {
      setActiveChar(null);
      setCharacterInput('');
    }
  };

  const exportData = useMemo(() => glyphs.map((entry) => {
    try {
      return { ...entry, polygons: makeGlyphSeparated(parseGlyph(entry.source), buhinMap, shotai) };
    } catch (error) {
      console.error(`Could not render glyph ${entry.char}`, error);
      return { ...entry, polygons: [] };
    }
  }), [glyphs, buhinMap, shotai]);

  const exportSvgs = () => {
    try {
      void downloadSvgArchive(fontName, exportData.map((entry) => ({
        char: entry.char,
        svg: polygonsToSvg(entry.polygons),
      })));
    } catch (error) {
      console.error(error);
      window.alert('SVG export failed. Check the browser console for details.');
    }
  };

  const exportTtf = () => {
    try {
      downloadFont(fontName, exportData.map(({ char, polygons }) => ({ char, polygons })));
    } catch (error) {
      console.error(error);
      window.alert(error instanceof Error ? error.message : 'TTF export failed.');
    }
  };

  const importProject = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const data = JSON.parse(await file.text()) as FontProject;
      if (!Array.isArray(data.glyphs)) throw new Error('Invalid project');
      const imported = data.glyphs.filter((entry) => typeof entry.char === 'string' && typeof entry.source === 'string');
      persist(imported);
      setFontName(typeof data.name === 'string' ? data.name : 'KAGE Font');
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'Could not import project');
    }
    event.target.value = '';
  };

  return (
    <section className={`${styles.manager} ${className || ''}`}>
      <h2>Glyph project</h2>
      <label>
        Font name
        <input value={fontName} onChange={(event) => setFontName(event.target.value)} />
      </label>
      <label>
        Characters (paste as many characters as needed)
        <input value={characterInput} onChange={(event) => setCharacterInput(event.target.value)} placeholder="ABCあいう" />
      </label>
      <div className={styles.unicodeRange}>
        Unicode range
        <input aria-label="Unicode range start" value={unicodeStart} onChange={(event) => setUnicodeStart(event.target.value)} placeholder="E000" />
        <span>to</span>
        <input aria-label="Unicode range end" value={unicodeEnd} onChange={(event) => setUnicodeEnd(event.target.value)} placeholder="E01F" />
        <button onClick={addUnicodeRange}>Add Unicode range</button>
      </div>
      <div className={styles.buttons}>
        <button disabled={glyph.length === 0} onClick={saveCurrent}>Save current glyph</button>
        <button onClick={addEmptyGlyphs}>Add empty glyphs</button>
        <button disabled={!glyphs.length} onClick={exportSvgs}>Export SVG ZIP</button>
        <button disabled={!glyphs.length} onClick={exportTtf}>Export TTF</button>
        <button onClick={() => downloadProject({ version: 1, name: fontName, glyphs })}>Export project</button>
        <label className={styles.importButton}>Import project<input type="file" accept=".json,.kage.json" onChange={importProject} /></label>
      </div>
      <ul className={styles.glyphList}>
        {glyphs.map((entry) => (
          <li key={entry.char}>
            <button className={`${styles.charButton} ${activeChar === entry.char ? styles.activeChar : ''}`} onClick={() => loadGlyph(entry.char, entry.source)} title={`${entry.char} — Open in editor`}>{unicodeLabel(entry.char)}</button>
            <button onClick={() => { loadGlyph(entry.char, entry.source); }}>Edit</button>
            <button onClick={() => deleteGlyph(entry.char)}>Delete</button>
          </li>
        ))}
      </ul>
    </section>
  );
};

export default ProjectManager;
