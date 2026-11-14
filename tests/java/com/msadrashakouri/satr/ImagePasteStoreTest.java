package com.msadrashakouri.satr;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.Arrays;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.atomic.AtomicInteger;

public final class ImagePasteStoreTest {
    private interface Checked { void run() throws Exception; }
    private static void check(boolean ok,String message){if(!ok)throw new AssertionError(message);}
    private static void fail(Checked code)throws Exception {try{code.run();throw new AssertionError("expected IOException");}catch(IOException expected){}}
    private static final class Source implements ImagePasteStore.Source {
        int releases,opens; final boolean broken; Source(boolean broken){this.broken=broken;}
        @Override public InputStream open()throws IOException {opens++;if(broken)throw new IOException("denied");return new ByteArrayInputStream(new byte[]{1,2,3});}
        @Override public void release(){releases++;}
    }
    public static void main(String[]args)throws Exception {
        try(ImagePasteStore store=new ImagePasteStore()){
            Source source=new Source(false);String token=store.offer(source,"image/png");check(token.matches("[0-9a-f]{32}"),"token");
            ImagePasteStore.Opened opened=store.take(token);check(opened.type.equals("image/png"),"mime");fail(()->store.take(token));
            check(Arrays.equals(opened.input.readAllBytes(),new byte[]{1,2,3}),"bytes");check(source.releases==1,"release on EOF");opened.input.close();opened.input.close();store.discard(token);check(source.releases==1,"release once after close");
            Source failed=new Source(true);String bad=store.offer(failed,"image/png");fail(()->store.take(bad));check(failed.releases==1,"release on provider failure");
            Source expired=new Source(false);String old=store.offer(expired,"image/jpeg");store.discard(old);store.discard(old);fail(()->store.take(old));check(expired.releases==1,"release expiry once");
            Source[] held=new Source[4];for(int i=0;i<4;i++){held[i]=new Source(false);store.offer(held[i],"image/png");}fail(()->store.offer(new Source(false),"image/png"));store.close();for(Source item:held)check(item.releases==1,"close releases pending");fail(()->store.offer(new Source(false),"image/png"));
        }
        ImagePasteStore closing=new ImagePasteStore();Source active=new Source(false);ImagePasteStore.Opened activeOpen=closing.take(closing.offer(active,"image/png"));closing.close();activeOpen.input.close();check(active.releases==1,"closing the store releases active streams once");
        ImagePasteStore racing=new ImagePasteStore();CountDownLatch opening=new CountDownLatch(1),resume=new CountDownLatch(1);AtomicInteger released=new AtomicInteger(),closedInput=new AtomicInteger(),rejected=new AtomicInteger();
        ImagePasteStore.Source slow=new ImagePasteStore.Source(){public InputStream open()throws IOException{opening.countDown();try{resume.await();}catch(InterruptedException e){throw new IOException(e);}return new ByteArrayInputStream(new byte[]{1}){public void close()throws IOException{closedInput.incrementAndGet();super.close();}};}public void release(){released.incrementAndGet();}};
        String raceToken=racing.offer(slow,"image/png");Thread thread=new Thread(()->{try{racing.take(raceToken);}catch(IOException e){rejected.incrementAndGet();}});thread.start();opening.await();racing.close();resume.countDown();thread.join();check(rejected.get()==1&&released.get()==1&&closedInput.get()==1,"close during provider open preserves cleanup");
        try(ImagePasteStore store=new ImagePasteStore()){
            final int[] releases={0};ImagePasteStore.Source large=new ImagePasteStore.Source(){public InputStream open(){return new InputStream(){long left=ImagePasteStore.MAX_BYTES+1;public int read(){if(left--<=0)return -1;return 1;}public int read(byte[] b,int o,int n){if(left<=0)return -1;int size=(int)Math.min(left,n);Arrays.fill(b,o,o+size,(byte)1);left-=size;return size;}};}public void release(){releases[0]++;}};
            ImagePasteStore.Opened opened=store.take(store.offer(large,"image/png"));byte[] block=new byte[65536];long count=0;try{while(true){int n=opened.input.read(block);if(n<0)throw new AssertionError("oversize accepted");count+=n;}}catch(IOException expected){check(count==ImagePasteStore.MAX_BYTES,"limit");}finally{opened.input.close();}check(releases[0]==1,"oversize released");
        }
        System.out.println("ImagePasteStore: all JVM checks passed");
    }
}
