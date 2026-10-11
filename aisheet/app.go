package main

import (
	"bytes"
	"context"
	"encoding/base64"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/runtime"
	"github.com/zalando/go-keyring"
)

const keyringService = "AiSheet"

var openable = map[string]bool{".xlsx": true, ".xlsm": true, ".csv": true, ".tsv": true}

// App is bound to the frontend (window.go.main.App.*).
type App struct {
	ctx     context.Context
	mu      sync.Mutex
	streams map[string]context.CancelFunc
	dirty   bool
}

func NewApp() *App { return &App{streams: map[string]context.CancelFunc{}} }

func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
	runtime.OnFileDrop(ctx, func(_, _ int, paths []string) {
		for _, p := range paths {
			if openable[strings.ToLower(filepath.Ext(p))] {
				runtime.EventsEmit(ctx, "open-file", p)
				return
			}
		}
		runtime.EventsEmit(ctx, "toast", "Unsupported file type. Drop an .xlsx, .csv or .tsv file.")
	})
}

func (a *App) onSecondInstance(data options.SecondInstanceData) {
	runtime.WindowUnminimise(a.ctx)
	runtime.WindowShow(a.ctx)
	runtime.WindowSetAlwaysOnTop(a.ctx, true)
	runtime.WindowSetAlwaysOnTop(a.ctx, false)
	for _, arg := range data.Args {
		if p := validFile(arg); p != "" {
			runtime.EventsEmit(a.ctx, "open-file", p)
			return
		}
	}
}

func (a *App) beforeClose(ctx context.Context) (prevent bool) {
	a.mu.Lock()
	dirty := a.dirty
	a.mu.Unlock()
	if !dirty {
		return false
	}
	res, err := runtime.MessageDialog(ctx, runtime.MessageDialogOptions{
		Type:          runtime.QuestionDialog,
		Title:         "AiSheet",
		Message:       "You have unsaved changes. Close without saving?",
		Buttons:       []string{"Close without saving", "Cancel"},
		DefaultButton: "Cancel",
		CancelButton:  "Cancel",
	})
	return err != nil || res != "Close without saving"
}

func validFile(p string) string {
	p = strings.Trim(p, `"`)
	if p == "" || strings.HasPrefix(p, "-") {
		return ""
	}
	if !openable[strings.ToLower(filepath.Ext(p))] {
		return ""
	}
	if st, err := os.Stat(p); err != nil || st.IsDir() {
		return ""
	}
	return p
}

// GetLaunchFile returns the spreadsheet passed on the command line (double-click / Open with), or "".
func (a *App) GetLaunchFile() string {
	for _, arg := range os.Args[1:] {
		if p := validFile(arg); p != "" {
			return p
		}
	}
	return ""
}

func (a *App) SetDirty(d bool) {
	a.mu.Lock()
	a.dirty = d
	a.mu.Unlock()
}

func (a *App) SetTitle(t string) { runtime.WindowSetTitle(a.ctx, t) }

// ---------- files ----------

// ReadFile returns the file as base64 (binary-safe over the JS bridge).
func (a *App) ReadFile(path string) (string, error) {
	if !openable[strings.ToLower(filepath.Ext(path))] {
		return "", fmt.Errorf("unsupported file type")
	}
	b, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}
	return base64.StdEncoding.EncodeToString(b), nil
}

func (a *App) WriteFile(path, b64 string) error {
	b, err := base64.StdEncoding.DecodeString(b64)
	if err != nil {
		return err
	}
	tmp := path + ".aisheet-tmp"
	if err := os.WriteFile(tmp, b, 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, path) // atomic-ish: never leaves a half-written workbook
}

func (a *App) PickOpen() (string, error) {
	return runtime.OpenFileDialog(a.ctx, runtime.OpenDialogOptions{
		Title:   "Open spreadsheet",
		Filters: []runtime.FileFilter{{DisplayName: "Spreadsheets (*.xlsx, *.csv, *.tsv)", Pattern: "*.xlsx;*.xlsm;*.csv;*.tsv"}},
	})
}

func (a *App) PickSave(defaultName string) (string, error) {
	ext := strings.ToLower(filepath.Ext(defaultName))
	pattern, name := "*.xlsx", "Excel workbook (*.xlsx)"
	if ext == ".csv" {
		pattern, name = "*.csv", "CSV (*.csv)"
	}
	return runtime.SaveFileDialog(a.ctx, runtime.SaveDialogOptions{
		Title: "Save", DefaultFilename: defaultName,
		Filters: []runtime.FileFilter{{DisplayName: name, Pattern: pattern}},
	})
}

func (a *App) Confirm(message string) bool {
	res, err := runtime.MessageDialog(a.ctx, runtime.MessageDialogOptions{
		Type: runtime.QuestionDialog, Title: "AiSheet", Message: message,
		Buttons: []string{"Yes", "No"}, DefaultButton: "No", CancelButton: "No",
	})
	return err == nil && res == "Yes"
}

// ---------- secrets (Windows Credential Manager) ----------

func (a *App) SecretSet(name, value string) error {
	if value == "" {
		err := keyring.Delete(keyringService, name)
		if err == keyring.ErrNotFound {
			return nil
		}
		return err
	}
	return keyring.Set(keyringService, name, value)
}

func (a *App) SecretGet(name string) string {
	v, err := keyring.Get(keyringService, name)
	if err != nil {
		return ""
	}
	return v
}

// ---------- HTTP with streaming (no CORS, keys never touch webview networking) ----------

type HttpRequest struct {
	ID      string            `json:"id"`
	Method  string            `json:"method"`
	URL     string            `json:"url"`
	Headers map[string]string `json:"headers"`
	Body    string            `json:"body"`
}

type HttpStart struct {
	Status  int               `json:"status"`
	Headers map[string]string `json:"headers"`
}

var httpClient = &http.Client{Timeout: 0, Transport: &http.Transport{
	Proxy:                 http.ProxyFromEnvironment,
	ResponseHeaderTimeout: 60 * time.Second,
	TLSHandshakeTimeout:   15 * time.Second,
	IdleConnTimeout:       30 * time.Second,
}}

// HttpStream performs the request and emits "http:<id>" events: {t:"start"}, {t:"chunk",d:<base64>}, {t:"end"} | {t:"error"}.
// Returns immediately; the transfer runs on its own goroutine.
func (a *App) HttpStream(req HttpRequest) {
	ctx, cancel := context.WithCancel(a.ctx)
	a.mu.Lock()
	a.streams[req.ID] = cancel
	a.mu.Unlock()
	topic := "http:" + req.ID
	emit := func(m map[string]any) { runtime.EventsEmit(a.ctx, topic, m) }

	go func() {
		defer func() {
			cancel()
			a.mu.Lock()
			delete(a.streams, req.ID)
			a.mu.Unlock()
		}()
		method := req.Method
		if method == "" {
			method = "GET"
		}
		var body io.Reader
		if req.Body != "" {
			body = bytes.NewReader([]byte(req.Body))
		}
		hr, err := http.NewRequestWithContext(ctx, method, req.URL, body)
		if err != nil {
			emit(map[string]any{"t": "error", "m": err.Error()})
			return
		}
		for k, v := range req.Headers {
			hr.Header.Set(k, v)
		}
		resp, err := httpClient.Do(hr)
		if err != nil {
			emit(map[string]any{"t": "error", "m": err.Error()})
			return
		}
		defer resp.Body.Close()
		h := map[string]string{}
		for k := range resp.Header {
			h[strings.ToLower(k)] = resp.Header.Get(k)
		}
		emit(map[string]any{"t": "start", "status": resp.StatusCode, "headers": h})
		buf := make([]byte, 16*1024)
		for {
			n, rerr := resp.Body.Read(buf)
			if n > 0 {
				emit(map[string]any{"t": "chunk", "d": base64.StdEncoding.EncodeToString(buf[:n])})
			}
			if rerr != nil {
				if rerr != io.EOF && ctx.Err() == nil {
					emit(map[string]any{"t": "error", "m": rerr.Error()})
					return
				}
				break
			}
		}
		emit(map[string]any{"t": "end"})
	}()
}

func (a *App) HttpAbort(id string) {
	a.mu.Lock()
	c := a.streams[id]
	a.mu.Unlock()
	if c != nil {
		c()
	}
}
