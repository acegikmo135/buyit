package main

import (
	"embed"
	"os"
	"path/filepath"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
	"github.com/wailsapp/wails/v2/pkg/options/windows"
)

//go:embed all:frontend/dist
var assets embed.FS

func main() {
	app := NewApp()

	// Keep the embedded browser lean: single renderer, no background services, capped JS heap.
	if os.Getenv("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS") == "" {
		os.Setenv("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS",
			"--renderer-process-limit=1 --disable-background-networking --disable-component-update "+
				"--disable-features=Translate,OptimizationHints,msSmartScreenProtection --js-flags=--max-old-space-size=384")
	}

	dataDir := filepath.Join(os.Getenv("LOCALAPPDATA"), "AiSheet", "WebView2")

	err := wails.Run(&options.App{
		Title:            "AiSheet",
		Width:            1380,
		Height:           860,
		MinWidth:         980,
		MinHeight:        600,
		BackgroundColour: &options.RGBA{R: 250, G: 250, B: 251, A: 255},
		AssetServer:      &assetserver.Options{Assets: assets},
		OnStartup:        app.startup,
		OnBeforeClose:    app.beforeClose,
		Bind:             []interface{}{app},
		// Opening a spreadsheet while AiSheet is running (double-click / "Open with") reuses this window.
		SingleInstanceLock: &options.SingleInstanceLock{
			UniqueId:               "app.aisheet.desktop.single-instance",
			OnSecondInstanceLaunch: app.onSecondInstance,
		},
		DragAndDrop: &options.DragAndDrop{EnableFileDrop: true, DisableWebViewDrop: true},
		Windows: &windows.Options{
			WebviewUserDataPath: dataDir,
			Theme:               windows.SystemDefault,
		},
	})
	if err != nil {
		println("Error:", err.Error())
	}
}
