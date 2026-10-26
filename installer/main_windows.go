//go:build windows

package main

import (
	"errors"
	"flag"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"time"
	"unsafe"
)

var user32 = syscall.NewLazyDLL("user32.dll")
var shell32 = syscall.NewLazyDLL("shell32.dll")
var kernel32 = syscall.NewLazyDLL("kernel32.dll")
var advapi32 = syscall.NewLazyDLL("advapi32.dll")
var browserKeys = []string{`Software\Google\Chrome\NativeMessagingHosts\com.sendtofigma.bridge`, `Software\Microsoft\Edge\NativeMessagingHosts\com.sendtofigma.bridge`}

const uninstallKey = `Software\Microsoft\Windows\CurrentVersion\Uninstall\SendToFigma`

func wide(s string) *uint16 { p, _ := syscall.UTF16PtrFromString(s); return p }
func message(s string, errorBox bool) {
	flags := uintptr(0x40)
	if errorBox {
		flags = 0x10
	}
	user32.NewProc("MessageBoxW").Call(0, uintptr(unsafe.Pointer(wide(s))), uintptr(unsafe.Pointer(wide("Send to Figma"))), flags)
}
func shellOpen(path string) error {
	r, _, _ := shell32.NewProc("ShellExecuteW").Call(0, uintptr(unsafe.Pointer(wide("open"))), uintptr(unsafe.Pointer(wide(path))), 0, 0, 1)
	if r <= 32 {
		return fmt.Errorf("Не удалось открыть инструкцию (%d). Откройте %s", r, path)
	}
	return nil
}
func registryOpen(key string, create bool) (syscall.Handle, error) {
	var h syscall.Handle
	if !create {
		return hOpen(key)
	}
	r, _, _ := advapi32.NewProc("RegCreateKeyExW").Call(uintptr(syscall.HKEY_CURRENT_USER), uintptr(unsafe.Pointer(wide(key))), 0, 0, 0, syscall.KEY_READ|syscall.KEY_WRITE|syscall.KEY_WOW64_64KEY, 0, uintptr(unsafe.Pointer(&h)), 0)
	if r != 0 {
		return 0, syscall.Errno(r)
	}
	return h, nil
}
func hOpen(key string) (syscall.Handle, error) {
	var h syscall.Handle
	e := syscall.RegOpenKeyEx(syscall.HKEY_CURRENT_USER, wide(key), 0, syscall.KEY_READ|syscall.KEY_WRITE|syscall.KEY_WOW64_64KEY, &h)
	return h, e
}
func regRead(key, name string) (string, bool, error) {
	h, e := hOpen(key)
	if e == syscall.ERROR_FILE_NOT_FOUND {
		return "", false, nil
	}
	if e != nil {
		return "", false, e
	}
	defer syscall.RegCloseKey(h)
	var kind, size uint32
	e = syscall.RegQueryValueEx(h, wide(name), nil, &kind, nil, &size)
	if e == syscall.ERROR_FILE_NOT_FOUND {
		return "", false, nil
	}
	if e != nil {
		return "", false, e
	}
	if kind != syscall.REG_SZ || size > 32768 {
		return "", false, errors.New("Неожиданный формат записи установки")
	}
	b := make([]uint16, size/2+1)
	e = syscall.RegQueryValueEx(h, wide(name), nil, &kind, (*byte)(unsafe.Pointer(&b[0])), &size)
	return syscall.UTF16ToString(b), true, e
}
func regWrite(key, name, value string) error {
	h, e := registryOpen(key, true)
	if e != nil {
		return e
	}
	defer syscall.RegCloseKey(h)
	v, _ := syscall.UTF16FromString(value)
	r, _, _ := advapi32.NewProc("RegSetValueExW").Call(uintptr(h), uintptr(unsafe.Pointer(wide(name))), 0, syscall.REG_SZ, uintptr(unsafe.Pointer(&v[0])), uintptr(len(v)*2))
	if r != 0 {
		return syscall.Errno(r)
	}
	return nil
}
func regDeleteValue(key, name string) error {
	h, e := hOpen(key)
	if e == syscall.ERROR_FILE_NOT_FOUND {
		return nil
	}
	if e != nil {
		return e
	}
	defer syscall.RegCloseKey(h)
	r, _, _ := advapi32.NewProc("RegDeleteValueW").Call(uintptr(h), uintptr(unsafe.Pointer(wide(name))))
	if r != 0 && r != 2 {
		return syscall.Errno(r)
	}
	return nil
}
func regDeleteKey(key string) error {
	r, _, _ := advapi32.NewProc("RegDeleteKeyExW").Call(uintptr(syscall.HKEY_CURRENT_USER), uintptr(unsafe.Pointer(wide(key))), syscall.KEY_WOW64_64KEY, 0)
	if r != 0 && r != 2 {
		return syscall.Errno(r)
	}
	return nil
}

type regChange struct {
	key, name, value string
	existed          bool
}

func registration(base string) (func(string) error, func() error) {
	changes := []regChange{}
	set := func(key, name, value string) error {
		old, exists, e := regRead(key, name)
		if e != nil {
			return e
		}
		changes = append(changes, regChange{key, name, old, exists})
		return regWrite(key, name, value)
	}
	apply := func(manifest string) error {
		for _, key := range browserKeys {
			if e := set(key, "", manifest); e != nil {
				return e
			}
		}
		values := map[string]string{"DisplayName": "Send to Figma", "DisplayVersion": version, "Publisher": "NasaatR", "InstallLocation": base, "UninstallString": `"` + filepath.Join(base, "Uninstall.exe") + `" --uninstall`, "DisplayIcon": filepath.Join(base, "Uninstall.exe")}
		for key, value := range values {
			if e := set(uninstallKey, key, value); e != nil {
				return e
			}
		}
		return nil
	}
	restore := func() error {
		var failures []error
		for i := len(changes) - 1; i >= 0; i-- {
			v := changes[i]
			var e error
			if v.existed {
				e = regWrite(v.key, v.name, v.value)
			} else {
				e = regDeleteValue(v.key, v.name)
			}
			if e != nil {
				failures = append(failures, e)
			}
		}
		return errors.Join(failures...)
	}
	return apply, restore
}
func stopHelpers(base string) error {
	snap, e := syscall.CreateToolhelp32Snapshot(syscall.TH32CS_SNAPPROCESS, 0)
	if e != nil {
		return e
	}
	defer syscall.CloseHandle(snap)
	var entry syscall.ProcessEntry32
	entry.Size = uint32(unsafe.Sizeof(entry))
	e = syscall.Process32First(snap, &entry)
	for e == nil {
		if strings.EqualFold(syscall.UTF16ToString(entry.ExeFile[:]), "send-to-figma-bridge.exe") {
			h, openError := syscall.OpenProcess(0x1000, false, entry.ProcessID)
			if openError == nil {
				b := make([]uint16, 32768)
				size := uint32(len(b))
				ok, _, _ := kernel32.NewProc("QueryFullProcessImageNameW").Call(uintptr(h), 0, uintptr(unsafe.Pointer(&b[0])), uintptr(unsafe.Pointer(&size)))
				syscall.CloseHandle(h)
				if ok != 0 {
					p := syscall.UTF16ToString(b[:size])
					if strings.EqualFold(p, filepath.Join(base, "app", "bin", "send-to-figma-bridge.exe")) || strings.EqualFold(p, filepath.Join(base, "bin", "send-to-figma-bridge.exe")) {
						process, e := syscall.OpenProcess(1|0x100000, false, entry.ProcessID)
						if e != nil {
							return fmt.Errorf("Закройте браузер перед обновлением: %w", e)
						}
						e = syscall.TerminateProcess(process, 0)
						if e == nil {
							event, waitError := syscall.WaitForSingleObject(process, 5000)
							if waitError != nil {
								e = waitError
							} else if event == 258 {
								e = errors.New("Помощник не завершился")
							}
						}
						syscall.CloseHandle(process)
						if e != nil {
							return e
						}
					}
				}
			}
		}
		e = syscall.Process32Next(snap, &entry)
	}
	if e != syscall.ERROR_NO_MORE_FILES {
		return e
	}
	return nil
}
func uninstall(base string) error {
	if e := stopHelpers(base); e != nil {
		return e
	}
	for _, key := range browserKeys {
		v, exists, e := regRead(key, "")
		if e != nil {
			return e
		}
		if exists && (strings.EqualFold(v, filepath.Join(base, "app", "native-host.json")) || strings.EqualFold(v, filepath.Join(base, "native-host.json"))) {
			if e = regDeleteKey(key); e != nil {
				return e
			}
		}
	}
	v, exists, e := regRead(uninstallKey, "InstallLocation")
	if e != nil {
		return e
	}
	if exists && strings.EqualFold(v, base) {
		if e = regDeleteKey(uninstallKey); e != nil {
			return e
		}
	}
	for _, name := range []string{"app", "bin", "native-host.json", "Uninstall.exe"} {
		if e = os.RemoveAll(filepath.Join(base, name)); e != nil {
			return e
		}
	}
	return nil
}
func run() error {
	quiet := flag.Bool("silent", false, "No dialogs or browser launch")
	remove := flag.Bool("uninstall", false, "Uninstall while retaining queued data")
	worker := flag.Bool("uninstall-worker", false, "Uninstall from a temporary copy")
	flag.Parse()
	base := filepath.Join(os.Getenv("LOCALAPPDATA"), "SendToFigma")
	if os.Getenv("LOCALAPPDATA") == "" {
		return errors.New("Не найдена папка LOCALAPPDATA")
	}
	exe, e := os.Executable()
	if e != nil {
		return e
	}
	if *remove && !*worker && strings.EqualFold(filepath.Dir(exe), base) {
		folder, e := os.MkdirTemp("", "send-to-figma-uninstall-")
		if e != nil {
			return e
		}
		temp := filepath.Join(folder, "Uninstall.exe")
		if e = copyFile(exe, temp); e != nil {
			return e
		}
		args := []string{"--uninstall", "--uninstall-worker"}
		if *quiet {
			args = append(args, "--silent")
		}
		cmd := exec.Command(temp, args...)
		cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
		if e = cmd.Start(); e != nil {
			return e
		}
		return nil
	}
	// Windows releases the mutex automatically even if setup crashes.
	mutex, _, mutexError := kernel32.NewProc("CreateMutexW").Call(0, 1, uintptr(unsafe.Pointer(wide("Local\\SendToFigma-Setup"))))
	if mutex == 0 {
		return mutexError
	}
	defer syscall.CloseHandle(syscall.Handle(mutex))
	if mutexError == syscall.ERROR_ALREADY_EXISTS {
		return errors.New("Установка уже запущена. Дождитесь её завершения")
	}
	if *remove {
		if *worker {
			time.Sleep(700 * time.Millisecond)
		}
		if e = uninstall(base); e != nil {
			return e
		}
		if !*quiet {
			message("Программа удалена. Очередь и код подключения сохранены.\nУдалите расширение в браузере и плагин Development в Figma. Изображения в файле Figma сохраняются.", false)
		}
		return nil
	}
	machine := os.Getenv("PROCESSOR_ARCHITEW6432")
	if machine == "" {
		machine = os.Getenv("PROCESSOR_ARCHITECTURE")
	}
	arch := ""
	switch strings.ToUpper(machine) {
	case "AMD64":
		arch = "amd64"
	case "ARM64":
		arch = "arm64"
	default:
		return errors.New("Требуется 64-разрядная Windows 10 или 11")
	}
	source := filepath.Dir(exe)
	if e = os.MkdirAll(base, 0700); e != nil {
		return e
	}
	// Place the uninstaller before registration, so Apps settings never points to a missing executable.
	uninstaller := filepath.Join(base, "Uninstall.exe")
	if e = copyFile(exe, uninstaller); e != nil {
		return e
	}
	register, restore := registration(base)
	if e = installPackage(source, base, arch, Hooks{Stop: func() error { return stopHelpers(base) }, Register: register, Restore: restore}); e != nil {
		return e
	}
	if !*quiet {
		return shellOpen(filepath.Join(base, "app", "START-HERE.html"))
	}
	return nil
}
func main() {
	if e := run(); e != nil {
		fmt.Fprintln(os.Stderr, e)
		if !strings.Contains(strings.Join(os.Args[1:], " "), "--silent") {
			message(e.Error(), true)
		}
		os.Exit(1)
	}
}
