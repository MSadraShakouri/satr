package com.msadrashakouri.satr;

import java.io.Closeable;
import java.io.File;
import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.channels.FileChannel;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;

/** Private, short-lived capabilities. Never returns an underlying path to JS. */
final class PdfRangeStore implements Closeable {
    static final long MAX_SIZE = 0xffffffffL;
    static final int MAX_RANGE = 1024 * 1024;
    private static final int MAX_HANDLES = 16;
    static final class Opened {
        final String token; final long size;
        Opened(String token, long size) { this.token = token; this.size = size; }
    }
    private static final class Source implements Closeable {
        final FileChannel channel; final Closeable owner; final long base, size;
        final File file, temp; final long modified;
        Source(FileChannel channel, Closeable owner, long base, long size, File file, File temp) {
            this.channel = channel; this.owner = owner; this.base = base; this.size = size;
            this.file = file; this.temp = temp; this.modified = file == null ? 0 : file.lastModified();
        }
        public void close() throws IOException {
            try { owner.close(); } finally { if (temp != null) temp.delete(); }
        }
    }
    private final Map<String, Source> sources = new HashMap<>();
    private boolean closed;
    synchronized Opened add(FileChannel channel, Closeable owner, long base, long size, File file, File temp) throws IOException {
        if (closed || sources.size() >= MAX_HANDLES || base < 0 || size <= 0 || size > MAX_SIZE || base > Long.MAX_VALUE - size) throw new IOException("Unsupported PDF source");
        // Prove this is seekable before registering. Positional reads do not
        // alter the descriptor's offset shared with the provider.
        ByteBuffer one = ByteBuffer.allocate(1);
        if (channel.read(one, base) != 1) throw new IOException("PDF source is not seekable");
        String token = UUID.randomUUID().toString();
        sources.put(token, new Source(channel, owner, base, size, file, temp));
        return new Opened(token, size);
    }
    synchronized byte[] read(String token, long offset, int length) throws IOException {
        Source source = sources.get(token);
        if (source == null || offset < 0 || length <= 0 || length > MAX_RANGE || offset > source.size - length) throw new IOException("Invalid PDF range");
        if (source.file != null && (source.file.length() != source.size || source.file.lastModified() != source.modified)) throw new IOException("PDF changed while open");
        ByteBuffer buffer = ByteBuffer.allocate(length);
        while (buffer.hasRemaining()) {
            int count = source.channel.read(buffer, source.base + offset + buffer.position());
            if (count <= 0) throw new IOException("Short PDF read");
        }
        return buffer.array();
    }
    synchronized void close(String token) {
        Source source = sources.remove(token);
        if (source != null) try { source.close(); } catch (IOException ignored) { }
    }
    @Override public synchronized void close() {
        closed = true;
        for (Source source : sources.values()) try { source.close(); } catch (IOException ignored) { }
        sources.clear();
    }
    static File vaultFile(File root, String path) throws IOException {
        if (path == null || path.isEmpty() || path.startsWith("/") || path.indexOf('\0') >= 0) throw new IOException("Invalid vault path");
        File base = root.getCanonicalFile();
        File result = new File(base, path).getCanonicalFile();
        if (!result.getPath().startsWith(base.getPath() + File.separator) || !result.isFile()) throw new IOException("Invalid vault path");
        return result;
    }
}
