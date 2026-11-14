package com.msadrashakouri.satr;

import java.io.File;
import java.io.IOException;
import java.io.OutputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.util.Arrays;

/** JVM test for session, length, path and exclusive-create behavior. Android's
 * Os-backed descriptor implementation still requires an Android environment. */
public final class ImageWriteStoreTest {
    private interface Checked { void run() throws Exception; }
    private static void mustFail(Checked run) throws Exception {
        try { run.run(); throw new AssertionError("operation unexpectedly succeeded"); }
        catch (IOException expected) { }
    }
    private static void check(boolean ok, String message) { if (!ok) throw new AssertionError(message); }
    // The host substitute models private staging and exclusive publication.
    // It does not prove Android Os or external-storage filesystem behaviour.
    private static final class Target implements ImageWriteStore.Target {
        final Path path, staging; final OutputStream output; boolean closed;
        Target(File file) throws IOException {
            path=file.toPath(); staging=Files.createTempFile("satr-private-image-", ".part");
            output=Files.newOutputStream(staging,StandardOpenOption.WRITE);
        }
        public void append(byte[] b) throws IOException { output.write(b); }
        public void finish() throws IOException {
            if(!closed){output.close();closed=true;}
            try(OutputStream out=Files.newOutputStream(path,StandardOpenOption.CREATE_NEW,StandardOpenOption.WRITE)){
                Files.copy(staging,out);
            } catch(java.nio.file.FileAlreadyExistsException e){throw new ImageWriteStore.Exists();}
            Files.delete(staging);
        }
        public void abort() throws IOException {if(!closed){output.close();closed=true;}Files.deleteIfExists(staging);}
    }
    public static void main(String[] args) throws Exception {
        Path dir = Files.createTempDirectory("satr-images-"); File root = dir.toFile();
        try (ImageWriteStore store = new ImageWriteStore(Target::new)) {
            byte[] first = new byte[ImageWriteStore.MAX_CHUNK], second = new byte[235];
            for (int i=0;i<first.length;i++) first[i]=(byte)(i*17);
            for (int i=0;i<second.length;i++) second[i]=(byte)(i*23);
            String id=store.begin(root,"Notes/res/image.png",first.length+second.length);
            store.append(id,first); store.append(id,second); store.finish(id);
            byte[] result=Files.readAllBytes(dir.resolve("Notes/res/image.png"));
            check(result.length==first.length+second.length,"length");
            check(Arrays.equals(first,Arrays.copyOfRange(result,0,first.length)),"first chunk");
            check(Arrays.equals(second,Arrays.copyOfRange(result,first.length,result.length)),"last chunk");
            String collision=store.begin(root,"Notes/res/image.png",1); store.append(collision,new byte[]{4});
            mustFail(() -> store.finish(collision)); store.abort(collision);
            check(Arrays.equals(result,Files.readAllBytes(dir.resolve("Notes/res/image.png"))),"collision changed original");
            String aborted=store.begin(root,"Notes/res/cancel.jpg",4); store.append(aborted,new byte[]{1,2});
            check(!Files.exists(dir.resolve("Notes/res/cancel.jpg")),"partial transfer reached the shared folder");
            mustFail(() -> store.finish(aborted)); store.abort(aborted);
            check(!Files.exists(dir.resolve("Notes/res/cancel.jpg")),"abort left partial image");
            String oversize=store.begin(root,"Notes/res/oversize.webp",1);
            mustFail(() -> store.append(oversize,new byte[]{1,2})); store.abort(oversize);
            mustFail(() -> store.begin(root,"../res/escape.png",1));
            mustFail(() -> store.begin(root,"Notes/res/../../escape.png",1));
            mustFail(() -> store.begin(root,"Notes/image.png",1));
            mustFail(() -> store.begin(root,"Notes/res/image.svg",1));
            mustFail(() -> store.begin(root,"Notes/res/zero.png",0));
            String recoveryPath="Notes/Satr recovery 00000000-0000-4000-8000-000000000001.md";
            String recovery=store.begin(root,recoveryPath,4,"backup");store.append(recovery,new byte[]{1,2,3,4});
            check(!Files.exists(dir.resolve(recoveryPath)),"backup reached shared storage before finish");store.finish(recovery);
            check(Arrays.equals(Files.readAllBytes(dir.resolve(recoveryPath)),new byte[]{1,2,3,4}),"backup bytes differ");
            String occupied=store.begin(root,recoveryPath,1,"backup");store.append(occupied,new byte[]{9});mustFail(() -> store.finish(occupied));store.abort(occupied);
            check(Arrays.equals(Files.readAllBytes(dir.resolve(recoveryPath)),new byte[]{1,2,3,4}),"backup collision changed original");
            mustFail(() -> store.begin(root,"Notes/A.md",1,"backup"));
            mustFail(() -> store.begin(root,"Notes/res/other.png",1,"unknown"));
            Path outside=Files.createTempDirectory("satr-outside-");
            try {
                Files.createSymbolicLink(dir.resolve("Notes/symlink"),outside);
                mustFail(() -> store.begin(root,"Notes/symlink/res/escape.png",1));
                Files.createSymbolicLink(dir.resolve("Notes/inside-link"),dir.resolve("Notes/res"));
                mustFail(() -> store.begin(root,"Notes/inside-link/res/a.png",1));
                Files.createSymbolicLink(dir.resolve("Notes/res/link.png"),outside.resolve("not-created.png"));
                String link=store.begin(root,"Notes/res/link.png",1); store.append(link,new byte[]{1});
                mustFail(() -> store.finish(link)); store.abort(link);
                check(!Files.exists(outside.resolve("not-created.png")),"followed final symlink");
            } finally { Files.deleteIfExists(outside); }
            String lingering=store.begin(root,"Notes/res/close.png",1); store.append(lingering,new byte[]{7});
        }
        check(!Files.exists(dir.resolve("Notes/res/close.png")),"close left unfinished image");
        try (java.util.stream.Stream<Path> all=Files.walk(dir)) { all.sorted(java.util.Comparator.reverseOrder()).forEach(path -> { try { Files.delete(path); } catch(IOException e) { throw new RuntimeException(e); } }); }
        System.out.println("ImageWriteStore: all JVM checks passed");
    }
}
