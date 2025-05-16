import { Container, Title, FileInput, List, ListItem, Loader, Alert } from '@mantine/core';
import { useState } from 'react';
import { initEpubFile } from '@lingo-reader/epub-parser';
import { IconAlertCircle } from '@tabler/icons-react';

// Epub型をinitEpubFileの返り値の型として定義
type EpubInstance = Awaited<ReturnType<typeof initEpubFile>>;
// TocItem型をEpubInstance['getToc']の返り値の配列要素の型として定義
type TocItem = ReturnType<EpubInstance['getToc']>[number];

window.process = window.process || {}
window.process.cwd = () => '/'

export default function Home() {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [toc, setToc] = useState<TocItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFileChange = async (file: File | null) => {
    setSelectedFile(file);
    if (!file) {
      setToc([]);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);
    setToc([]);

    try {
      // Fileオブジェクトを直接渡す
      const epub = await initEpubFile(file);
      const tocItems = epub.getToc();
      setToc(tocItems);
      epub.destroy(); // 不要になったepubインスタンスを破棄
    } catch (e) {
      console.error('EPUB parsing error:', e);
      setError('EPUBファイルのパースに失敗しました。');
      setToc([]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Container maw={600} py="md">
      <Title order={2} mb="md">
        EPUBリーダー
      </Title>

      <FileInput
        label="EPUBファイルを選択"
        placeholder="ここをクリックしてファイルを選択"
        accept=".epub"
        value={selectedFile}
        onChange={handleFileChange}
        clearable
      />

      {loading && <Loader mt="md" />}

      {error && (
        <Alert icon=<IconAlertCircle size="1rem" /> title="エラー" color="red" mt="md">
          {error}
        </Alert>
      )}

      {toc.length > 0 && (
        <div style={{ marginTop: '20px' }}>
          <Title order={4} mb="sm">目次</Title>
          <List spacing="xs" size="sm" center>
            {toc.map((item) => (
              <ListItem key={item.id}>{item.label}</ListItem>
            ))}
          </List>
        </div>
      )}
    </Container>
  );
}
