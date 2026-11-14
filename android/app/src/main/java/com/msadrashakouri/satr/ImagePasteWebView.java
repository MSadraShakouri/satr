package com.msadrashakouri.satr;

import android.content.ClipData;
import android.content.ClipDescription;
import android.content.ClipboardManager;
import android.content.Context;
import android.graphics.Rect;
import android.view.ActionMode;
import android.view.Menu;
import android.view.MenuItem;
import android.view.View;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import android.util.AttributeSet;
import android.view.inputmethod.EditorInfo;
import android.view.inputmethod.InputConnection;
import android.view.inputmethod.InputConnectionWrapper;
import android.view.inputmethod.InputMethodManager;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import androidx.core.view.inputmethod.EditorInfoCompat;
import androidx.core.view.inputmethod.InputConnectionCompat;
import androidx.core.view.inputmethod.InputContentInfoCompat;
import com.getcapacitor.Bridge;
import com.getcapacitor.CapacitorWebView;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.Collections;

/** Preserve Capacitor's WebView and text input while allowing the note editor
 * to accept images explicitly committed by an Android keyboard. */
public final class ImagePasteWebView extends CapacitorWebView {
    private static final String PREFIX="/__satr_image_paste/";
    private static final String[] TYPES={"image/png","image/jpeg","image/webp","image/gif"};
    private final ImagePasteStore store=new ImagePasteStore();
    private final Handler main=new Handler(Looper.getMainLooper());
    private final ImagePasteFocus focus=new ImagePasteFocus();
    private volatile boolean destroyed;
    public ImagePasteWebView(Context context,AttributeSet attrs){super(context,attrs);}
    void setImagePasteEnabled(boolean value,long sequence,String session){
        if(!focus.update(session,sequence,value))return;
        // EditorInfo belongs to the current input connection, so recreate it
        // only when entering/leaving the note, not on each keystroke.
        InputMethodManager imm=(InputMethodManager)getContext().getSystemService(Context.INPUT_METHOD_SERVICE);
        if(imm!=null&&hasFocus())imm.restartInput(this);
    }
    private static String imageType(ClipDescription description){
        if(description==null)return null;for(String type:TYPES)if(description.hasMimeType(type))return type;return null;
    }
    @Override public InputConnection onCreateInputConnection(EditorInfo info){
        InputConnection original=super.onCreateInputConnection(info);
        if(original==null || !focus.enabled())return original;
        EditorInfoCompat.setContentMimeTypes(info,TYPES);
        InputConnection rich=InputConnectionCompat.createWrapper(original,info,(content,flags,opts)->{
            if(!focus.enabled())return false;
            String type=imageType(content.getDescription());Uri uri=content.getContentUri();
            if(type==null || uri==null || !"content".equals(uri.getScheme()))return false;
            boolean grant=(flags & InputConnectionCompat.INPUT_CONTENT_GRANT_READ_URI_PERMISSION)!=0;
            try{if(grant)content.requestPermission();}catch(Exception e){return false;}
            boolean accepted=offer(uri,type,grant?content:null);
            if(!accepted && grant)try{content.releasePermission();}catch(Exception ignored){}
            return accepted;
        });
        return new InputConnectionWrapper(rich,false){
            @Override public boolean performContextMenuAction(int id){
                if(id==android.R.id.paste && tryPasteClipboard())return true;
                return super.performContextMenuAction(id);
            }
        };
    }
    // WebView is not an EditText: preserve its action-mode callback, and only
    // intercept a standard Paste action if the clip is an image without text.
    private ActionMode.Callback wrap(ActionMode.Callback callback){return new ActionMode.Callback2(){
        @Override public boolean onCreateActionMode(ActionMode mode,Menu menu){return callback.onCreateActionMode(mode,menu);}
        @Override public boolean onPrepareActionMode(ActionMode mode,Menu menu){return callback.onPrepareActionMode(mode,menu);}
        @Override public boolean onActionItemClicked(ActionMode mode,MenuItem item){
            if(item.getItemId()==android.R.id.paste && tryPasteClipboard())return true;
            return callback.onActionItemClicked(mode,item);
        }
        @Override public void onDestroyActionMode(ActionMode mode){callback.onDestroyActionMode(mode);}
        @Override public void onGetContentRect(ActionMode mode,View view,Rect rect){
            if(callback instanceof ActionMode.Callback2)((ActionMode.Callback2)callback).onGetContentRect(mode,view,rect);
            else super.onGetContentRect(mode,view,rect);
        }
    };}
    @Override public ActionMode startActionMode(ActionMode.Callback callback){return super.startActionMode(focus.enabled()?wrap(callback):callback);}
    @Override public ActionMode startActionMode(ActionMode.Callback callback,int type){return super.startActionMode(focus.enabled()?wrap(callback):callback,type);}
    private boolean tryPasteClipboard(){
        if(focus.enabled()){
            try{
                ClipboardManager clipboard=(ClipboardManager)getContext().getSystemService(Context.CLIPBOARD_SERVICE);
                String type=clipboard==null?null:imageType(clipboard.getPrimaryClipDescription());
                // Avoid reading the clipboard contents on the ordinary text path.
                ClipData clip=type==null?null:clipboard.getPrimaryClip();
                if(clip!=null)type=imageType(clip.getDescription());
                if(clip!=null && type!=null && clip.getItemCount()==1){ClipData.Item item=clip.getItemAt(0);Uri uri=item.getUri();
                    // Text and mixed clips keep WebView's normal paste behavior.
                    if(item.getText()==null && item.getHtmlText()==null && uri!=null && "content".equals(uri.getScheme()) && offer(uri,type,null))return true;
                }
            }catch(Exception ignored){/* let WebView handle ordinary paste */}
        }
        return false;
    }
    private boolean offer(Uri uri,String type,InputContentInfoCompat grant){
        ImagePasteStore.Source source=new ImagePasteStore.Source(){
            @Override public InputStream open() throws IOException {return getContext().getContentResolver().openInputStream(uri);}
            @Override public void release(){if(grant!=null)try{grant.releasePermission();}catch(Exception ignored){}}
        };
        if(destroyed)return false;
        final String token;try{token=store.offer(source,type);}catch(IOException e){return false;}
        main.postDelayed(()->store.discard(token),30000);
        // Token and MIME are restricted to literals above, not provider strings.
        post(()->evaluateJavascript("document.dispatchEvent(new CustomEvent('satr:native-image-paste',{detail:{token:'"+token+"',type:'"+type+"'}}))",null));
        return true;
    }
    WebResourceResponse intercept(Bridge bridge,WebResourceRequest request){
        Uri url=request.getUrl();String path=url.getPath();
        if(!bridge.getScheme().equalsIgnoreCase(url.getScheme()) || !bridge.getHost().equalsIgnoreCase(url.getHost()) || path==null || !path.startsWith(PREFIX))return null;
        String token=path.substring(PREFIX.length());
        if(!"GET".equals(request.getMethod()) || !token.matches("[0-9a-f]{32}") || url.getQuery()!=null)return missing();
        try{ImagePasteStore.Opened opened=store.take(token);return new WebResourceResponse(opened.type,null,200,"OK",Collections.singletonMap("Cache-Control","no-store"),opened.input);}
        catch(Exception e){return missing();}
    }
    private static WebResourceResponse missing(){return new WebResourceResponse("text/plain","UTF-8",404,"Not Found",Collections.singletonMap("Cache-Control","no-store"),new ByteArrayInputStream(new byte[0]));}
    @Override public void destroy(){destroyed=true;new Thread(store::close,"satr-image-paste-close").start();super.destroy();}
}
