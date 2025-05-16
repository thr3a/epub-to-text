import { initEpubFile } from '@lingo-reader/epub-parser';
import { Alert, Button, Checkbox, Container, FileInput, Group, List, ListItem, Loader, Title } from '@mantine/core';
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
const [FormProvider, useFormContext, useForm] = createFormContext<FormProps>();

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
      selectedFile: null as File | null,
      toc: [] as TocItem[],
      selectedTocIds: [] as string[],
      loading: false,
      error: null as string | null,
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
        error: 'EPUBファイルのパースに失敗しました。',
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

      for (const id of form.values.selectedTocIds) {
        const chapter = await epubInstance.current.loadChapter(id);
        if (chapter?.html) {
          const doc = parser.parseFromString(chapter.html, 'text/html');
          const textContent = doc.body.textContent || '';
          combinedText += `${textContent.trim()}\n\n`;
        }
      }

      if (combinedText.trim().length === 0) {
        form.setValues({
          error: '選択された目次のテキストコンテンツが見つかりませんでした。',
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
    <Container maw={600} py='md'>
      <Title order={2} mb='md'>
        EPUBリーダー
      </Title>

      <FileInput
        label='EPUBファイルを選択'
        placeholder='ここをクリックしてファイルを選択'
        accept='.epub'
        value={form.values.selectedFile}
        onChange={handleFileChange}
        clearable
        mb='md'
      />

      {form.values.loading && <Loader mt='md' />}

      {form.values.error && (
        <Alert
          icon={<IconAlertCircle size='1rem' />}
          title='エラー'
          color='red'
          mt='md'
          withCloseButton
          onClose={() => form.setFieldValue('error', null)}
        >
          {form.values.error}
        </Alert>
      )}

      {form.values.toc.length > 0 && !form.values.loading && (
        <FormProvider form={form}>
          <div style={{ marginTop: '20px' }}>
            <Title order={4} mb='sm'>
              目次
            </Title>
            <Button size='xs' variant='light' onClick={handleToggleAll} mb='xs' style={{ float: 'right' }}>
              {form.values.selectedTocIds.length === form.values.toc.length ? '全解除' : '全選択'}
            </Button>
            <Checkbox.Group {...form.getInputProps('selectedTocIds')}>
              <List spacing='xs' size='sm' listStyleType='none'>
                {form.values.toc.map((item: TocItem) => (
                  <ListItem key={item.id}>
                    <Checkbox value={item.id} label={item.label} />
                  </ListItem>
                ))}
              </List>
            </Checkbox.Group>

            <Group mt='md'>
              <Button
                onClick={handleDownload}
                disabled={form.values.selectedTocIds.length === 0 || form.values.downloading}
                leftSection={<IconDownload size={14} />}
                loading={form.values.downloading}
              >
                選択した目次をダウンロード
              </Button>
            </Group>
          </div>
        </FormProvider>
      )}
    </Container>
  );
}
