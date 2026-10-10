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
import {
  buildTocItems,
  combineChapterTexts,
  type EpubInstance,
  extractSelectedChapterTexts,
  sanitizeFileName,
  type TocItem
} from './epub';

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

  const handleDownload = async () => {
    if (!epubInstance.current || form.values.selectedTocKeys.length === 0) return;

    form.setFieldValue('downloading', true);
    form.setFieldValue('error', null);

    try {
      const epub = epubInstance.current;
      if (!epub) return;

      const chapterTexts = await extractSelectedChapterTexts(epub, form.values.selectedTocKeys);
      const combinedText = combineChapterTexts(chapterTexts);

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
