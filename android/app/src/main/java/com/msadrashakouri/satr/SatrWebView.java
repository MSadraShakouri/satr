package com.msadrashakouri.satr;

import android.view.ActionMode;
import android.util.AttributeSet;
import android.content.Context;
import android.view.Menu;
import android.view.MenuItem;

import com.getcapacitor.CapacitorWebView;

/**
 * The note's WebView with one thing added: a <b>Line</b> item in Android's own
 * selection bar, the way Markor has it.
 *
 * Markor's editor is an EditText, and its whole-line selection is one item
 * added to the system selection menu —
 * {@code setCustomSelectionActionModeCallback()} with
 * {@code menu.add(0, R.string.option_select_lines, 0, "☰")}, whose handler is
 * {@code TextViewUtils.getLineSelection(this)} then {@code setSelection()}
 * (frontend/textview/HighlightingEditor.java). A WebView has no such setter,
 * so the item is added to the callback the WebView itself supplies, and it
 * asks the page to do the same thing — the page is where the note, and the
 * lines, are ({@code window.satrSelectionAction('line')}, src/main.ts).
 *
 * The callback is not replaced, only wrapped: the platform's own Copy, Cut,
 * Paste and Select all are the ones the reader expects, and they stay exactly
 * as they were — {@link #onCreateActionMode} builds the menu first through the
 * original callback and the item is appended to it.
 *
 * That bar, with that one item in it, is the only selection menu the app has:
 * the selection itself is the WebView's (Obsidian's is the same — its editor
 * ships no touch handling of its own, and its Android build registers no
 * selection plugin), so the double tap, the drag, the handles, the long press
 * and this bar all come from the platform, and the page adds nothing on top.
 */
public class SatrWebView extends CapacitorWebView {

    /** The item's id: outside the range the platform's own items use. */
    private static final int LINE_ITEM_ID = 0x5a7e0001;

    public SatrWebView(Context context, AttributeSet attrs) {
        super(context, attrs);
    }

    @Override
    public ActionMode startActionMode(ActionMode.Callback callback) {
        return super.startActionMode(new SatrActionMode(callback));
    }

    @Override
    public ActionMode startActionMode(ActionMode.Callback callback, int type) {
        return super.startActionMode(new SatrActionMode(callback), type);
    }

    private final class SatrActionMode implements ActionMode.Callback {
        private final ActionMode.Callback inner;

        SatrActionMode(ActionMode.Callback inner) {
            this.inner = inner;
        }

        @Override
        public boolean onCreateActionMode(ActionMode mode, Menu menu) {
            boolean created = inner.onCreateActionMode(mode, menu);
            if (created) {
                MenuItem item = menu.add(Menu.NONE, LINE_ITEM_ID, 100, "Line");
                item.setShowAsAction(MenuItem.SHOW_AS_ACTION_IF_ROOM);
                item.setShowAsActionFlags(MenuItem.SHOW_AS_ACTION_IF_ROOM | MenuItem.SHOW_AS_ACTION_WITH_TEXT);
            }
            return created;
        }

        @Override
        public boolean onPrepareActionMode(ActionMode mode, Menu menu) {
            return inner.onPrepareActionMode(mode, menu);
        }

        @Override
        public boolean onActionItemClicked(ActionMode mode, MenuItem item) {
            if (item.getItemId() == LINE_ITEM_ID) {
                // The page grows the selection to the whole line (or lines)
                // it touches. The bar stays up and follows the new selection —
                // it is the platform's own, so it re-reads the selection it
                // was raised for.
                evaluateJavascript("window.satrSelectionAction&&window.satrSelectionAction('line')", null);
                return true;
            }
            return inner.onActionItemClicked(mode, item);
        }

        @Override
        public void onDestroyActionMode(ActionMode mode) {
            inner.onDestroyActionMode(mode);
        }
    }
}
