---
sidebar_position: 13
---

# Laravel

The [`p9s/laravel`](https://github.com/crubier/p9s/tree/main/packages/php) package runs a closure in a transaction as a user, and its `AsUser` middleware runs every request as its user. [`examples/integrations/laravel`](https://github.com/crubier/p9s/tree/main/examples/integrations/laravel) adopts p9s in a Laravel API with it.

## p9s adopt

```bash
npx @p9s/cli adopt
composer update p9s/laravel
```

[`p9s adopt`](../packages/cli#adopt) adds `p9s/laravel` to `composer.json`, the `AsUser` middleware to the groups of `routes/api.php` that authenticate users, answers 403 to refused writes in `bootstrap/app.php`, and hides the columns of p9s in the models, as [below](#models). When the user is not `$request->user()`, `--user-id` with an expression of `$request`, like `$request->attributes->get('user_id')`, tells `AsUser` where it comes from. Then delete the permission checks, as in [the example](#the-example). The sections below are what it writes, for an app that makes the changes by hand.

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

[`before/`](https://github.com/crubier/p9s/tree/main/examples/integrations/laravel/before) checks every action with `app/Permissions.php`. [`adopt.patch`](https://github.com/crubier/p9s/blob/main/examples/integrations/laravel/adopt.patch) is what `p9s adopt` writes, with `--user-id` and the expression `$request->attributes->get('user_id')`: the package, the `AsUser` middleware after the one that finds the user, the 403 of refused writes, and the models. [`after.patch`](https://github.com/crubier/p9s/blob/main/examples/integrations/laravel/after.patch) is the rest, by hand: it deletes `Permissions.php` and its checks, and answers refused writes with the JSON of the app.
