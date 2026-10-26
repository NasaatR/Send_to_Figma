package main

import (
	"html/template"
	"os"
	"path/filepath"
)

func writeGuide(path, app string) error {
	const page = `<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Send to Figma — установка</title><style>body{margin:48px auto;padding:0 24px;max-width:720px;font:16px/1.6 "Segoe UI",sans-serif;background:#171719;color:#eee}h1{font-size:28px;margin-bottom:0}h2{font-size:19px;margin-top:32px}p{color:#bdbdc5}input{box-sizing:border-box;width:100%;padding:12px;background:#252529;color:#fff;border:1px solid #49494f;border-radius:8px;font:14px monospace}a{color:#ddd}kbd{border:1px solid #555;border-radius:4px;padding:2px 5px}small{color:#aaa}ol{padding-left:24px}</style><h1>Send to Figma</h1><p>Помощник установлен. Осталось подключить браузер и Figma — один раз.</p><h2>1. Подключи расширение</h2><p>Скопируй адрес своего браузера в адресную строку:</p><input readonly value="chrome://extensions" aria-label="Адрес для Chrome" onclick="this.select()"><p>Для Edge: <code>edge://extensions</code>. Включи <b>Режим разработчика / Developer mode</b> → <b>Загрузить распакованное / Load unpacked</b>. В окне выбора папки вставь этот путь:</p><input readonly value="{{.Extension}}" aria-label="Папка расширения" onclick="this.select()"><p>Страница подключения откроется автоматически. Если нет — нажми значок расширения → <b>Подключение</b>.</p><h2>2. Подключи Figma Desktop</h2><p>В приложении Figma открой нужный файл. ПКМ по холсту → <b>Plugins → Development → Import plugin from manifest…</b>. В поле имени файла вставь:</p><input readonly value="{{.Plugin}}" aria-label="Манифест Figma" onclick="this.select()"><p>Запусти <b>Send to Figma · Receiver</b>. На странице подключения расширения скопируй код, вставь в плагин и нажми <b>Начать приём</b>.</p><h2>3. Проверь результат</h2><p>На странице расширения нажми <b>Отправить тестовое изображение</b>. В Figma появится тестовая карточка; расширение подтвердит вставку. Карточку можно удалить.</p><p>Теперь: <b>ПКМ по изображению на сайте → Отправить в Figma</b>. Для недоступного исходника выдели область экрана. Приёмник Figma должен оставаться запущенным.</p><h2>Обновление с 1.0.0</h2><p>Если расширение уже загружалось из папки Downloads, удали только старую запись расширения и загрузи постоянную папку выше. В Figma удали старый плагин из Development и импортируй новый путь. Очередь и изображения Figma сохраняются. При обновлении с 1.1.0 достаточно запустить Setup.exe, нажать ↻ у расширения и перезапустить приёмник.</p><p>После подключения распакованный архив можно удалить. Для передачи другому человеку используй исходный ZIP; каждый компьютер создаёт собственный код.</p><small>v{{.Version}} · Made by Nasaat</small></html>`
	t, e := template.New("guide").Parse(page)
	if e != nil {
		return e
	}
	f, e := os.Create(path)
	if e != nil {
		return e
	}
	defer f.Close()
	return t.Execute(f, map[string]string{"Extension": filepath.Join(app, "extension"), "Plugin": filepath.Join(app, "figma-plugin", "manifest.json"), "Version": version})
}
