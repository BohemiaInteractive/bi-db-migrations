## 0.6.2

* [FIXED] `--json` option of the `mig:status` command printed invalid json when executed as cli shell command
* [FIXED] `migrate` & `seed` & `mig:status` commands should not require `project-root/migrations/src` directory to be present

## 0.6.1

* [ADDED] `--json` option to the `mig:status` command which will dump data in json format

## 0.6.0

* [ADDED] - new `--genesis-version` option to the `migrate` command
* [ADDED] - `mig:status` command prints info about which verions are about to be migrated
* [CHANGED] - `mig:status` does not fail with an error if `migrations` db table does not exists - it just prints versions which will be migrated

## 0.5.0

* [FIXED] - generate proper readme file in the `migrations` directory as opposed to current empty file
* [CHANGED] - postgres migrations are generated so that DDL and DML changes are interpolated as opposed to all DDL changes to tables being executed first (previous behavior)

## 0.4.2

* [FIXED] - incorrect failure when executing a command against a project with no `git` repository initialized

## 0.4.1

* [FIXED] - `bi-db-migrate` executable did not repond to any commands

## 0.4.0

* [CHANGED] - npm package name renamed to `bi-db-migrations`
* [ADDED] - `bi-db-migrate` executable

## 0.3.1

* [FIXED] - CLI command functions were being executed with incorrect scope context

## 0.3.0

* [CHANGED] - API refactored so that all commands are wrapped into a `Migration` class so it's possible to construct multiple migration objects for multiple projects at once

## 0.2.0

* [FIXED] - init:seed command should create a sql file named `data.sql` instead of `seed.sql`
* [CHANGED] - current process is not exit when a command is called programatically, instead a Promise is returned

## 0.1.1

* [FIXED] - correcly resolve database table dependencies when generating a new migration

## 0.1.0

* [ADDED] - initial release
