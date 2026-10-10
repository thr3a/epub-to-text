import type { initEpubFile } from '@lingo-reader/epub-parser';

// Epub型をinitEpubFileの返り値の型として定義
export type EpubInstance = Awaited<ReturnType<typeof initEpubFile>>;
type NavPoint = ReturnType<EpubInstance['getToc']>[number];
// 入れ子の目次を平坦化した項目。depth は階層の深さ（最上位が0）
// key は目次の並び順から作る一意な値（同一ファイル内アンカーの項目は id が重複するため）
export type TocItem = NavPoint & { depth: number; key: string };
export type ChapterText = { title: string; text: string };

export const sanitizeFileName = (value: string): string => {
  const trimmed = value.trim();
  if (trimmed.length === 0) return 'chapter';
  return trimmed
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, ' ')
    .slice(0, 120);
};

// 入れ子の目次（children）を再帰的に平坦化する
const flattenToc = (items: NavPoint[], depth = 0): Omit<TocItem, 'key'>[] =>
  items.flatMap((item) => [{ ...item, depth }, ...flattenToc(item.children ?? [], depth + 1)]);

export const buildTocItems = (toc: NavPoint[]): TocItem[] =>
  flattenToc(toc).map((item, index) => ({ ...item, key: String(index) }));

// href の # 以降（アンカー）を取り出す。無ければ null
export const getAnchor = (href: string): string | null => {
  const hashIndex = href.indexOf('#');
  if (hashIndex === -1) return null;
  const anchor = href.slice(hashIndex + 1);
  return anchor.length > 0 ? anchor : null;
};

export const extractSelectedChapterTexts = async (
  epub: EpubInstance,
  selectedTocKeys: string[]
): Promise<ChapterText[]> => {
  const parser = new DOMParser();
  const spine = epub.getSpine();
  const tocItems = buildTocItems(epub.getToc());
  const selectedKeySet = new Set(selectedTocKeys);

  // spine の id ごとに、そのファイルを指す目次項目をまとめる
  const tocItemsBySpineId = new Map<string, TocItem[]>();
  for (const item of tocItems) {
    if (!item.id) continue;
    tocItemsBySpineId.set(item.id, [...(tocItemsBySpineId.get(item.id) ?? []), item]);
  }

  const chapterTexts: ChapterText[] = [];
  // 現在読み進めている目次項目の章（目次に到達する前は null）
  let currentChapter: { title: string; selected: boolean; text: string } | null = null;

  const appendText = (text: string) => {
    const trimmed = text.trim();
    if (!currentChapter?.selected || trimmed.length === 0) return;
    currentChapter.text += `${trimmed}\n`;
  };

  const flushChapter = () => {
    if (!currentChapter?.selected) return;
    const text = currentChapter.text.trim();
    if (text.length === 0) return;
    chapterTexts.push({ title: currentChapter.title, text });
  };

  for (const spineItem of spine) {
    const itemsInFile = tocItemsBySpineId.get(spineItem.id) ?? [];
    // 目次に無いファイルで、かつ未選択の章の途中なら読み込み不要
    if (itemsInFile.length === 0 && !currentChapter?.selected) continue;

    const chapterData = await epub.loadChapter(spineItem.id);
    const doc = parser.parseFromString(chapterData?.html ?? '', 'text/html');

    // 各目次項目の開始位置（アンカー要素。見つからなければファイル先頭）を文書順に並べる
    const starts = itemsInFile
      .map((item) => {
        const anchor = getAnchor(item.href);
        return { item, element: anchor ? doc.getElementById(anchor) : null };
      })
      .sort((a, b) => {
        if (!a.element) return b.element ? -1 : 0;
        if (!b.element) return 1;
        return a.element.compareDocumentPosition(b.element) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
      });

    // start から end（null ならファイル末尾）までのテキストを取り出す
    const textBetween = (start: Element | null, end: Element | null): string => {
      const range = doc.createRange();
      range.selectNodeContents(doc.body);
      if (start) range.setStartBefore(start);
      if (end) range.setEndBefore(end);
      return range.toString();
    };

    // 目次項目が無いファイルは丸ごと、直前の章の続き
    if (starts.length === 0) {
      appendText(textBetween(null, null));
      continue;
    }

    // 最初の目次項目がアンカー指定なら、それより前の部分は直前の章の続き
    const firstElement = starts[0].element;
    if (firstElement) appendText(textBetween(null, firstElement));

    for (const [index, { item, element }] of starts.entries()) {
      flushChapter();
      currentChapter = { title: item.label.trim(), selected: selectedKeySet.has(item.key), text: '' };
      appendText(textBetween(element, starts[index + 1]?.element ?? null));
    }
  }

  flushChapter();

  return chapterTexts;
};

// 章ごとのテキストを見出し付きで1つのテキストにまとめる
export const combineChapterTexts = (chapterTexts: ChapterText[]): string =>
  chapterTexts
    .map((ct) => `--- ${ct.title} ---\n${ct.text}`)
    .join('\n\n')
    .trim();
