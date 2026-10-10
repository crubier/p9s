# p9s for Laravel

Act as a user of [p9s](https://github.com/crubier/p9s), permissions of trees in Postgres with row level security, from
Laravel and Eloquent: every query of a transaction runs as the role of the users of the config, with the id of the user
in the setting its current user function reads, so the policies of p9s decide what it reads and writes.

```bash
composer require p9s/laravel
```

The role and the setting come from the config of p9s, as for `createIdentity` of `@p9s/postgres`: `p9s.config.json` at
the root of the Laravel app, or the file `P9S_CONFIG` names. Or set it:

```php
P9s::useIdentity(Identity::fromFile(base_path('config/p9s.config.json')));
```

## Eloquent

```php
use P9s\P9s;

$documents = P9s::asUser($user->id, fn () => Document::orderByDesc('updated_at')->limit(50)->get());

$count = P9s::asUser($user->id, fn () => Document::count(), readOnly: true);
```

`P9s::asUser` runs the closure in a transaction of the default connection, or of `connection:`, acts as the user in it,
commits when the closure returns and rolls back when it throws. The settings end with the transaction, so a connection
never keeps the identity of a previous request, with Octane too. `P9s::setUser($userId)` acts as the user for the rest
of a transaction already begun.

## Middleware

```php
use P9s\AsUser;

Route::middleware(['auth:sanctum', AsUser::class])->group(function () {
    // ...
});
```

`AsUser` runs the rest of the request in a transaction as `$request->user()->getAuthIdentifier()`, read only for `GET`
and `HEAD`. Put it after the middleware that authenticates the user. For another user id, tell p9s where it is, in
`bootstrap/app.php` or a service provider:

```php
P9s::resolveUserIdUsing(fn (Request $request) => $request->attributes->get('user_id'));
```

Laravel turns an exception of a controller into a response before the middleware sees it, so `AsUser` also rolls back
when the response holds an exception.

## Refused writes

Postgres refuses a row the policies do not let through, a statement the role has no privilege for, and a share of bits
the user does not have, with `insufficient_privilege`. `P9s::isRefused($error)` tells, through the
`QueryException` of Laravel. In `bootstrap/app.php`:

```php
->withExceptions(function (Exceptions $exceptions) {
    $exceptions->render(fn (QueryException $error) => P9s::isRefused($error)
        ? response()->json(['error' => 'forbidden'], 403)
        : null);
})
```

## Models

The migration of p9s adds a column to the tables of roles and resources, like `resource_id`, with a default. Eloquent
reads every column, so hide it from JSON: `protected $hidden = ['resource_id'];`.

Example: [Laravel](https://github.com/crubier/p9s/tree/main/examples/integrations/laravel).
