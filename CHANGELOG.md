## FUTURE

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
