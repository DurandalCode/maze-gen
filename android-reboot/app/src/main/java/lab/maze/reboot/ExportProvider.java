package lab.maze.reboot;

import android.content.ContentProvider;
import android.content.ContentValues;
import android.database.Cursor;
import android.database.MatrixCursor;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import android.provider.OpenableColumns;
import java.io.File;
import java.io.FileNotFoundException;
import java.io.IOException;
import java.util.List;

/** Grants read access to one completed JSON export, never the rest of app storage. */
public final class ExportProvider extends ContentProvider {
    public boolean onCreate() { return true; }
    private File file(Uri uri) throws FileNotFoundException {
        List<String> parts = uri.getPathSegments();
        if (!uri.getAuthority().equals(getContext().getPackageName() + ".exports") || parts.size() != 2 || !parts.get(0).equals("exports") || !parts.get(1).matches("[a-zA-Z0-9_-]{1,128}\\.json")) throw new FileNotFoundException("Unknown export");
        try {
            File root = new File(getContext().getCacheDir(), "reboot-exports").getCanonicalFile();
            File file = new File(root, parts.get(1)).getCanonicalFile();
            if (!root.equals(file.getParentFile()) || !file.isFile()) throw new FileNotFoundException("Missing export");
            return file;
        } catch (IOException error) { throw new FileNotFoundException(error.getMessage()); }
    }
    public ParcelFileDescriptor openFile(Uri uri, String mode) throws FileNotFoundException {
        if (!"r".equals(mode)) throw new FileNotFoundException("Read only");
        return ParcelFileDescriptor.open(file(uri), ParcelFileDescriptor.MODE_READ_ONLY);
    }
    public String getType(Uri uri) { return "application/json"; }
    public Cursor query(Uri uri, String[] projection, String selection, String[] args, String order) {
        try {
            File file = file(uri);
            String[] columns = projection == null ? new String[] { OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE } : projection;
            MatrixCursor cursor = new MatrixCursor(columns); Object[] row = new Object[columns.length];
            for (int i = 0; i < columns.length; i++) row[i] = OpenableColumns.DISPLAY_NAME.equals(columns[i]) ? file.getName() : OpenableColumns.SIZE.equals(columns[i]) ? file.length() : null;
            cursor.addRow(row); return cursor;
        } catch (FileNotFoundException error) { return null; }
    }
    public Uri insert(Uri uri, ContentValues values) { throw new UnsupportedOperationException("Read only"); }
    public int update(Uri uri, ContentValues values, String selection, String[] args) { throw new UnsupportedOperationException("Read only"); }
    public int delete(Uri uri, String selection, String[] args) { throw new UnsupportedOperationException("Read only"); }
}
