import lab.maze.reboot.ExportStore;
import java.io.File;
import java.nio.file.Files;
import java.util.Arrays;
import java.util.Base64;
public final class ExportStoreTest {
    interface Action { void run() throws Exception; }
    static void rejects(Action action) throws Exception { boolean failed = false; try { action.run(); } catch (IllegalArgumentException | IllegalStateException | java.io.IOException expected) { failed = true; } if (!failed) throw new AssertionError("Expected rejection"); }
    static String base64(byte[] bytes) { return Base64.getEncoder().encodeToString(bytes); }
    public static void main(String[] args) throws Exception {
        File directory = Files.createTempDirectory("maze-export-test-").toFile();
        File orphan = new File(directory,"orphan.part"); Files.writeString(orphan.toPath(),"unfinished");
        ExportStore store = new ExportStore(directory);
        if (orphan.exists()) throw new AssertionError("Orphan temporary file survived restart");
        byte[] source = new byte[ExportStore.MAX_CHUNK_BYTES * 2 + 13];
        for (int i = 0; i < source.length; i++) source[i] = (byte)(i * 37);
        store.begin("good","maze.json",source.length);
        rejects(() -> store.finish("good"));
        byte[] first = Arrays.copyOfRange(source,0,ExportStore.MAX_CHUNK_BYTES);
        rejects(() -> store.append("good",1,base64(first)));
        store.append("good",0,base64(first)); store.append("good",0,base64(first));
        byte[] different = first.clone(); different[0]++;
        rejects(() -> store.append("good",0,base64(different)));
        store.append("good",1,base64(Arrays.copyOfRange(source,ExportStore.MAX_CHUNK_BYTES,ExportStore.MAX_CHUNK_BYTES * 2)));
        store.append("good",2,base64(Arrays.copyOfRange(source,ExportStore.MAX_CHUNK_BYTES * 2,source.length)));
        File completed = store.finish("good");
        if (!Arrays.equals(Files.readAllBytes(completed.toPath()),source)) throw new AssertionError("Byte stream changed");
        if (!store.finish("good").equals(completed)) throw new AssertionError("Finish not idempotent");
        store.abort("good"); if (!completed.isFile()) throw new AssertionError("Late cancel removed shared file");
        File other = new File(directory,"other.json"); Files.writeString(other.toPath(),"keep");
        store.begin("cancel","cancel.json",3); store.append("cancel",0,base64(new byte[]{1,2})); store.abort("cancel");
        if (new File(directory,"cancel.part").exists() || !other.isFile()) throw new AssertionError("Abort scope");
        rejects(() -> store.begin("../escape","file.json",1));
        rejects(() -> store.begin("name","../file.json",1));
        rejects(() -> store.begin("huge","file.json",ExportStore.MAX_BYTES+1));
        store.begin("overflow","file.json",1); rejects(() -> store.append("overflow",0,base64(new byte[]{1,2}))); store.abort("overflow");
        store.begin("large-chunk","file.json",ExportStore.MAX_BYTES); rejects(() -> store.append("large-chunk",0,"A".repeat(ExportStore.MAX_BASE64_CHARS+1))); store.abort("large-chunk");
        store.begin("one","one.json",1); store.begin("two","two.json",1); rejects(() -> store.begin("three","three.json",1));
        store.close();
        if (new File(directory,"one.part").exists() || new File(directory,"two.part").exists()) throw new AssertionError("Close left active parts");
        for (File file : directory.listFiles()) file.delete(); directory.delete();
        System.out.println("ExportStore: byte identity, bounds, sequence, retry, finish, scoped abort and cleanup passed");
    }
}
