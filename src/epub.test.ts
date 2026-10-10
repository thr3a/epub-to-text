import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initEpubFile } from '@lingo-reader/epub-parser';
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';
import {
  buildTocItems,
  combineChapterTexts,
  type EpubInstance,
  extractSelectedChapterTexts,
  getAnchor,
  sanitizeFileName
} from './epub';
import { createDummyEpub, type DummyChapter, type DummyNavPoint } from './test/createDummyEpub';

// パーサが画像などのリソースを書き出す先。リポジトリを汚さないよう一時ディレクトリにする
let resourceDir = '';
const openedEpubs: EpubInstance[] = [];

beforeAll(() => {
  resourceDir = mkdtempSync(join(tmpdir(), 'epub-test-'));
});

afterEach(() => {
  for (const epub of openedEpubs.splice(0)) epub.destroy();
});

afterAll(() => {
  rmSync(resourceDir, { recursive: true, force: true });
});

const openEpub = async (chapters: DummyChapter[], toc: DummyNavPoint[]): Promise<EpubInstance> => {
  const epub = await initEpubFile(createDummyEpub({ chapters, toc }), resourceDir);
  openedEpubs.push(epub);
  return epub;
};

// 目次ラベルから TocItem の key を引く
const keysOf = (epub: EpubInstance, labels: string[]): string[] => {
  const tocItems = buildTocItems(epub.getToc());
  return labels.map((label) => {
    const found = tocItems.find((item) => item.label === label);
    if (!found) throw new Error(`目次に「${label}」がありません`);
    return found.key;
  });
};

const allKeysOf = (epub: EpubInstance): string[] => buildTocItems(epub.getToc()).map((item) => item.key);

// 表紙(目次なし) → 第1章 → 第2章(節あり) → 目次なしファイル → 第3章(アンカー開始) という構成
const sampleChapters: DummyChapter[] = [
  { id: 'cover', href: 'text/cover.xhtml', body: '<p>表紙テキスト</p>' },
  { id: 'ch1', href: 'text/ch1.xhtml', body: '<h1>第1章 はじまり</h1><p>第1章の本文。</p>' },
  {
    id: 'ch2',
    href: 'text/ch2.xhtml',
    body: [
      '<h1 id="ch2-top">第2章 なかほど</h1>',
      '<p>第2章の導入。</p>',
      '<h2 id="sec2-1">2.1 節その1</h2>',
      '<p>節その1の本文。</p>',
      '<h2 id="sec2-2">2.2 節その2</h2>',
      '<p>節その2の本文。</p>'
    ].join('')
  },
  { id: 'extra', href: 'text/extra.xhtml', body: '<p>目次に無いファイルの本文。</p>' },
  {
    id: 'ch3',
    href: 'text/ch3.xhtml',
    body: '<p>アンカー前の本文。</p><h1 id="ch3-top">第3章 おわり</h1><p>第3章の本文。</p>'
  }
];

const sampleToc: DummyNavPoint[] = [
  { label: '第1章', src: 'text/ch1.xhtml' },
  {
    label: '第2章',
    src: 'text/ch2.xhtml',
    children: [
      { label: '2.1 節その1', src: 'text/ch2.xhtml#sec2-1' },
      { label: '2.2 節その2', src: 'text/ch2.xhtml#sec2-2' }
    ]
  },
  { label: '第3章', src: 'text/ch3.xhtml#ch3-top' }
];

describe('sanitizeFileName', () => {
  test('ファイル名に使えない文字を _ に置き換える', () => {
    expect(sanitizeFileName('a\\b/c:d*e?f"g<h>i|j')).toBe('a_b_c_d_e_f_g_h_i_j');
  });

  test('連続する空白を1つにまとめ、前後の空白を除く', () => {
    expect(sanitizeFileName('  第1章 \n\t はじまり  ')).toBe('第1章 はじまり');
  });

  test('空文字・空白のみなら chapter になる', () => {
    expect(sanitizeFileName('')).toBe('chapter');
    expect(sanitizeFileName('   ')).toBe('chapter');
  });

  test('120文字に切り詰める', () => {
    expect(sanitizeFileName('あ'.repeat(200))).toHaveLength(120);
  });
});

describe('getAnchor', () => {
  test('# 以降を返す', () => {
    expect(getAnchor('epub:OEBPS/text/ch2.xhtml#sec2-1')).toBe('sec2-1');
  });

  test('# が無い・# の後が空なら null', () => {
    expect(getAnchor('epub:OEBPS/text/ch2.xhtml')).toBeNull();
    expect(getAnchor('epub:OEBPS/text/ch2.xhtml#')).toBeNull();
  });
});

describe('buildTocItems', () => {
  test('入れ子の目次を文書順に平坦化し、depth と一意な key を付ける', async () => {
    const epub = await openEpub(sampleChapters, sampleToc);
    const tocItems = buildTocItems(epub.getToc());

    expect(tocItems.map(({ label, depth, key, id }) => ({ label, depth, key, id }))).toEqual([
      { label: '第1章', depth: 0, key: '0', id: 'ch1' },
      { label: '第2章', depth: 0, key: '1', id: 'ch2' },
      { label: '2.1 節その1', depth: 1, key: '2', id: 'ch2' },
      { label: '2.2 節その2', depth: 1, key: '3', id: 'ch2' },
      { label: '第3章', depth: 0, key: '4', id: 'ch3' }
    ]);
  });
});

describe('extractSelectedChapterTexts', () => {
  test('全選択すると目次項目ごとにテキストが分割される', async () => {
    const epub = await openEpub(sampleChapters, sampleToc);
    const chapterTexts = await extractSelectedChapterTexts(epub, allKeysOf(epub));

    expect(chapterTexts).toEqual([
      { title: '第1章', text: '第1章 はじまり第1章の本文。' },
      { title: '第2章', text: '第2章 なかほど第2章の導入。' },
      { title: '2.1 節その1', text: '2.1 節その1節その1の本文。' },
      {
        title: '2.2 節その2',
        // 目次に無いファイルと、次章のアンカーより前の部分は直前の章の続きになる
        text: '2.2 節その2節その2の本文。\n目次に無いファイルの本文。\nアンカー前の本文。'
      },
      { title: '第3章', text: '第3章 おわり第3章の本文。' }
    ]);
  });

  test('最初の目次項目より前のファイル（表紙など）は含まれない', async () => {
    const epub = await openEpub(sampleChapters, sampleToc);
    const chapterTexts = await extractSelectedChapterTexts(epub, allKeysOf(epub));

    expect(chapterTexts.some((ct) => ct.text.includes('表紙テキスト'))).toBe(false);
  });

  test('選択した目次項目だけが返る', async () => {
    const epub = await openEpub(sampleChapters, sampleToc);
    const chapterTexts = await extractSelectedChapterTexts(epub, keysOf(epub, ['第1章', '2.1 節その1']));

    expect(chapterTexts).toEqual([
      { title: '第1章', text: '第1章 はじまり第1章の本文。' },
      { title: '2.1 節その1', text: '2.1 節その1節その1の本文。' }
    ]);
  });

  test('未選択の章に続く目次なしファイルやアンカー前の部分は含まれない', async () => {
    const epub = await openEpub(sampleChapters, sampleToc);
    const chapterTexts = await extractSelectedChapterTexts(epub, keysOf(epub, ['第3章']));

    expect(chapterTexts).toEqual([{ title: '第3章', text: '第3章 おわり第3章の本文。' }]);
  });

  test('何も選択しなければ空配列', async () => {
    const epub = await openEpub(sampleChapters, sampleToc);

    expect(await extractSelectedChapterTexts(epub, [])).toEqual([]);
  });

  test('目次の並びが文書順と異なっても、文書内の位置で区切られる', async () => {
    const epub = await openEpub(
      [
        { id: 'ch1', href: 'ch1.xhtml', body: '<h1 id="a">A見出し</h1><p>A本文</p><h1 id="b">B見出し</h1><p>B本文</p>' }
      ],
      [
        { label: 'B', src: 'ch1.xhtml#b' },
        { label: 'A', src: 'ch1.xhtml#a' }
      ]
    );
    const chapterTexts = await extractSelectedChapterTexts(epub, allKeysOf(epub));

    expect(chapterTexts).toEqual([
      { title: 'A', text: 'A見出しA本文' },
      { title: 'B', text: 'B見出しB本文' }
    ]);
  });

  test('存在しないアンカーを指す目次項目はファイル先頭から始まる扱いになる', async () => {
    const epub = await openEpub(
      [{ id: 'ch1', href: 'ch1.xhtml', body: '<p>前半</p><h1 id="b">後半見出し</h1><p>後半</p>' }],
      [
        { label: '前半', src: 'ch1.xhtml#missing' },
        { label: '後半', src: 'ch1.xhtml#b' }
      ]
    );
    const chapterTexts = await extractSelectedChapterTexts(epub, allKeysOf(epub));

    expect(chapterTexts).toEqual([
      { title: '前半', text: '前半' },
      { title: '後半', text: '後半見出し後半' }
    ]);
  });

  test('本文が空の章は結果に含まれない', async () => {
    const epub = await openEpub(
      [
        { id: 'empty', href: 'empty.xhtml', body: '<div>   </div>' },
        { id: 'ch1', href: 'ch1.xhtml', body: '<p>本文</p>' }
      ],
      [
        { label: '空の章', src: 'empty.xhtml' },
        { label: '第1章', src: 'ch1.xhtml' }
      ]
    );
    const chapterTexts = await extractSelectedChapterTexts(epub, allKeysOf(epub));

    expect(chapterTexts).toEqual([{ title: '第1章', text: '本文' }]);
  });

  test('目次ラベルの前後の空白は除かれる', async () => {
    const epub = await openEpub(
      [{ id: 'ch1', href: 'ch1.xhtml', body: '<p>本文</p>' }],
      [{ label: '  第1章  ', src: 'ch1.xhtml' }]
    );
    const chapterTexts = await extractSelectedChapterTexts(epub, allKeysOf(epub));

    expect(chapterTexts.map((ct) => ct.title)).toEqual(['第1章']);
  });
});

describe('combineChapterTexts', () => {
  test('章ごとに見出しを付けて空行区切りで連結する', () => {
    expect(
      combineChapterTexts([
        { title: '第1章', text: '本文1' },
        { title: '第2章', text: '本文2' }
      ])
    ).toBe('--- 第1章 ---\n本文1\n\n--- 第2章 ---\n本文2');
  });

  test('空配列なら空文字', () => {
    expect(combineChapterTexts([])).toBe('');
  });
});
