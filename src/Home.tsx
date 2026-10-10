import { initEpubFile } from '@lingo-reader/epub-parser';
import {
  Alert,
  Button,
  Checkbox,
  Collapse,
  Container,
  FileInput,
  Flex,
  Group,
  List,
  ListItem,
  Loader,
  Stack,
  Text,
  Title
} from '@mantine/core';
import { createFormContext } from '@mantine/form';
import { useDisclosure } from '@mantine/hooks';
import { IconAlertCircle, IconChevronDown, IconChevronRight, IconDownload } from '@tabler/icons-react';
import { strToU8, zipSync } from 'fflate';
import { type ChangeEvent, useEffect, useRef } from 'react';
import {
  buildTocGroups,
  buildTocItems,
  combineChapterTexts,
  type EpubInstance,
  extractSelectedGroupTexts,
  sanitizeFileName,
  type TocGroup
} from './epub';

// Mantine form context
type FormProps = {
  selectedFile: File | null;
  tocGroups: TocGroup[];
  selectedGroupKeys: string[];
  loading: boolean;
  error: string | null;
  downloading: boolean;
};
const [FormProvider, _useFormContext, useForm] = createFormContext<FormProps>();

// これらは絶対消さない！！！
window.process = window.process || {};
window.process.cwd = () => '/';

const downloadBlob = (fileName: string, blob: Blob) => {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};

const downloadTextFile = (fileName: string, content: string) => {
  downloadBlob(fileName, new Blob([content], { type: 'text/plain;charset=utf-8' }));
};

const downloadZipFile = (fileName: string, files: Record<string, string>) => {
  const zipEntries: Record<string, Uint8Array> = {};
  for (const [name, content] of Object.entries(files)) {
    zipEntries[name] = strToU8(content);
  }
  downloadBlob(fileName, new Blob([zipSync(zipEntries)], { type: 'application/zip' }));
};

// 大項目1行分。配下の目次項目は折りたたんで表示のみ（選択は大項目単位）
function TocGroupRow({
  group,
  checked,
  onChange
}: {
  group: TocGroup;
  checked: boolean;
  onChange: (event: ChangeEvent<HTMLInputElement>) => void;
}) {
  const [opened, { toggle }] = useDisclosure(false);

  return (
    <Stack gap={'xs'}>
      <Group justify='space-between' wrap='nowrap'>
        <Checkbox checked={checked} onChange={onChange} label={group.label} />
        {group.children.length > 0 && (
          <Button
            variant='subtle'
            color='gray'
            size='compact-xs'
            rightSection={opened ? <IconChevronDown size={14} /> : <IconChevronRight size={14} />}
            onClick={toggle}
            style={{ flexShrink: 0 }}
          >
            {group.children.length}項目
          </Button>
        )}
      </Group>
      {group.children.length > 0 && (
        <Collapse in={opened}>
          <List size='sm' c='dimmed' spacing={'xs'} listStyleType='none' pl={'xl'}>
            {group.children.map((child) => (
              <ListItem key={child.key} pl={(child.depth - group.depth - 1) * 20}>
                {child.label}
              </ListItem>
            ))}
          </List>
        </Collapse>
      )}
    </Stack>
  );
}

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
  // Shift+クリックの範囲選択の起点となる、最後にクリックした大項目の位置
  const lastClickedIndex = useRef<number | null>(null);

  // Mantine useFormで全て管理
  const form = useForm({
    mode: 'controlled',
    initialValues: {
      selectedFile: null,
      tocGroups: [],
      selectedGroupKeys: [],
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
      selectedGroupKeys: []
    });
    lastClickedIndex.current = null;
    if (epubInstance.current) {
      epubInstance.current.destroy();
      epubInstance.current = null;
    }

    if (!file) {
      form.setValues({
        tocGroups: [],
        error: null
      });
      return;
    }

    form.setValues({
      loading: true,
      error: null,
      tocGroups: []
    });

    try {
      const newEpubInstance = await initEpubFile(file);
      epubInstance.current = newEpubInstance;
      const tocGroups = buildTocGroups(buildTocItems(newEpubInstance.getToc()));
      form.setValues({
        tocGroups,
        selectedGroupKeys: tocGroups.map((group) => group.key)
      });
    } catch (e) {
      console.error('EPUB parsing error:', e);
      form.setValues({
        error: 'EPUBファイルのロードに失敗しました。',
        tocGroups: [],
        selectedGroupKeys: []
      });
      epubInstance.current = null;
    } finally {
      form.setFieldValue('loading', false);
    }
  };

  // 一括ON/OFF
  const handleToggleAll = () => {
    const tocGroups = form.values.tocGroups;
    if (form.values.selectedGroupKeys.length === tocGroups.length) {
      form.setFieldValue('selectedGroupKeys', []);
    } else {
      form.setFieldValue(
        'selectedGroupKeys',
        tocGroups.map((group) => group.key)
      );
    }
  };

  // 大項目のチェック切り替え。Shift+クリックなら前回クリックした大項目からの範囲をまとめて切り替える
  const handleGroupChange = (index: number, event: ChangeEvent<HTMLInputElement>) => {
    const tocGroups = form.values.tocGroups;
    const checked = event.currentTarget.checked;
    // React はチェックボックスの onChange を click から発火するため、nativeEvent で Shift の有無を判定できる
    const isShiftClick = event.nativeEvent instanceof MouseEvent && event.nativeEvent.shiftKey;
    const lastIndex = lastClickedIndex.current;
    lastClickedIndex.current = index;

    const targetGroups =
      isShiftClick && lastIndex !== null
        ? tocGroups.slice(Math.min(lastIndex, index), Math.max(lastIndex, index) + 1)
        : [tocGroups[index]];
    const selectedKeySet = new Set(form.values.selectedGroupKeys);
    for (const group of targetGroups) {
      if (checked) {
        selectedKeySet.add(group.key);
      } else {
        selectedKeySet.delete(group.key);
      }
    }
    // 目次の並び順を保つ
    form.setFieldValue(
      'selectedGroupKeys',
      tocGroups.filter((group) => selectedKeySet.has(group.key)).map((group) => group.key)
    );
  };

  const handleDownload = async () => {
    if (!epubInstance.current || form.values.selectedGroupKeys.length === 0) return;

    form.setFieldValue('downloading', true);
    form.setFieldValue('error', null);

    try {
      const epub = epubInstance.current;
      if (!epub) return;

      const groupTexts = await extractSelectedGroupTexts(epub, form.values.tocGroups, form.values.selectedGroupKeys);
      const combinedText = combineChapterTexts(groupTexts.flatMap((groupText) => groupText.chapterTexts));

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
    if (!epubInstance.current || form.values.selectedGroupKeys.length === 0) return;

    form.setFieldValue('downloading', true);
    form.setFieldValue('error', null);

    try {
      const epub = epubInstance.current;
      if (!epub) return;

      const tocGroups = form.values.tocGroups;
      const groupTexts = await extractSelectedGroupTexts(epub, tocGroups, form.values.selectedGroupKeys);

      if (groupTexts.length === 0) {
        form.setValues({
          error: '選択された目次のテキストが見つかりませんでした。',
          downloading: false
        });
        return;
      }

      // 並び順が崩れないよう、目次全体での大項目の位置を連番として先頭に付ける
      const numberWidth = Math.max(2, String(tocGroups.length).length);
      const files: Record<string, string> = {};
      for (const groupText of groupTexts) {
        const number = String(tocGroups.findIndex((group) => group.key === groupText.key) + 1).padStart(
          numberWidth,
          '0'
        );
        const safeTitle = sanitizeFileName(groupText.title);
        files[`${number}_${safeTitle}.txt`] = combineChapterTexts(groupText.chapterTexts);
      }

      const fileName = form.values.selectedFile?.name?.replace(/\.epub$/i, '') || 'content';
      downloadZipFile(`${fileName}.zip`, files);
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

        {form.values.tocGroups.length > 0 && !form.values.loading && (
          <FormProvider form={form}>
            <Stack gap={'md'}>
              <Flex justify='space-between'>
                <Title order={4}>目次</Title>
                <Button size='xs' variant='light' onClick={handleToggleAll}>
                  {form.values.selectedGroupKeys.length === form.values.tocGroups.length ? '全解除' : '全選択'}
                </Button>
              </Flex>

              {/* Shift+クリックで範囲選択したときに文字列が選択されないようにする */}
              <Stack gap={'xs'} style={{ userSelect: 'none' }}>
                {form.values.tocGroups.map((group, index) => (
                  <TocGroupRow
                    key={group.key}
                    group={group}
                    checked={form.values.selectedGroupKeys.includes(group.key)}
                    onChange={(event) => handleGroupChange(index, event)}
                  />
                ))}
              </Stack>

              <Text size='sm' c='dimmed' ta='center'>
                {form.values.tocGroups.length}章中 {form.values.selectedGroupKeys.length}
                章を選択中（Shift+クリックで範囲選択）
              </Text>

              <Stack align='center' gap={'xs'}>
                <Button
                  onClick={handleDownload}
                  disabled={form.values.selectedGroupKeys.length === 0 || form.values.downloading}
                  leftSection={<IconDownload size={20} />}
                  loading={form.values.downloading}
                  size='lg'
                >
                  選択したテキストをダウンロード
                </Button>
                <Button
                  onClick={handleDownloadPerChapter}
                  disabled={form.values.selectedGroupKeys.length === 0 || form.values.downloading}
                  variant='light'
                  leftSection={<IconDownload size={20} />}
                  size='lg'
                >
                  章ごとに分割して一括ダウンロード(Zip)
                </Button>
              </Stack>
            </Stack>
          </FormProvider>
        )}
      </Stack>
    </Container>
  );
}
