import type { initEpubFile } from '@lingo-reader/epub-parser';

// Epub型をinitEpubFileの返り値の型として定義
export type EpubInstance = Awaited<ReturnType<typeof initEpubFile>>;
type NavPoint = ReturnType<EpubInstance['getToc']>[number];
// 入れ子の目次を平坦化した項目。depth は階層の深さ（最上位が0）
// key は目次の並び順から作る一意な値（同一ファイル内アンカーの項目は id が重複するため）
export type TocItem = NavPoint & { depth: number; key: string };
export type ChapterText = { title: string; text: string };
// 選択の単位となる大項目。key は大項目自身の TocItem の key、children は配下の目次項目（文書順）
export type TocGroup = { key: string; label: string; depth: number; children: TocItem[] };
// 大項目ごとのテキスト。chapterTexts は大項目自身と配下の目次項目のうち本文があるもの
export type GroupText = { key: string; title: string; chapterTexts: ChapterText[] };
type KeyedChapterText = ChapterText & { key: string };

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

// 大項目とみなす階層。トップレベルが1件だけ（本のタイトルなど）で配下がある場合は1段下を大項目にする
const getGroupDepth = (tocItems: TocItem[]): number => {
  const topLevelCount = tocItems.filter((item) => item.depth === 0).length;
  const hasNested = tocItems.some((item) => item.depth > 0);
  return topLevelCount === 1 && hasNested ? 1 : 0;
};

// 平坦化した目次を大項目ごとにまとめる。大項目より浅い項目（本のタイトルなど）は含めない
export const buildTocGroups = (tocItems: TocItem[]): TocGroup[] => {
  const groupDepth = getGroupDepth(tocItems);
  const groups: TocGroup[] = [];
  for (const item of tocItems) {
    if (item.depth < groupDepth) continue;
    if (item.depth === groupDepth) {
      groups.push({ key: item.key, label: item.label.trim(), depth: item.depth, children: [] });
      continue;
    }
    groups.at(-1)?.children.push(item);
  }
  return groups;
};

const groupItemKeys = (group: TocGroup): string[] => [group.key, ...group.children.map((child) => child.key)];

// href の # 以降（アンカー）を取り出す。無ければ null
export const getAnchor = (href: string): string | null => {
  const hashIndex = href.indexOf('#');
  if (hashIndex === -1) return null;
  const anchor = href.slice(hashIndex + 1);
  return anchor.length > 0 ? anchor : null;
};

const extractKeyedChapterTexts = async (epub: EpubInstance, selectedTocKeys: string[]): Promise<KeyedChapterText[]> => {
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

  const chapterTexts: KeyedChapterText[] = [];
  // 現在読み進めている目次項目の章（目次に到達する前は null）
  let currentChapter: { key: string; title: string; selected: boolean; text: string } | null = null;

  const appendText = (text: string) => {
    const trimmed = text.trim();
    if (!currentChapter?.selected || trimmed.length === 0) return;
    currentChapter.text += `${trimmed}\n`;
  };

  const flushChapter = () => {
    if (!currentChapter?.selected) return;
    const text = currentChapter.text.trim();
    if (text.length === 0) return;
    chapterTexts.push({ key: currentChapter.key, title: currentChapter.title, text });
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
      currentChapter = { key: item.key, title: item.label.trim(), selected: selectedKeySet.has(item.key), text: '' };
      appendText(textBetween(element, starts[index + 1]?.element ?? null));
    }
  }

  flushChapter();

  return chapterTexts;
};

export const extractSelectedChapterTexts = async (
  epub: EpubInstance,
  selectedTocKeys: string[]
): Promise<ChapterText[]> =>
  (await extractKeyedChapterTexts(epub, selectedTocKeys)).map(({ title, text }) => ({ title, text }));

// 選択した大項目ごとに、配下を含むテキストを取り出す。本文が無い大項目は含めない
export const extractSelectedGroupTexts = async (
  epub: EpubInstance,
  groups: TocGroup[],
  selectedGroupKeys: string[]
): Promise<GroupText[]> => {
  const selectedGroupKeySet = new Set(selectedGroupKeys);
  const selectedGroups = groups.filter((group) => selectedGroupKeySet.has(group.key));
  const keyedTexts = await extractKeyedChapterTexts(epub, selectedGroups.flatMap(groupItemKeys));

  return selectedGroups
    .map((group) => {
      const itemKeySet = new Set(groupItemKeys(group));
      const chapterTexts = keyedTexts
        .filter((ct) => itemKeySet.has(ct.key))
        .map(({ title, text }) => ({ title, text }));
      return { key: group.key, title: group.label, chapterTexts };
    })
    .filter((groupText) => groupText.chapterTexts.length > 0);
};

// 章ごとのテキストを見出し付きで1つのテキストにまとめる
export const combineChapterTexts = (chapterTexts: ChapterText[]): string =>
  chapterTexts
    .map((ct) => `--- ${ct.title} ---\n${ct.text}`)
    .join('\n\n')
    .trim();
