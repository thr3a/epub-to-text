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
  Space,
  Title
} from '@mantine/core';
import { createFormContext } from '@mantine/form';
import { IconAlertCircle, IconDownload } from '@tabler/icons-react';
import { useEffect, useRef } from 'react';

// Epub型をinitEpubFileの返り値の型として定義
type EpubInstance = Awaited<ReturnType<typeof initEpubFile>>;
type TocItem = ReturnType<EpubInstance['getToc']>[number];

// Mantine form context
type FormProps = {
  selectedFile: File | null;
  toc: TocItem[];
  selectedTocIds: string[];
  loading: boolean;
  error: string | null;
  downloading: boolean;
};
const [FormProvider, _useFormContext, useForm] = createFormContext<FormProps>();

// これらは絶対消さない！！！
window.process = window.process || {};
window.process.cwd = () => '/';

export default function Home() {
  // epubInstanceのみrefで管理
  const epubInstance = useRef<EpubInstance | null>(null);

  // Mantine useFormで全て管理
  const form = useForm({
    mode: 'controlled',
    initialValues: {
      selectedFile: null,
      toc: [],
      selectedTocIds: [],
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
      selectedTocIds: []
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
      const tocItems = newEpubInstance.getToc();
      form.setValues({
        toc: tocItems,
        selectedTocIds: tocItems.map((item) => item.id)
      });
    } catch (e) {
      console.error('EPUB parsing error:', e);
      form.setValues({
        error: 'EPUBファイルのロードに失敗しました。',
        toc: [],
        selectedTocIds: []
      });
      epubInstance.current = null;
    } finally {
      form.setFieldValue('loading', false);
    }
  };

  // 一括ON/OFF
  const handleToggleAll = () => {
    const toc = form.values.toc;
    if (form.values.selectedTocIds.length === toc.length) {
      form.setFieldValue('selectedTocIds', []);
    } else {
      form.setFieldValue(
        'selectedTocIds',
        toc.map((item) => item.id)
      );
    }
  };

  const handleDownload = async () => {
    if (!epubInstance.current || form.values.selectedTocIds.length === 0) return;

    form.setFieldValue('downloading', true);
    form.setFieldValue('error', null);

    try {
      let combinedText = '';
      const parser = new DOMParser();
      const epub = epubInstance.current;
      if (!epub) return;

      const spine = epub.getSpine();
      const tocItems = epub.getToc();
      const tocMap = new Map(tocItems.map((item) => [item.id, item]));

      // 選択された目次IDに対応する章のテキストを収集
      const chapterTexts: { title: string; text: string }[] = [];

      // HTMLコンテンツをプレーンテキストに変換するヘルパー関数
      const htmlToText = (html: string): string => {
        const doc = parser.parseFromString(html, 'text/html');
        return doc.body.textContent?.trim() || '';
      };

      // spineを順番に処理して、選択された目次の章のテキストを抽出
      let currentSelectedChapterTitle: string | null = null;
      let currentChapterAggregatedText = '';

      for (const spineItem of spine) {
        const tocItemForSpine = tocMap.get(spineItem.id);
        const chapterTitle = tocItemForSpine?.label?.trim();

        // 目次ラベルがあり、かつ選択されているIDの場合、新しい章の開始とみなす
        if (chapterTitle && form.values.selectedTocIds.includes(spineItem.id)) {
          // 前の章のテキストがあれば保存
          if (currentSelectedChapterTitle && currentChapterAggregatedText.trim().length > 0) {
            chapterTexts.push({ title: currentSelectedChapterTitle, text: currentChapterAggregatedText.trim() });
          }
          // 新しい章の開始
          currentSelectedChapterTitle = chapterTitle;
          const chapterData = await epub.loadChapter(spineItem.id);
          currentChapterAggregatedText = chapterData?.html ? `${htmlToText(chapterData.html)}\n` : '';
        } else if (currentSelectedChapterTitle) {
          // 新しいタイトル（選択されているか否かにかかわらず）が現れたら、
          // それが選択されたタイトルでなければ、現在の章のテキスト収集を終了する。
          if (
            chapterTitle &&
            chapterTitle !== currentSelectedChapterTitle &&
            form.values.selectedTocIds.includes(spineItem.id)
          ) {
            // これは新しい選択された章なので、上のifブロックで処理されるはず
          } else if (
            chapterTitle &&
            chapterTitle !== currentSelectedChapterTitle &&
            !form.values.selectedTocIds.includes(spineItem.id)
          ) {
            // 新しいタイトルだが、選択されていない章なので、現在の章のテキスト収集をここで一旦区切る
            // （ただし、このspineのテキスト自体は含めない）
            if (currentSelectedChapterTitle && currentChapterAggregatedText.trim().length > 0) {
              chapterTexts.push({ title: currentSelectedChapterTitle, text: currentChapterAggregatedText.trim() });
            }
            currentSelectedChapterTitle = null; // 現在の章の収集をリセット
            currentChapterAggregatedText = '';
          } else if (currentSelectedChapterTitle) {
            // タイトルが変わらないか、タイトルがないspine
            const chapterData = await epub.loadChapter(spineItem.id);
            if (chapterData?.html) {
              const text = htmlToText(chapterData.html);
              if (text.length > 0) {
                currentChapterAggregatedText += `${text}\n`;
              }
            }
          }
        }
      }

      // 最後の章のテキストを保存
      if (currentSelectedChapterTitle && currentChapterAggregatedText.trim().length > 0) {
        chapterTexts.push({ title: currentSelectedChapterTitle, text: currentChapterAggregatedText.trim() });
      }

      // 収集したテキストを結合
      combinedText = chapterTexts.map((ct) => `--- ${ct.title} ---\n${ct.text}`).join('\n\n');

      if (combinedText.trim().length === 0) {
        form.setValues({
          error: '選択された目次のテキストが見つかりませんでした。',
          downloading: false
        });
        return;
      }

      const blob = new Blob([combinedText.trim()], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      const fileName = form.values.selectedFile?.name?.replace(/\.epub$/i, '') || 'content';
      link.download = `${fileName}.txt`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error('Download error:', e);
      form.setFieldValue('error', 'テキストのダウンロード中にエラーが発生しました。');
    } finally {
      form.setFieldValue('downloading', false);
    }
  };

  return (
    <Container maw={600} py='md' mb={'xl'}>
      <Title mt={'sm'} order={2}>
        EPUBテキスト変換ツール
      </Title>
      <Title order={6} mb={'sm'} c={'dimmed'}>
        EPUBのテキストを章ごとにまとめてダウンロードできます。
      </Title>
      <FileInput
        label='EPUBファイルを選択'
        placeholder='ここをクリックしてファイルを選択'
        accept='.epub'
        value={form.values.selectedFile}
        onChange={handleFileChange}
        clearable
      />
      <Space h='md' />
      {form.values.loading && <Loader />}
      {form.values.error && (
        <Alert icon={<IconAlertCircle />} title='エラー' color='red'>
          {form.values.error}
        </Alert>
      )}
      <Space h='md' />

      {form.values.toc.length > 0 && !form.values.loading && (
        <FormProvider form={form}>
          <Flex justify='space-between'>
            <Title order={4}>目次</Title>
            <Button size='xs' variant='light' onClick={handleToggleAll}>
              {form.values.selectedTocIds.length === form.values.toc.length ? '全解除' : '全選択'}
            </Button>
          </Flex>

          <Space h='sm' />

          <Checkbox.Group {...form.getInputProps('selectedTocIds')}>
            <List spacing='xs' size='sm' listStyleType='none'>
              {form.values.toc.map((item: TocItem) => (
                <ListItem key={item.id}>
                  <Checkbox value={item.id} label={item.label} />
                </ListItem>
              ))}
            </List>
          </Checkbox.Group>

          <Space h='md' />

          <Flex justify='center' align='center'>
            <Button
              onClick={handleDownload}
              disabled={form.values.selectedTocIds.length === 0 || form.values.downloading}
              leftSection={<IconDownload size={18} />}
              loading={form.values.downloading}
            >
              選択したテキストをダウンロード
            </Button>
          </Flex>
        </FormProvider>
      )}
    </Container>
  );
}
