---
sidebar_position: 12
---

# PHP

[`p9s/laravel`](https://github.com/crubier/p9s/tree/main/packages/php) on Packagist runs a closure in a transaction as a user, and its `AsUser` middleware every request as its user, with Eloquent and Laravel.

Guide: [Laravel](../integrations/laravel). Example: [Laravel](https://github.com/crubier/p9s/tree/main/examples/integrations/laravel).

## Install

```bash
composer require p9s/laravel
```

PHP 8.2 or later, with `illuminate/database` and `illuminate/http` 11, 12 or 13.

## P9s

### identity and useIdentity

`P9s::identity()` returns the [`Identity`](#identity) of `p9s.config.json`: the file `P9S_CONFIG` names, or the one at the root of the Laravel app, read once. `P9s::useIdentity($identity)` sets another, or `null` to read the file again.

### asUser

```php
use P9s\P9s;

$titles = P9s::asUser($userId, fn () => Document::pluck('title'), readOnly: true);
```

`P9s::asUser($userId, $callback, readOnly: false, role: null, settings: [], connection: null, identity: null)` runs the closure in a transaction of the connection as the user, `$connection->transaction()`, and returns what it returns. Every query of the closure goes through the policies. It commits when the closure returns, and rolls back when it throws. Inside a transaction already, it acts as the user until that transaction ends.

| Argument | |
| --- | --- |
| `readOnly` | Runs `set transaction read only` first |
| `role` | Another role of `engine.users` or `engine.graphWriters`. Another throws `InvalidArgumentException` |
| `settings` | Other settings of the transaction, like `['app.tenant_id' => 3]`. `null` sets them empty, and booleans `on` and `off` |
| `connection` | A connection or its name, the default connection by default |
| `identity` | Another identity than `P9s::identity()` |

`$userId` is an `int`, a `string`, or `null` for no one.

### setUser

`P9s::setUser($userId, readOnly: false, role: null, settings: [], connection: null, identity: null)` acts as the user for the rest of the current transaction.

### isRefused

```php
->withExceptions(function (Exceptions $exceptions) {
    $exceptions->render(fn (QueryException $error) => P9s::isRefused($error)
        ? response()->json(['error' => 'forbidden'], 403)
        : null);
})
```

`P9s::isRefused($error)` tells whether an error is Postgres refusing a statement to the user, with `insufficient_privilege`, `42501`, which `P9s::INSUFFICIENT_PRIVILEGE` holds: a row the policies do not let through, a statement the role has no privilege for, or a share of bits the user does not have. Laravel wraps the `PDOException` in an `Illuminate\Database\QueryException`, and it reads `errorInfo` of both, through `getPrevious()`.

### resolveUserIdUsing

```php
->booted(function () {
    P9s::resolveUserIdUsing(fn (Request $request) => $request->attributes->get('user_id'));
})
```

`P9s::resolveUserIdUsing($resolver)` tells the `AsUser` middleware how to find the user of a request, `$request->user()?->getAuthIdentifier()` by default, and `null` goes back to it. `P9s::userIdOf($request)` returns the user it finds. `P9s::connection($connection)` returns the connection of a name, or of `null`, the default.

## AsUser

```php
use P9s\AsUser;

Route::middleware(['auth:sanctum', AsUser::class])->group(function () {
    Route::apiResource('documents', DocumentController::class);
});
```

The `AsUser` middleware runs the rest of the request in a transaction as its user, read only for `GET` and `HEAD`. Put it after the middleware that authenticates the user. `AsUser::class.':pgsql'` takes another connection. Laravel turns an exception of a controller into a response before it reaches the middleware, so a response that holds an exception rolls back too, and anything else commits.

## Identity

`new Identity($config, setting: null, claim: null)` reads the role and the setting from `engine` of a config, an array, like [`createIdentity`](./postgres#createidentity), and `Identity::fromFile($path, setting: null, claim: null)` reads `p9s.config.json`. They throw `InvalidArgumentException` when the file cannot be read, when `engine.users` is empty, or when there is no setting, and `JsonException` when the JSON does not parse.

| Member | |
| --- | --- |
| `role`, `setting`, `claim`, `roles` | The role transactions take, the first of `engine.users`, the setting the current user function reads, its claim or `null`, and the roles of `engine.users` and `engine.graphWriters` |
| `value($userId)` | The value of the setting for a user: the id as text, JSON claims, or `''` for `null` |
| `settings($userId, role: null, settings: [])` | The settings of a transaction of the user, as `[name, value]` pairs, the role first |
| `statement($userId, role: null, settings: [])` | `['select set_config(?, ?, true), ...', $values]` |

## Models

The migration adds `resource_id` or `role_id` to the tables of p9s, which Eloquent reads and renders with every model. Hide them with `protected $hidden = ['resource_id'];`, which [`p9s adopt`](./cli#adopt) writes. See [models](../integrations/laravel#models).
