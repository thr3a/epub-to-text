import { strToU8, zipSync } from 'fflate';

// テスト用のダミーEPUB（EPUB2 / toc.ncx 形式）をメモリ上で組み立てる

export type DummyChapter = {
  id: string;
  href: string;
  body: string;
};

export type DummyNavPoint = {
  label: string;
  src: string;
  children?: DummyNavPoint[];
};

type CreateDummyEpubOptions = {
  title?: string;
  // spine の並び順でもある
  chapters: DummyChapter[];
  toc: DummyNavPoint[];
};

const containerXml = `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`;

const buildChapterXhtml = (chapter: DummyChapter): string => `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml">
<head><title>${chapter.id}</title></head>
<body>${chapter.body}</body>
</html>`;

const buildOpf = (title: string, chapters: DummyChapter[]): string => {
  const manifestItems = chapters
    .map((chapter) => `<item id="${chapter.id}" href="${chapter.href}" media-type="application/xhtml+xml"/>`)
    .join('\n    ');
  const spineItems = chapters.map((chapter) => `<itemref idref="${chapter.id}"/>`).join('\n    ');
  return `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="2.0" unique-identifier="bookid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>${title}</dc:title>
    <dc:identifier id="bookid">urn:uuid:dummy-epub</dc:identifier>
    <dc:language>ja</dc:language>
  </metadata>
  <manifest>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
    ${manifestItems}
  </manifest>
  <spine toc="ncx">
    ${spineItems}
  </spine>
</package>`;
};

const buildNcx = (title: string, toc: DummyNavPoint[]): string => {
  let playOrder = 0;
  const buildNavPoints = (points: DummyNavPoint[]): string =>
    points
      .map((point) => {
        playOrder += 1;
        return `<navPoint id="nav${playOrder}" playOrder="${playOrder}">
  <navLabel><text>${point.label}</text></navLabel>
  <content src="${point.src}"/>
  ${buildNavPoints(point.children ?? [])}
</navPoint>`;
      })
      .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head><meta name="dtb:uid" content="urn:uuid:dummy-epub"/></head>
  <docTitle><text>${title}</text></docTitle>
  <navMap>
${buildNavPoints(toc)}
  </navMap>
</ncx>`;
};

export const createDummyEpub = ({ title = 'ダミー本', chapters, toc }: CreateDummyEpubOptions): Uint8Array => {
  const chapterFiles = Object.fromEntries(
    chapters.map((chapter) => [`OEBPS/${chapter.href}`, strToU8(buildChapterXhtml(chapter))])
  );
  return zipSync({
    // mimetype は無圧縮で先頭に置くのが EPUB の仕様
    mimetype: [strToU8('application/epub+zip'), { level: 0 }],
    'META-INF/container.xml': strToU8(containerXml),
    'OEBPS/content.opf': strToU8(buildOpf(title, chapters)),
    'OEBPS/toc.ncx': strToU8(buildNcx(title, toc)),
    ...chapterFiles
  });
};
