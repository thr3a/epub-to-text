import { initEpubFile } from '@lingo-reader/epub-parser';
import { Alert, Button, Checkbox, Container, FileInput, Group, List, ListItem, Loader, Title } from '@mantine/core';
import { IconAlertCircle, IconDownload } from '@tabler/icons-react';
import { useEffect, useState } from 'react';

// Epub型をinitEpubFileの返り値の型として定義
type EpubInstance = Awaited<ReturnType<typeof initEpubFile>>;
// TocItem型をEpubInstance['getToc']の返り値の配列要素の型として定義
type TocItem = ReturnType<EpubInstance['getToc']>[number];

// これらは絶対消さない！！！
window.process = window.process || {};
window.process.cwd = () => '/';

export default function Home() {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [epubInstance, setEpubInstance] = useState<EpubInstance | null>(null);
  const [toc, setToc] = useState<TocItem[]>([]);
  const [selectedTocIds, setSelectedTocIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);

  // epubインスタンスのクリーンアップ
  useEffect(() => {
    return () => {
      epubInstance?.destroy();
    };
  }, [epubInstance]);

  const handleFileChange = async (file: File | null) => {
    setSelectedFile(file);
    setSelectedTocIds([]); // ファイルが変わったら選択状態をリセット
    if (epubInstance) {
      epubInstance.destroy();
      setEpubInstance(null);
    }

    if (!file) {
      setToc([]);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);
    setToc([]);

    try {
      const newEpubInstance = await initEpubFile(file);
      setEpubInstance(newEpubInstance);
      const tocItems = newEpubInstance.getToc();
      setToc(tocItems);
    } catch (e) {
      console.error('EPUB parsing error:', e);
      setError('EPUBファイルのパースに失敗しました。');
      setEpubInstance(null); // エラー時はインスタンスをnullに
      setToc([]);
    } finally {
      setLoading(false);
    }
  };

  const handleDownload = async () => {
    if (!epubInstance || selectedTocIds.length === 0) return;

    setDownloading(true);
    setError(null); // ダウンロード試行前にエラーをクリア

    try {
      let combinedText = '';
      const parser = new DOMParser();

      for (const id of selectedTocIds) {
        const chapter = await epubInstance.loadChapter(id);
        if (chapter?.html) {
          const doc = parser.parseFromString(chapter.html, 'text/html');
          const textContent = doc.body.textContent || '';
          combinedText += `${textContent.trim()}\n\n`; // 章の間に空行を挿入
        }
      }

      if (combinedText.trim().length === 0) {
        setError('選択された目次のテキストコンテンツが見つかりませんでした。');
        setDownloading(false);
        return;
      }

      const blob = new Blob([combinedText.trim()], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      const fileName = selectedFile?.name?.replace(/\.epub$/i, '') || 'content';
      link.download = `${fileName}.txt`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error('Download error:', e);
      setError('テキストのダウンロード中にエラーが発生しました。');
    } finally {
      setDownloading(false);
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
        value={selectedFile}
        onChange={handleFileChange}
        clearable
        mb='md'
      />

      {loading && <Loader mt='md' />}

      {error && (
        <Alert
          icon={<IconAlertCircle size='1rem' />}
          title='エラー'
          color='red'
          mt='md'
          withCloseButton
          onClose={() => setError(null)}
        >
          {error}
        </Alert>
      )}

      {toc.length > 0 && !loading && (
        <div style={{ marginTop: '20px' }}>
          <Title order={4} mb='sm'>
            目次
          </Title>
          <Checkbox.Group value={selectedTocIds} onChange={setSelectedTocIds}>
            <List spacing='xs' size='sm' listStyleType='none'>
              {toc.map((item) => (
                <ListItem key={item.id}>
                  <Checkbox value={item.id} label={item.label} />
                </ListItem>
              ))}
            </List>
          </Checkbox.Group>

          <Group mt='md'>
            <Button
              onClick={handleDownload}
              disabled={selectedTocIds.length === 0 || downloading}
              leftSection={<IconDownload size={14} />}
              loading={downloading}
            >
              選択した目次をダウンロード
            </Button>
          </Group>
        </div>
      )}
    </Container>
  );
}
