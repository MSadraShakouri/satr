package com.msadrashakouri.satr;

import android.content.Context;
import android.os.Bundle;
import android.os.CancellationSignal;
import android.os.Handler;
import android.os.Looper;
import android.os.ParcelFileDescriptor;
import android.print.PageRange;
import android.print.PrintAttributes;
import android.print.PrintDocumentAdapter;
import android.print.PrintManager;
import android.view.ViewGroup;
import android.webkit.WebResourceRequest;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Export to PDF: hands the laid-out pages from src/exportPdf.ts to Android's
 * print dialog, where "Save as PDF" writes the file (as Markor does).
 *
 * The HTML arrives complete: pages already laid out by Paged.js, fonts
 * embedded as data URIs. It is loaded into a WebView of its own (scripts
 * off, no navigation) and printed on A4 with no margins, since the pages carry
 * their own 1in margins. The job, and so the suggested file name, is the
 * note's name.
 *
 * The print WebView is attached to the window, behind the app's own WebView
 * (a detached one can render fonts and images inconsistently), and removed
 * when the print job finishes.
 */
@CapacitorPlugin(name = "SatrPrint")
public class PrintPlugin extends Plugin {
    /** The WebView being printed, kept until its job finishes. */
    private WebView printView;

    private void dropPrintView(WebView view) {
        if (view == null) return;
        if (view.getParent() instanceof ViewGroup) ((ViewGroup) view.getParent()).removeView(view);
        view.destroy();
        if (printView == view) printView = null;
    }

    @PluginMethod
    public void print(PluginCall call) {
        final String html = call.getString("html");
        final String name = call.getString("name", "Satr");
        if (html == null || html.isEmpty()) {
            call.reject("Nothing to print");
            return;
        }
        getActivity().runOnUiThread(() -> {
            dropPrintView(printView);
            final WebView view = new WebView(getActivity());
            view.getSettings().setJavaScriptEnabled(false);
            // The pages are laid out for paper: view the document at the
            // paper's width, not the phone's, so nothing is scaled to fit it
            // (src/exportPdf.ts sends a matching viewport meta).
            view.getSettings().setUseWideViewPort(true);
            // A fixed size: the phone's font size setting doesn't scale the PDF.
            view.getSettings().setTextZoom(100);
            // Same 1px floor as the app WebView (SystemBarsPlugin). The pages
            // were measured with KaTeX's real strut height; an 8px minimum
            // here would inflate it again when Android draws the PDF.
            view.getSettings().setMinimumFontSize(1);
            view.getSettings().setMinimumLogicalFontSize(1);
            view.setWebViewClient(new WebViewClient() {
                private boolean started = false;

                @Override
                public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest request) {
                    return true; // links in the pages stay links in the PDF; never navigate here
                }

                @Override
                public void onPageFinished(WebView v, String url) {
                    if (started) return;
                    started = true;
                    // A moment for the embedded fonts and images to settle.
                    new Handler(Looper.getMainLooper()).postDelayed(() -> {
                        try {
                            PrintManager printManager = (PrintManager) getActivity().getSystemService(Context.PRINT_SERVICE);
                            final PrintDocumentAdapter inner = v.createPrintDocumentAdapter(name);
                            // Passes everything through; cleans up when the job is done.
                            PrintDocumentAdapter adapter = new PrintDocumentAdapter() {
                                @Override
                                public void onStart() {
                                    inner.onStart();
                                }

                                @Override
                                public void onLayout(PrintAttributes oldAttributes, PrintAttributes newAttributes, CancellationSignal cancel, LayoutResultCallback callback, Bundle extras) {
                                    inner.onLayout(oldAttributes, newAttributes, cancel, callback, extras);
                                }

                                @Override
                                public void onWrite(PageRange[] pages, ParcelFileDescriptor destination, CancellationSignal cancel, WriteResultCallback callback) {
                                    inner.onWrite(pages, destination, cancel, callback);
                                }

                                @Override
                                public void onFinish() {
                                    inner.onFinish();
                                    dropPrintView(view);
                                }
                            };
                            PrintAttributes attributes = new PrintAttributes.Builder()
                                .setMediaSize(PrintAttributes.MediaSize.ISO_A4)
                                .setMinMargins(PrintAttributes.Margins.NO_MARGINS)
                                .build();
                            printManager.print(name, adapter, attributes);
                            call.resolve();
                        } catch (Exception error) {
                            dropPrintView(view);
                            call.reject("Couldn't open the print dialog: " + error.getMessage(), error);
                        }
                    }, 400);
                }
            });
            printView = view;
            // Behind everything (index 0), full size, so it lays out like a real page.
            ViewGroup root = getActivity().findViewById(android.R.id.content);
            root.addView(view, 0, new ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
            view.loadDataWithBaseURL(null, html, "text/html", "UTF-8", null);
        });
    }
}
