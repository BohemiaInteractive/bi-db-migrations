Relational database table schema & data migrations done with plain `SQL`.  
With support of `semver` and `git` release tags the package provides means to
comfortably maintain changes made to a database between individual software releases.

#### Features

* tightly coupled with semantic software versioning
* NodeJS module interface
* CLI interface
* mysql support
* postgres support

### External dependencies

* git

### How it works

The following is FS structure for migrations (under VCS - git):
```
migrations/
  src/
    country/
      schema.sql
      data.sql
    state/
      schema.sql
      data.sql
  1.0.0.sql
  1.1.0.sql
  ...
```

`migrations/src` folder contains directories (database tables) each with a file 
named `schema.sql` which initiallly contains `SQL` command creating the table  
and later grows with changes being made to the schema (new commands ALTERING the table are added to the `schema.sql` as new lines).  

Alongside the `schema.sql` file, there may be optional `data.sql` file  
containing `SQL` commands which manipulate with table data (`INSERT`|`UPDATE`|`DELETE`).

At the time of a new release (before a new git tag is created), single pure `SQL` migration  
script can be generated with the `init:migration` command (changes made to the tables since the last release are assembled in correct order and wrapped into a single transaction if possible).  
The generated migration file is placed in `migrations/${NPM_PACKAGE_VERSION}.sql`


##### NodeJS module interface

```javascript
    const Migration = require('bi-db-migrate');
    const mig = new Migration.Migration({/*options*/});

    mig.initSeedCmd({/*options*/});
    mig.initSchemaCmd({/*options*/});
    mig.initMigrationCmd({/*options*/});
    mig.migrationStatusCmd({/*options*/});
    mig.seedCmd({/*options*/});
    mig.migrateCmd({/*options*/});
```

The listed methods all return a `Promise` and are equal to functions which  
are executed when using the `CLI` interface.


##### CLI interface

```bash
> bi-db-migrate -h
node_modules/.bin/bi-db-migrate <command> [options]

Commands:
  init:seed       Creates a new seed file at $MIG_DIR/src/$TABLE/data.sql and opens it with $EDITOR
  init:schema     Creates a new schema file at $MIG_DIR/src/$TABLE/schema.sql and opens it with $EDITOR
  init:migration  Generates a new sql/js migration from the src/ table files                                     [aliases: init:mig]
  mig:status      List the status of migrations                                                                  [aliases: migration:status]
  migrate         Run pending migrations
  seed            Run seeder for specified table
  seed:all        Run every seeder

Options:
  --mig-dir          Base directory path for migrations (relative to project root dir)                           [string] [default: "migrations"]
  --interactive, -i  if not enabled, it will NOT prompt the user for anything.                                   [boolean] [default: false]
  --verbose, -v      Dumps more info to stdout                                                                   [count] [default: 1]
  -h, --help         Show help                                                                                   [boolean]
```


### Tests

```bash
> npm test
```
