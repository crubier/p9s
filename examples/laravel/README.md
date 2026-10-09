# Adopting p9s in a Laravel app

A [Laravel](https://laravel.com) API for projects and documents, as the [adoption tests](../adoption) describe it:
teams get access to projects, users to documents, and the app checks every request in its code.

## Before

[`before/`](./before) is the app as it was, a Laravel 13 API with Eloquent.
[`database/migrations`](./before/database/migrations) creates the tables, with foreign keys that cascade in the
database. [`app/Permissions.php`](./before/app/Permissions.php) works out the access of a user from the tables
`team_members`, `project_shares` and `document_shares`, and every action of
[`DocumentController`](./before/app/Http/Controllers/DocumentController.php) asks it first.

## The migration

[`p9s.config.json`](./p9s.config.json) describes the tables: users and teams are roles, projects and documents are
resources, a document is in its project. Its `links` name the tables where the app keeps memberships and shares, and
which bits each access gives. With `authentication.key`, the app tells p9s the id of the user in its `users` table, and
with `grantPrivileges`, the migration grants `app_user` what its permissions name.

After `php artisan migrate`, in the folder of the app, with `DATABASE_URL` set:

```bash
npx @p9s/cli postgres migrate --config p9s.config.json
```

It runs in one transaction, creates the role `app_user`, brings the rows of the link tables into the graph, and from
then on keeps the graph in step with them.

## After

[`after.patch`](./after.patch) adds the [`p9s/laravel`](../../packages/php) package, deletes `app/Permissions.php`,
and adds the `AsUser` middleware after the one that finds the user:

```php
Route::middleware(['authenticate', AsUser::class])->group(function () {
```

In `bootstrap/app.php`, it tells p9s where the middleware put the id of the user, and answers 403 to a write the
policies refused:

```php
->withExceptions(function (Exceptions $exceptions) {
    $exceptions->render(fn (QueryException $error) => P9s::isRefused($error)
        ? response()->json(['error' => 'forbidden'], 403)
        : null);
})
->booted(function () {
    P9s::resolveUserIdUsing(fn (Request $request) => $request->attributes->get('user_id'));
})
```

Each request then runs in a transaction that acts as its user, read only for `GET`, and the policies decide what each
query reads and writes. A write they refuse fails with `insufficient_privilege`, the transaction rolls back, and the app
answers 403. An update or a delete of a document the user reads but cannot change touches no row, and gets 403 too.
The models hide the `resource_id` column p9s adds, which Eloquent would otherwise read and render.

In an app, `composer require p9s/laravel`. The example takes the package of this repository, with a path repository in
`composer.json`.

## The test

[`adoption.test.ts`](./adoption.test.ts) runs the app before, the migration, and the app after on a real Postgres, with
PHP 8.4, Composer and the server of PHP, and checks that every user gets the same answers, see
[the adoption tests](../adoption):

```bash
P9S_ADOPTION_DATABASE_URL=postgresql://postgres@localhost:5432/postgres bun test examples/laravel
```
