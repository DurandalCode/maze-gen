import { useEffect, useRef, useState } from 'react';
import type { ExportSelection } from '../exchange/export-repository';
import type { PackageCounts } from '../exchange/package';
import { message, store } from './services';
interface Packet {
  blob: Blob;
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
    s.url = URL.createObjectURL(result.packet.blob);
    const { blob: _, ...metadata } = result.packet;
    setPacket({ ...metadata, url: s.url });
    setBusy(false);
  };
  useEffect(() => {
    state.current.live = true;
    void store<Result>('export', { kind: 'begin', selection })
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
        {error && <p role="alert">{error}</p>}
        {packet && (
          <>
            <p>
              Пакет {packet.number} · {(packet.bytes / 1024).toFixed(1)} KiB · Карт:{' '}
              {packet.counts.maps}, прохождений: {packet.counts.sessions}
            </p>
            {!busy && !error && (
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
            <p role="status">
              {packet.last
                ? `Всего пакетов: ${packet.number}.`
                : `Подготовлено пакетов: ${packet.number}.`}{' '}
              Отправлено на скачивание: {sent.length}.
            </p>
            {downloaded && !packet.last && !error && (
              <button className="primary" disabled={busy} onClick={() => void next()}>
                Следующий пакет
              </button>
            )}
            {downloaded && packet.last && (
              <p>Все пакеты отправлены на скачивание. Файлы доступны в загрузках браузера.</p>
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
