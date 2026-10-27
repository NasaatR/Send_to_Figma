package main

import (
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"time"
)

type updateFile struct {
	rel     string
	existed bool
}

func updateError(rel string, cause error) error {
	return fmt.Errorf("Не удалось обновить %s. Закройте Chrome, Edge и Figma и повторите Setup.exe. Очередь и код подключения сохранены: %w", filepath.ToSlash(rel), cause)
}

// Check every parent without following links. Keep the app root and all
// existing directories in place, including directories held open by a host.
func updateParents(root, rel string, create bool, created *[]string) error {
	parts := strings.Split(filepath.Dir(rel), string(filepath.Separator))
	current := root
	for _, part := range parts {
		if part == "." {
			continue
		}
		current = filepath.Join(current, part)
		info, err := os.Lstat(current)
		if os.IsNotExist(err) {
			if create {
				if err = os.Mkdir(current, 0700); err != nil {
					return err
				}
				*created = append(*created, current)
			}
			continue
		}
		if err != nil {
			return err
		}
		if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
			return errors.New("Путь установки содержит ссылку или не является папкой")
		}
	}
	return nil
}

func replaceUpdateFile(from, to string) error {
	var err error
	for i := 0; i < 4; i++ {
		if err = os.Rename(from, to); err == nil {
			return nil
		}
		if i < 3 {
			time.Sleep(75 * time.Millisecond)
		}
	}
	return err
}

// The ordinary directory swap remains the fast path. This fallback snapshots
// all affected files before replacing any, and rolls back only its own writes.
// It never moves/deletes the app root or touches base/data.
func updateInPlace(stage, installed, base string, hooks Hooks) error {
	info, err := os.Lstat(installed)
	if err != nil {
		return updateError("папку app", err)
	}
	if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
		return errors.New("Папка app не является обычной папкой; файлы не изменены")
	}
	backup, err := os.MkdirTemp(base, ".update-backup-")
	if err != nil {
		return updateError("резервную копию", err)
	}
	keepBackup := false
	defer func() {
		if !keepBackup {
			os.RemoveAll(backup)
		}
	}()
	files := []updateFile{}
	err = filepath.WalkDir(stage, func(path string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if entry.IsDir() {
			return nil
		}
		if !entry.Type().IsRegular() {
			return errors.New("В новой версии найден необычный файл")
		}
		rel, e := filepath.Rel(stage, path)
		if e != nil {
			return e
		}
		if e = updateParents(installed, rel, false, nil); e != nil {
			return updateError(rel, e)
		}
		dest := filepath.Join(installed, rel)
		old, e := os.Lstat(dest)
		exists := e == nil
		if e != nil && !os.IsNotExist(e) {
			return updateError(rel, e)
		}
		if exists {
			if !old.Mode().IsRegular() {
				return updateError(rel, errors.New("Существующий путь не является обычным файлом"))
			}
			if e = copyFile(dest, filepath.Join(backup, rel)); e != nil {
				return updateError(rel, e)
			}
		}
		files = append(files, updateFile{rel, exists})
		return nil
	})
	if err != nil {
		return err
	}
	changed := []updateFile{}
	created := []string{}
	registrationAttempted := false
	rollback := func(cause error) error {
		problems := []error{}
		for i := len(changed) - 1; i >= 0; i-- {
			file := changed[i]
			dest := filepath.Join(installed, file.rel)
			if file.existed {
				// Keep the backup intact if restoration itself is blocked.
				restore := filepath.Join(stage, file.rel)
				if e := copyFile(filepath.Join(backup, file.rel), restore); e != nil {
					problems = append(problems, e)
					continue
				}
				if e := replaceUpdateFile(restore, dest); e != nil {
					problems = append(problems, e)
				}
			} else if e := os.Remove(dest); e != nil && !os.IsNotExist(e) {
				problems = append(problems, e)
			}
		}
		for i := len(created) - 1; i >= 0; i-- {
			os.Remove(created[i])
		}
		if registrationAttempted && hooks.Restore != nil {
			if e := hooks.Restore(); e != nil {
				problems = append(problems, e)
			}
		}
		if len(problems) > 0 {
			keepBackup = true
			return fmt.Errorf("%w; предыдущие файлы сохранены в %s, но восстановление не завершено: %v", cause, backup, errors.Join(problems...))
		}
		return cause
	}
	for _, file := range files {
		if err = updateParents(installed, file.rel, true, &created); err != nil {
			return rollback(updateError(file.rel, err))
		}
		if err = replaceUpdateFile(filepath.Join(stage, file.rel), filepath.Join(installed, file.rel)); err != nil {
			return rollback(updateError(file.rel, err))
		}
		changed = append(changed, file)
	}
	if hooks.Register != nil {
		registrationAttempted = true
		if err = hooks.Register(filepath.Join(installed, "native-host.json")); err != nil {
			return rollback(err)
		}
	}
	return nil
}
