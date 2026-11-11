package lab.maze.reboot;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.Map;

/** Bounded serial file writer. No Android dependency: protocol invariants run on a host JVM too. */
public final class ExportStore {
    public static final long MAX_BYTES = 32L * 1024 * 1024;
    public static final int MAX_BASE64_CHARS = 256 * 1024;
    public static final int MAX_CHUNK_BYTES = 192 * 1024;
    private final File directory;
    private final Map<String, Active> active = new LinkedHashMap<>();
    private final Map<String, File> completed = new LinkedHashMap<>();
    private static final class Active {
        final File file;
        final String filename;
        final long expected;
        final FileOutputStream stream;
        long bytes;
        int sequence;
        byte[] lastDigest;
        Active(File file, String filename, long expected) throws IOException {
            this.file = file; this.filename = filename; this.expected = expected;
            if (!file.createNewFile()) throw new IOException("Экспорт с таким ID уже существует");
            this.stream = new FileOutputStream(file);
        }
    }
    public ExportStore(File directory) throws IOException {
        this.directory = directory.getCanonicalFile();
        if (!this.directory.isDirectory() && !this.directory.mkdirs()) throw new IOException("Не удалось создать каталог экспорта");
        File[] orphaned = this.directory.listFiles((parent,name) -> name.matches("[a-zA-Z0-9_-]{1,128}\\.part"));
        if (orphaned != null) for (File file : orphaned) if (file.isFile() && !file.delete()) throw new IOException("Не удалось очистить временный экспорт");
    }
    private static void id(String id) {
        if (id == null || !id.matches("[a-zA-Z0-9_-]{1,128}")) throw new IllegalArgumentException("Неверный exportId");
    }
    public synchronized int begin(String id, String filename, long expected) throws IOException {
        id(id);
        if (filename == null || !filename.matches("[a-zA-Z0-9_.-]{1,120}\\.json") || filename.contains("..")) throw new IllegalArgumentException("Неверное имя файла");
        if (expected <= 0 || expected > MAX_BYTES) throw new IllegalArgumentException("Файл должен быть не больше 32 MiB");
        Active old = active.get(id);
        if (old != null) {
            if (!old.filename.equals(filename) || old.expected != expected) throw new IllegalArgumentException("Конфликт begin");
            return old.sequence;
        }
        if (completed.containsKey(id)) throw new IllegalArgumentException("Экспорт уже завершён");
        if (active.size() >= 2) throw new IllegalStateException("Сначала завершите текущий экспорт");
        active.put(id, new Active(new File(directory, id + ".part"), filename, expected));
        return 0;
    }
    private Active get(String id) { id(id); Active value = active.get(id); if (value == null) throw new IllegalStateException("Экспорт не начат"); return value; }
    public synchronized int append(String id, int sequence, String base64) throws IOException {
        Active value = get(id);
        if (base64 == null || base64.length() == 0 || base64.length() > MAX_BASE64_CHARS) throw new IllegalArgumentException("Превышен размер части");
        byte[] bytes;
        try { bytes = Base64.getDecoder().decode(base64); } catch (IllegalArgumentException error) { throw new IllegalArgumentException("Повреждённая часть", error); }
        if (bytes.length > MAX_CHUNK_BYTES) throw new IllegalArgumentException("Превышен размер части");
        byte[] digest;
        try { digest = MessageDigest.getInstance("SHA-256").digest(bytes); } catch (NoSuchAlgorithmException impossible) { throw new IllegalStateException(impossible); }
        if (sequence == value.sequence - 1 && MessageDigest.isEqual(digest, value.lastDigest)) return sequence;
        if (sequence != value.sequence) throw new IllegalArgumentException("Нарушен порядок частей");
        if (value.bytes + bytes.length > value.expected) throw new IllegalArgumentException("Превышен объявленный размер файла");
        try { value.stream.write(bytes); } catch (IOException error) { abort(id); throw error; }
        value.bytes += bytes.length; value.sequence++; value.lastDigest = digest;
        return sequence;
    }
    public synchronized File finish(String id) throws IOException {
        id(id); File done = completed.get(id); if (done != null) return done;
        Active value = get(id);
        if (value.bytes != value.expected) throw new IllegalArgumentException("Файл получен не полностью");
        try { value.stream.getFD().sync(); value.stream.close(); }
        catch (IOException error) { abort(id); throw error; }
        File target = new File(directory, id + ".json");
        if (target.exists() || !value.file.renameTo(target)) { abort(id); throw new IOException("Не удалось завершить файл"); }
        active.remove(id); completed.put(id, target);
        while (completed.size() > 16) completed.remove(completed.keySet().iterator().next());
        return target;
    }
    public synchronized void abort(String id) throws IOException {
        id(id); Active value = active.remove(id); if (value == null) return;
        try { value.stream.close(); } finally { if (value.file.exists() && !value.file.delete()) throw new IOException("Не удалось удалить временный файл"); }
    }
    public synchronized void close() {
        for (String id : active.keySet().toArray(new String[0])) { try { abort(id); } catch (IOException ignored) { /* Only this export's temporary file is touched. */ } }
    }
}
