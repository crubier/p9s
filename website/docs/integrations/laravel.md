---
sidebar_position: 13
---

# Laravel

The [`p9s/laravel`](https://github.com/crubier/p9s/tree/main/packages/php) package runs a closure in a transaction as a user, and its `AsUser` middleware runs every request as its user. [`examples/laravel`](https://github.com/crubier/p9s/tree/main/examples/laravel) adopts p9s in a Laravel API with it.

## Install

```bash
composer require p9s/laravel
```

## Config

The package reads the role and the setting from [the config](./adopting#the-config): `p9s.config.json` at the root of the Laravel app, or the file `P9S_CONFIG` names. Or set it:

```php
P9s::useIdentity(Identity::fromFile(base_path('config/p9s.config.json')));
```

## Each request as its user

```php
use P9s\AsUser;

Route::middleware(['auth:sanctum', AsUser::class])->group(function () {
    // ...
});
```

`AsUser` runs the rest of the request in a transaction as `$request->user()->getAuthIdentifier()`, read only for `GET` and `HEAD`, after the middleware that authenticates the user. For another user id, tell p9s where it is, in `bootstrap/app.php` or a service provider:

```php
P9s::resolveUserIdUsing(fn (Request $request) => $request->attributes->get('user_id'));
```

Laravel turns an exception of a controller into a response before the middleware sees it, so `AsUser` also rolls back when the response holds an exception. Elsewhere, in a job or a command, `P9s::asUser` runs a closure as a user:

```php
$documents = P9s::asUser($user->id, fn () => Document::orderByDesc('updated_at')->limit(50)->get(), readOnly: true);
```

`P9s::setUser($userId)` acts as the user for the rest of a transaction already begun. The settings end with the transaction, so a connection never keeps the identity of a previous request, with Octane too.

## Refused writes

`P9s::isRefused($error)` tells a write the policies refused, through the `QueryException` of Laravel. In `bootstrap/app.php`:

```php
->withExceptions(function (Exceptions $exceptions) {
    $exceptions->render(fn (QueryException $error) => P9s::isRefused($error)
        ? response()->json(['error' => 'forbidden'], 403)
        : null);
})
```

## The migration

After `php artisan migrate`:

```bash
npx @p9s/cli postgres migrate --config p9s.config.json
```

Or as a migration of Laravel, in `database/migrations`, which `php artisan migrate` then runs:

```bash
npx @p9s/cli postgres generate --config p9s.config.json --format laravel
```

## Models

The migration adds columns to the tables of roles and resources, like `resource_id`, with a default. Eloquent reads every column, so hide it from JSON:

```php
protected $hidden = ['resource_id'];
```

## The example

[`before/`](https://github.com/crubier/p9s/tree/main/examples/laravel/before) checks every action with `app/Permissions.php`. [`after.patch`](https://github.com/crubier/p9s/blob/main/examples/laravel/after.patch) deletes it, adds the `AsUser` middleware after the one that finds the user, and answers 403 to refused writes.
