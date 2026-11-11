import { useEffect, useRef, useState } from 'react';
import type { ExportSelection } from '../exchange/export-repository';
import type { PackageCounts } from '../exchange/package';
import { message, store } from './services';
import { nativeExportAvailable, shareNativePacket } from '../platform/native-export';
import type { NativeChunk } from '../platform/native-export';
interface Packet {
  blob?: Blob;
  native?: boolean;
  bytes: number;
  number: number;
  last: boolean;
  counts: PackageCounts;
  filename: string;
}
interface Result {
  exportId: string;
  done: boolean;
  packet?: Packet;
}
export function ExportPanel({
  selection,
  onClose,
}: {
  selection: ExportSelection;
  onClose: () => void;
}) {
  const [packet, setPacket] = useState<(Omit<Packet, 'blob'> & { url: string }) | null>(null);
  const [busy, setBusy] = useState(true),
    [error, setError] = useState('');
  const [sent, setSent] = useState<number[]>([]);
  const [nativeBytes, setNativeBytes] = useState(0);
  const abort = useRef(new AbortController());
  const state = useRef<{ id: string | null; live: boolean; url: string | null }>({
    id: null,
    live: true,
    url: null,
  });
  const receive = (result: Result) => {
    const s = state.current;
    s.id = result.exportId;
    if (!s.live) {
      void store('export', { kind: 'cancel', exportId: result.exportId }).catch(() => {});
      return;
    }
    if (!result.packet) throw new Error('Пакет экспорта не подготовлен');
    if (s.url) URL.revokeObjectURL(s.url);
    s.url = result.packet.blob ? URL.createObjectURL(result.packet.blob) : null;
    const { blob: _, ...metadata } = result.packet;
    setPacket({ ...metadata, url: s.url ?? '' });
    setBusy(false);
  };
  useEffect(() => {
    state.current.live = true;
    void store<Result>('export', { kind: 'begin', selection, native: nativeExportAvailable() })
      .then(receive)
      .catch((e) => {
        if (state.current.live) {
          setError(message(e));
          setBusy(false);
        }
      });
    return () => {
      const s = state.current;
      s.live = false;
      abort.current.abort();
      if (s.url) {
        URL.revokeObjectURL(s.url);
        s.url = null;
      }
      if (s.id) void store('export', { kind: 'cancel', exportId: s.id }).catch(() => {});
    };
  }, [selection]);
  const next = async () => {
    if (!state.current.id) return;
    setBusy(true);
    setError('');
    try {
      receive(await store<Result>('export', { kind: 'next', exportId: state.current.id }));
    } catch (e) {
      if (state.current.live) {
        setError(message(e));
        setBusy(false);
      }
    }
  };
  const downloaded = !!packet && sent.includes(packet.number);
  const share = async () => {
    const id = state.current.id;
    if (!id || !packet) return;
    setBusy(true);
    setError('');
    setNativeBytes(0);
    try {
      await shareNativePacket(
        { exportId: id, ...packet },
        (sequence) => store<NativeChunk>('export', { kind: 'chunk', exportId: id, sequence }),
        abort.current.signal,
        (bytes) => {
          if (state.current.live) setNativeBytes(bytes);
        },
      );
      await store('export', { kind: 'part-complete', exportId: id, number: packet.number });
      if (state.current.live)
        setSent((old) => (old.includes(packet.number) ? old : [...old, packet.number]));
    } catch (e) {
      if (state.current.live) setError(message(e));
    } finally {
      if (state.current.live) setBusy(false);
    }
  };
  return (
    <div className="modal-backdrop">
      <section className="modal" role="dialog" aria-modal="true" aria-label="Экспорт пакетов">
        <header className="toolbar">
          <h2>Экспорт JSON</h2>
          <button onClick={onClose}>Закрыть экспорт</button>
        </header>
        <p>
          Каждый файл содержит собственные карты, определения и полную историю выбранных попыток.
          Размер файла ограничен 32 MiB.
        </p>
        {busy && <p role="status">Подготавливаем пакет в хранилище…</p>}
        {busy && packet?.native && (
          <p role="status">Записано: {(nativeBytes / 1024).toFixed(1)} KiB</p>
        )}
        {error && <p role="alert">{error}</p>}
        {packet && (
          <>
            <p>
              Пакет {packet.number} · {(packet.bytes / 1024).toFixed(1)} KiB · Карт:{' '}
              {packet.counts.maps}, прохождений: {packet.counts.sessions}
            </p>
            {!busy && !error && !packet.native && (
              <a
                className="download"
                href={packet.url}
                download={packet.filename}
                onClick={() =>
                  setSent((old) => (old.includes(packet.number) ? old : [...old, packet.number]))
                }
              >
                Сохранить пакет {packet.number}
              </a>
            )}
            {packet.native && !busy && !error && !downloaded && (
              <button className="primary" onClick={() => void share()}>
                Поделиться пакетом {packet.number}
              </button>
            )}
            <p role="status">
              {packet.last
                ? `Всего пакетов: ${packet.number}.`
                : `Подготовлено пакетов: ${packet.number}.`}{' '}
              {packet.native ? 'Файлов подготовлено для отправки' : 'Отправлено на скачивание'}:{' '}
              {sent.length}.
            </p>
            {downloaded && !packet.last && !error && (
              <button className="primary" disabled={busy} onClick={() => void next()}>
                Следующий пакет
              </button>
            )}
            {downloaded && packet.last && (
              <p>
                {packet.native
                  ? 'Все пакеты записаны и переданы в меню отправки.'
                  : 'Все пакеты отправлены на скачивание. Файлы доступны в загрузках браузера.'}
              </p>
            )}
            {error && sent.length > 0 && (
              <p>
                Уже скачанные пакеты самостоятельны. Текущий объект не экспортирован; усечённый файл
                не создавался.
              </p>
            )}
          </>
        )}
      </section>
    </div>
  );
}
