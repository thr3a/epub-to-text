import { initEpubFile } from '@lingo-reader/epub-parser';
import {
  Alert,
  Button,
  Checkbox,
  Container,
  FileInput,
  Flex,
  List,
  ListItem,
  Loader,
  Stack,
  Title
} from '@mantine/core';
import { createFormContext } from '@mantine/form';
import { IconAlertCircle, IconDownload } from '@tabler/icons-react';
import { useEffect, useRef } from 'react';

// Epub型をinitEpubFileの返り値の型として定義
type EpubInstance = Awaited<ReturnType<typeof initEpubFile>>;
type NavPoint = ReturnType<EpubInstance['getToc']>[number];
// 入れ子の目次を平坦化した項目。depth は階層の深さ（最上位が0）
// key は目次の並び順から作る一意な値（同一ファイル内アンカーの項目は id が重複するため）
type TocItem = NavPoint & { depth: number; key: string };
type ChapterText = { title: string; text: string };

// Mantine form context
type FormProps = {
  selectedFile: File | null;
  toc: TocItem[];
  selectedTocKeys: string[];
  loading: boolean;
  error: string | null;
  downloading: boolean;
};
const [FormProvider, _useFormContext, useForm] = createFormContext<FormProps>();

// これらは絶対消さない！！！
window.process = window.process || {};
window.process.cwd = () => '/';

const sanitizeFileName = (value: string): string => {
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

const buildTocItems = (toc: NavPoint[]): TocItem[] =>
  flattenToc(toc).map((item, index) => ({ ...item, key: String(index) }));

// href の # 以降（アンカー）を取り出す。無ければ null
const getAnchor = (href: string): string | null => {
  const hashIndex = href.indexOf('#');
  if (hashIndex === -1) return null;
  const anchor = href.slice(hashIndex + 1);
  return anchor.length > 0 ? anchor : null;
};

const downloadTextFile = (fileName: string, content: string) => {
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};

function Notice() {
  return (
    <Alert variant='light' color='blue' title='安心設計'>
      EPUBのパース処理はすべてブラウザ内のみで行われます。 選択したファイルが外部に送信されることは一切ありません。
    </Alert>
  );
}

export default function Home() {
  // epubInstanceのみrefで管理
  const epubInstance = useRef<EpubInstance | null>(null);

  // Mantine useFormで全て管理
  const form = useForm({
    mode: 'controlled',
    initialValues: {
      selectedFile: null,
      toc: [],
      selectedTocKeys: [],
      loading: false,
      error: null,
      downloading: false
    }
  });

  // epubインスタンスのクリーンアップ
  useEffect(() => {
    return () => {
      epubInstance.current?.destroy();
    };
  }, []);

  // 目次取得時に全選択
  const handleFileChange = async (file: File | null) => {
    form.setValues({
      selectedFile: file,
      selectedTocKeys: []
    });
    if (epubInstance.current) {
      epubInstance.current.destroy();
      epubInstance.current = null;
    }

    if (!file) {
      form.setValues({
        toc: [],
        error: null
      });
      return;
    }

    form.setValues({
      loading: true,
      error: null,
      toc: []
    });

    try {
      const newEpubInstance = await initEpubFile(file);
      epubInstance.current = newEpubInstance;
      const tocItems = buildTocItems(newEpubInstance.getToc());
      form.setValues({
        toc: tocItems,
        selectedTocKeys: tocItems.map((item) => item.key)
      });
    } catch (e) {
      console.error('EPUB parsing error:', e);
      form.setValues({
        error: 'EPUBファイルのロードに失敗しました。',
        toc: [],
        selectedTocKeys: []
      });
      epubInstance.current = null;
    } finally {
      form.setFieldValue('loading', false);
    }
  };

  // 一括ON/OFF
  const handleToggleAll = () => {
    const toc = form.values.toc;
    if (form.values.selectedTocKeys.length === toc.length) {
      form.setFieldValue('selectedTocKeys', []);
    } else {
      form.setFieldValue(
        'selectedTocKeys',
        toc.map((item) => item.key)
      );
    }
  };

  const extractSelectedChapterTexts = async (epub: EpubInstance, selectedTocKeys: string[]) => {
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

  const handleDownload = async () => {
    if (!epubInstance.current || form.values.selectedTocKeys.length === 0) return;

    form.setFieldValue('downloading', true);
    form.setFieldValue('error', null);

    try {
      const epub = epubInstance.current;
      if (!epub) return;

      const chapterTexts = await extractSelectedChapterTexts(epub, form.values.selectedTocKeys);
      const combinedText = chapterTexts
        .map((ct) => `--- ${ct.title} ---\n${ct.text}`)
        .join('\n\n')
        .trim();

      if (combinedText.length === 0) {
        form.setValues({
          error: '選択された目次のテキストが見つかりませんでした。',
          downloading: false
        });
        return;
      }

      const fileName = form.values.selectedFile?.name?.replace(/\.epub$/i, '') || 'content';
      downloadTextFile(`${fileName}.txt`, combinedText);
    } catch (e) {
      console.error('Download error:', e);
      form.setFieldValue('error', 'テキストのダウンロード中にエラーが発生しました。');
    } finally {
      form.setFieldValue('downloading', false);
    }
  };

  const handleDownloadPerChapter = async () => {
    if (!epubInstance.current || form.values.selectedTocKeys.length === 0) return;

    form.setFieldValue('downloading', true);
    form.setFieldValue('error', null);

    try {
      const epub = epubInstance.current;
      if (!epub) return;

      const chapterTexts = await extractSelectedChapterTexts(epub, form.values.selectedTocKeys);
      const nonEmptyChapters = chapterTexts
        .map((ct) => ({ title: ct.title, text: ct.text.trim() }))
        .filter((ct) => ct.text.length > 0);

      if (nonEmptyChapters.length === 0) {
        form.setValues({
          error: '選択された目次のテキストが見つかりませんでした。',
          downloading: false
        });
        return;
      }

      for (const chapter of nonEmptyChapters) {
        const safeTitle = sanitizeFileName(chapter.title);
        downloadTextFile(`${safeTitle}.txt`, chapter.text);
      }
    } catch (e) {
      console.error('Download error:', e);
      form.setFieldValue('error', 'テキストのダウンロード中にエラーが発生しました。');
    } finally {
      form.setFieldValue('downloading', false);
    }
  };

  return (
    <Container maw={600} py={'xl'}>
      <Stack gap={'md'} mb={'xl'}>
        <Stack gap={'xs'}>
          <Title order={2}>EPUBテキスト変換ツール</Title>
          <Title order={6} c={'dimmed'}>
            EPUBのテキストを章ごとにまとめてダウンロードできます。
          </Title>
        </Stack>

        <Notice />

        <FileInput
          label='EPUBファイルを選択'
          placeholder='ここをクリックしてファイルを選択'
          accept='.epub'
          value={form.values.selectedFile}
          onChange={handleFileChange}
          clearable
        />
        {form.values.loading && <Loader />}
        {form.values.error && (
          <Alert icon={<IconAlertCircle />} title='エラー' color='red'>
            {form.values.error}
          </Alert>
        )}

        {form.values.toc.length > 0 && !form.values.loading && (
          <FormProvider form={form}>
            <Stack gap={'md'}>
              <Flex justify='space-between'>
                <Title order={4}>目次</Title>
                <Button size='xs' variant='light' onClick={handleToggleAll}>
                  {form.values.selectedTocKeys.length === form.values.toc.length ? '全解除' : '全選択'}
                </Button>
              </Flex>

              <Checkbox.Group {...form.getInputProps('selectedTocKeys')}>
                <List spacing='xs' size='sm' listStyleType='none'>
                  {form.values.toc.map((item: TocItem) => (
                    <ListItem key={item.key} pl={item.depth * 20}>
                      <Checkbox value={item.key} label={item.label} />
                    </ListItem>
                  ))}
                </List>
              </Checkbox.Group>

              <Stack align='center' gap={'xs'}>
                <Button
                  onClick={handleDownload}
                  disabled={form.values.selectedTocKeys.length === 0 || form.values.downloading}
                  leftSection={<IconDownload size={20} />}
                  loading={form.values.downloading}
                  size='lg'
                >
                  選択したテキストをダウンロード
                </Button>
                <Button
                  onClick={handleDownloadPerChapter}
                  disabled={form.values.selectedTocKeys.length === 0 || form.values.downloading}
                  variant='light'
                  leftSection={<IconDownload size={20} />}
                  size='lg'
                >
                  選択した章を個別に一括ダウンロード（複数txt）
                </Button>
              </Stack>
            </Stack>
          </FormProvider>
        )}
      </Stack>
    </Container>
  );
}
